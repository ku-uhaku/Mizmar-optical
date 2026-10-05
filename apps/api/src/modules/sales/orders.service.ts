import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { fromCents, toCents } from '@mizmar/shared';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import { StockService } from '../inventory/stock.service';
import { SessionsService } from '../pos/sessions.service';
import { CartPricingService, type PricedCart } from './cart-pricing.service';
import type { AddPaymentDto, CheckoutDto, ListOrdersDto, PaymentInputDto } from './sales.dto';

const ORDER_INCLUDE = {
  customer: { select: { id: true, code: true, firstName: true, lastName: true, phone: true, email: true } },
  lines: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' as const }, include: { variant: { select: { id: true, sku: true, barcode: true, productId: true } }, lensConfig: { include: { treatments: true, lensType: { select: { id: true, name: true, kind: true } } } }, returnLines: { select: { quantity: true, refundAmount: true, return: { select: { status: true } } } } } },
  payments: { where: { deletedAt: null }, orderBy: { paidAt: 'asc' as const }, include: { method: { select: { id: true, name: true, type: true } } } },
  invoices: { where: { deletedAt: null }, select: { id: true, number: true, status: true, total: true, paidTotal: true } },
  returns: { where: { deletedAt: null }, select: { id: true, number: true, status: true, refundTotal: true, createdAt: true } },
} as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService, private readonly pricing: CartPricingService, private readonly numbering: NumberingService,
    private readonly stock: StockService, private readonly sessions: SessionsService, private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------ helpers
  private activeStore(user: AuthUser, active?: string | null) {
    const id = active ?? user.defaultStoreId;
    if (!id) throw new BadRequestException({ code: 'NO_STORE', message: 'No active store: pick one with the x-store-id header' });
    assertStoreAccess(user, id);
    return id;
  }

  async defaultWarehouse(storeId: string) {
    const w = await this.prisma.db.warehouse.findFirst({ where: { storeId, isActive: true }, orderBy: [{ isDefault: 'desc' }, { code: 'asc' }] });
    if (!w) throw new ConflictException({ code: 'NO_WAREHOUSE', message: 'This store has no active warehouse' });
    return w;
  }

  /** Payment methods the till may use, validated once for a batch of payments. */
  private async methods(inputs: { methodId: string }[], channel: 'pos' | 'any' = 'pos') {
    const ids = [...new Set(inputs.map((p) => p.methodId))];
    const rows = await this.prisma.db.paymentMethodConfig.findMany({ where: { id: { in: ids }, isActive: true, ...(channel === 'pos' ? { availableInPos: true } : {}) } });
    if (rows.length !== ids.length) throw new BadRequestException({ code: 'INVALID_PAYMENT_METHOD', message: 'Unknown, inactive or unavailable payment method' });
    return new Map(rows.map((m) => [m.id, m]));
  }

  /**
   * Recomputes what an order has been paid, refunded and still owes, from the payment/refund/return rows (the source of truth),
   * and keeps its invoice in step. Always call inside the transaction that changed any of them.
   */
  async recalc(tx: Tx, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const [pays, refunds, returned] = await Promise.all([
      tx.payment.findMany({ where: { orderId, deletedAt: null, status: 'CAPTURED', kind: { in: ['PAYMENT', 'DEPOSIT'] } }, select: { amount: true } }),
      tx.refund.findMany({ where: { orderId, deletedAt: null, status: 'CAPTURED' }, select: { amount: true } }),
      tx.returnLine.findMany({ where: { deletedAt: null, return: { orderId, deletedAt: null, status: { not: 'REJECTED' } } }, select: { refundAmount: true } }),
    ]);
    const sum = (xs: { amount?: unknown; refundAmount?: unknown }[]) => xs.reduce((n, x) => n + toCents(Number(x.amount ?? x.refundAmount)), 0);
    const total = toCents(Number(order.total)), paid = sum(pays), refunded = sum(refunds), returnedValue = sum(returned);
    const net = total - returnedValue, paidNet = paid - refunded;
    const balance = Math.max(0, net - paidNet);
    const status = balance > 0 ? (paidNet > 0 ? 'PARTIAL' : 'UNPAID') : refunded > 0 ? (net <= 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED') : 'PAID';
    await tx.order.update({ where: { id: orderId }, data: { paidTotal: fromCents(paidNet), balanceDue: fromCents(balance), paymentStatus: status } });
    const invoices = await tx.invoice.findMany({ where: { orderId, deletedAt: null, status: { not: 'VOID' } } });
    for (const inv of invoices) {
      await tx.invoice.update({ where: { id: inv.id }, data: { paidTotal: fromCents(Math.max(0, paidNet)), status: balance === 0 && net > 0 ? 'PAID' : paidNet > 0 ? 'PARTIALLY_PAID' : 'ISSUED' } });
    }
    return { paidNet, balance, status };
  }

  /** Writes the payment rows (and drawer movements for cash) for `inputs`, in the caller's transaction. */
  private async applyPayments(tx: Tx, o: { id: string; storeId: string; customerId: string | null; invoiceId?: string | null; totalCents: number; alreadyPaidCents: number }, inputs: PaymentInputDto[], methods: Map<string, { id: string; type: string }>, session: { id: string } | null, user: AuthUser) {
    let paid = o.alreadyPaidCents;
    for (const p of inputs) {
      paid += toCents(p.amount);
      const method = methods.get(p.methodId)!;
      const kind = paid < o.totalCents ? 'DEPOSIT' : 'PAYMENT';
      const payment = await tx.payment.create({
        data: { storeId: o.storeId, orderId: o.id, invoiceId: o.invoiceId ?? null, customerId: o.customerId, methodId: p.methodId, kind, status: 'CAPTURED', amount: p.amount, reference: p.reference, cashSessionId: session?.id ?? null, receivedById: user.id },
      });
      if (method.type === 'CASH') {
        if (!session) throw new ConflictException({ code: 'NO_OPEN_SESSION', message: 'Cash payments need an open register session' });
        await this.sessions.recordCash(tx, { sessionId: session.id, type: kind === 'DEPOSIT' ? 'DEPOSIT' : 'SALE', amount: p.amount, paymentId: payment.id, methodId: method.id, actorId: user.id });
      }
    }
  }

  // ------------------------------------------------------------------ price preview
  /**
   * What checkout WOULD charge for this cart, with no side effects. The till calls this as the cashier builds the cart, so the
   * number on screen always comes from the same code path that charges the customer (and lens/prescription problems surface early).
   */
  async preview(lines: CheckoutDto['lines'], customerId: string | undefined, user: AuthUser, activeStoreId?: string | null) {
    const storeId = this.activeStore(user, activeStoreId);
    if (lines.length === 0) return { lines: [], subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0, hasLens: false, minimumPayment: 0, depositPercent: null };
    const cart = await this.pricing.price(lines, { user, storeId, customerId });
    const pct = await this.settings.value<number>('min_deposit_pct', 30, storeId);
    return {
      lines: cart.lines.map((l) => ({ variantId: l.variantId, productType: l.productType, sku: l.sku, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, gross: l.gross, discount: l.discount, taxRatePct: l.taxRatePct, taxAmount: l.taxAmount, lineTotal: l.lineTotal, lens: l.lens && { lensTypeName: l.lens.lensTypeName, lensEntryName: l.lens.lensEntryName, lensPrice: l.lens.lensPrice, treatments: l.lens.treatments, treatmentsPrice: l.lens.treatmentsPrice, prescriptionId: l.lens.prescriptionId } })),
      subtotal: cart.subtotal, discountTotal: cart.discountTotal, taxTotal: cart.taxTotal, total: cart.total, hasLens: cart.hasLens,
      // what must be collected now: everything, or (prescription orders) the minimum deposit
      minimumPayment: cart.hasLens ? fromCents(Math.ceil((toCents(cart.total) * pct) / 100)) : cart.total, depositPercent: cart.hasLens ? pct : null,
    };
  }

  // ------------------------------------------------------------------ checkout
  async checkout(dto: CheckoutDto, user: AuthUser, activeStoreId?: string | null) {
    const storeId = this.activeStore(user, activeStoreId);
    if (dto.clientRef) {
      const existing = await this.prisma.raw.order.findFirst({ where: { storeId, clientRef: dto.clientRef, deletedAt: null } });
      if (existing) return { ...(await this.get(existing.id, user)), replayed: true };
    }
    const session = await this.sessions.requireForSale(user, storeId);
    const quote = dto.quoteId ? await this.usableQuote(dto.quoteId, user) : null;
    const customerId = dto.customerId ?? quote?.customerId ?? undefined;
    const cart = await this.pricing.price(dto.lines, { user, storeId, customerId });
    const totalCents = toCents(cart.total);
    const paySum = dto.payments.reduce((n, p) => n + toCents(p.amount), 0);
    await this.assertPaymentRules(cart, paySum, totalCents, storeId);
    const methods = await this.methods(dto.payments);
    const wh = await this.defaultWarehouse(storeId);
    const allowNegative = await this.settings.value('allow_negative_stock', false, storeId);

    try {
      const id = await this.prisma.raw.$transaction(async (tx) => {
        const number = await this.numbering.next(tx, storeId, 'ORDER');
        const order = await tx.order.create({
          data: {
            storeId, number, channel: 'POS', status: 'CONFIRMED', paymentStatus: 'UNPAID', fulfillment: 'IN_STORE', customerId: customerId ?? null, cashierId: user.id, cashSessionId: session?.id ?? null,
            subtotal: cart.subtotal, discountTotal: cart.discountTotal, taxTotal: cart.taxTotal, shippingTotal: 0, total: cart.total, balanceDue: cart.total, internalNote: dto.note, placedAt: new Date(), createdById: user.id, clientRef: dto.clientRef,
          },
        });
        for (const [i, l] of cart.lines.entries()) {
          const line = await tx.orderLine.create({
            data: {
              orderId: order.id, variantId: l.variantId, sku: l.sku, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost, discount: l.discount, taxRateId: l.taxRateId, taxRatePct: l.taxRatePct, taxAmount: l.taxAmount, lineTotal: l.lineTotal, sortOrder: i,
              ...(l.lens && {
                lensConfig: { create: { lensTypeId: l.lens.lensTypeId, lensEntryId: l.lens.lensEntryId, prescriptionId: l.lens.prescriptionId, prescriptionSnapshot: l.lens.prescriptionSnapshot as any, lensPrice: l.lens.lensPrice, treatmentsPrice: l.lens.treatmentsPrice, notes: l.lens.notes, treatments: { create: l.lens.treatments } } },
              }),
            },
          });
          await this.stock.move(tx, { storeId, variantId: l.variantId, warehouseId: wh.id, type: 'SALE', quantity: -l.quantity, unitCost: l.unitCost ?? undefined, refType: 'Order', refId: order.id, note: number, actorId: user.id, allowNegative });
          void line;
        }
        const invoice = await this.createInvoice(tx, { orderId: order.id, storeId, customerId: customerId ?? null, cart, number: await this.numbering.next(tx, storeId, 'INVOICE') });
        await this.applyPayments(tx, { id: order.id, storeId, customerId: customerId ?? null, invoiceId: invoice.id, totalCents, alreadyPaidCents: 0 }, dto.payments, methods, session, user);
        const { balance } = await this.recalc(tx, order.id);
        if (!cart.hasLens && balance === 0) await tx.order.update({ where: { id: order.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
        if (quote) await tx.quote.update({ where: { id: quote.id }, data: { status: 'CONVERTED', convertedOrderId: order.id } });
        return order.id;
      });
      return this.get(id, user);
    } catch (e) {
      // two submits of the SAME attempt raced: the loser hits the unique (storeId, clientRef) index and returns the winner's order
      if ((e as { code?: string })?.code === 'P2002' && dto.clientRef) {
        const existing = await this.prisma.raw.order.findFirst({ where: { storeId, clientRef: dto.clientRef, deletedAt: null } });
        if (existing) return { ...(await this.get(existing.id, user)), replayed: true };
      }
      throw e;
    }
  }

  private async assertPaymentRules(cart: PricedCart, paySum: number, totalCents: number, storeId: string) {
    if (paySum > totalCents) throw new BadRequestException({ code: 'OVERPAYMENT', message: 'Payments exceed the amount due', details: { due: fromCents(totalCents), received: fromCents(paySum) } });
    if (paySum === totalCents) return;
    if (!cart.hasLens) throw new BadRequestException({ code: 'FULL_PAYMENT_REQUIRED', message: 'This sale must be paid in full', details: { due: fromCents(totalCents), received: fromCents(paySum) } });
    const pct = await this.settings.value<number>('min_deposit_pct', 30, storeId);
    const min = Math.ceil((totalCents * pct) / 100);
    if (paySum < min || paySum === 0) throw new BadRequestException({ code: 'DEPOSIT_TOO_LOW', message: `A deposit of at least ${pct}% is required for prescription orders`, details: { minimum: fromCents(min), received: fromCents(paySum), percent: pct } });
  }

  private async createInvoice(tx: Tx, o: { orderId: string; storeId: string; customerId: string | null; cart: PricedCart; number: string }) {
    const [store, customer, branding] = await Promise.all([
      tx.store.findUniqueOrThrow({ where: { id: o.storeId }, select: { name: true, address: true, city: true, phone: true, email: true } }),
      o.customerId ? tx.customer.findUnique({ where: { id: o.customerId }, select: { code: true, firstName: true, lastName: true, phone: true, email: true } }) : null,
      tx.brandingSetting.findFirst({ where: { key: 'default' }, select: { storeName: true, legal: true } }),
    ]);
    return tx.invoice.create({
      data: {
        storeId: o.storeId, number: o.number, orderId: o.orderId, customerId: o.customerId, status: 'ISSUED', issuedAt: new Date(), subtotal: o.cart.subtotal, discountTotal: o.cart.discountTotal, taxTotal: o.cart.taxTotal, total: o.cart.total,
        billingSnapshot: { store, customer, company: branding?.storeName, legal: branding?.legal ?? null } as any,
        lines: { create: o.cart.lines.map((l, i) => ({ description: l.description, quantity: l.quantity, unitPrice: l.gross / l.quantity, discount: l.discount, taxRatePct: l.taxRatePct, taxAmount: l.taxAmount, lineTotal: l.lineTotal, sortOrder: i })) },
      },
    });
  }

  private async usableQuote(id: string, user: AuthUser) {
    const q = await this.prisma.db.quote.findFirst({ where: { id } });
    if (!q) throw new BadRequestException('Unknown quote');
    assertStoreAccess(user, q.storeId);
    if (!['DRAFT', 'SENT', 'ACCEPTED'].includes(q.status)) throw new ConflictException({ code: 'QUOTE_NOT_USABLE', message: `Quote is ${q.status}` });
    if (q.validUntil && q.validUntil < new Date(new Date().toDateString())) throw new ConflictException({ code: 'QUOTE_EXPIRED', message: 'Quote has expired' });
    return q;
  }

  // ------------------------------------------------------------------ payments on an existing order
  async addPayment(id: string, dto: AddPaymentDto, user: AuthUser, activeStoreId?: string | null) {
    const order = await this.prisma.db.order.findFirst({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    assertStoreAccess(user, order.storeId);
    const methods = await this.methods([dto], 'any');
    const storeId = order.storeId;
    const session = await this.sessions.requireForSale(user, storeId);
    void activeStoreId;
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`; // serialise concurrent payments on one order
      const o = await tx.order.findUniqueOrThrow({ where: { id } });
      if (o.status === 'CANCELLED') throw new ConflictException({ code: 'INVALID_STATE', message: 'Order is cancelled' });
      const due = toCents(Number(o.balanceDue));
      if (due <= 0) throw new ConflictException({ code: 'NOTHING_DUE', message: 'This order is already fully paid' });
      if (toCents(dto.amount) > due) throw new BadRequestException({ code: 'OVERPAYMENT', message: 'Amount exceeds the balance due', details: { due: fromCents(due) } });
      const invoice = await tx.invoice.findFirst({ where: { orderId: id, deletedAt: null, status: { not: 'VOID' } } });
      await this.applyPayments(tx, { id, storeId, customerId: o.customerId, invoiceId: invoice?.id, totalCents: toCents(Number(o.total)), alreadyPaidCents: toCents(Number(o.paidTotal)) }, [dto], methods, session, user);
      const { balance } = await this.recalc(tx, id);
      // a plain (no-lens) sale that is now fully paid is complete
      if (balance === 0 && o.status === 'CONFIRMED') {
        const hasLens = await tx.orderLineLensConfig.count({ where: { orderLine: { orderId: id } } });
        if (!hasLens) await tx.order.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      }
    });
    return this.get(id, user);
  }

  /** Hand the finished order to the customer. */
  async deliver(id: string, user: AuthUser) {
    const o = await this.prisma.db.order.findFirst({ where: { id } });
    if (!o) throw new NotFoundException('Order not found');
    assertStoreAccess(user, o.storeId);
    if (!['CONFIRMED', 'PROCESSING', 'READY', 'PENDING'].includes(o.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `Order is ${o.status}` });
    if (toCents(Number(o.balanceDue)) > 0) throw new ConflictException({ code: 'BALANCE_DUE', message: 'The remaining balance must be paid before handing the order over', details: { due: Number(o.balanceDue) } });
    await this.prisma.raw.order.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    return this.get(id, user);
  }

  // ------------------------------------------------------------------ reads
  async list(dto: ListOrdersDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const s = dto.search?.trim();
    const where: Record<string, any> = {
      ...(stores && { storeId: { in: stores } }), ...(dto.status && { status: dto.status }), ...(dto.paymentStatus && { paymentStatus: dto.paymentStatus }), ...(dto.channel && { channel: dto.channel }), ...(dto.customerId && { customerId: dto.customerId }),
      ...(dto.hasBalance !== undefined && { balanceDue: dto.hasBalance ? { gt: 0 } : { lte: 0 } }),
      ...((dto.from || dto.to) && { placedAt: { ...(dto.from && { gte: dto.from }), ...(dto.to && { lte: dto.to }) } }),
      ...(s && { OR: [{ number: { contains: s, mode: 'insensitive' } }, { customer: { OR: [{ firstName: { contains: s, mode: 'insensitive' } }, { lastName: { contains: s, mode: 'insensitive' } }, { phone: { contains: s } }] } }] }),
    };
    return paginate(this.prisma.db.order, dto, {
      where, sortable: ['placedAt', 'total', 'number', 'createdAt'], defaultSort: 'placedAt',
      include: { customer: { select: { id: true, firstName: true, lastName: true, phone: true } }, invoices: { where: { deletedAt: null }, select: { id: true, number: true } }, _count: { select: { lines: true } } },
    });
  }

  async get(id: string, user: AuthUser) {
    const o = await this.prisma.db.order.findFirst({ where: { id }, include: ORDER_INCLUDE });
    if (!o) throw new NotFoundException('Order not found');
    assertStoreAccess(user, o.storeId);
    const cashier = o.cashierId ? await this.prisma.db.user.findFirst({ where: { id: o.cashierId }, select: { firstName: true, lastName: true } }) : null;
    return {
      ...o, cashier,
      lines: o.lines.map(({ returnLines, ...l }) => {
        const live = returnLines.filter((r) => r.return.status !== 'REJECTED');
        const returnedQty = live.reduce((n, r) => n + r.quantity, 0);
        return { ...l, returnedQty, returnableQty: l.quantity - returnedQty };
      }),
    };
  }
}
