import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { fromCents, proportionalRefund, toCents } from '@mizmar/shared';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { assertStoreAccess } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import { StockService } from '../inventory/stock.service';
import { SessionsService } from '../pos/sessions.service';
import { OrdersService } from './orders.service';
import type { CancelOrderDto, CreateReturnDto, RefundInputDto } from './sales.dto';

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly stock: StockService,
    private readonly sessions: SessionsService, private readonly orders: OrdersService,
  ) {}

  private assertCanRefund(user: AuthUser) {
    if (!user.isSuperAdmin && !user.permissions.includes('pos:refund')) throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Insufficient permissions', details: { missing: ['pos:refund'] } });
  }

  async create(orderId: string, dto: CreateReturnDto, user: AuthUser) {
    if (dto.refund) this.assertCanRefund(user);
    return this.process(orderId, dto, user, false);
  }

  /** Cancel an order that has not been handed over: everything goes back to stock and any money paid is refunded. */
  async cancel(orderId: string, dto: CancelOrderDto, user: AuthUser) {
    const o = await this.prisma.db.order.findFirst({ where: { id: orderId }, include: { lines: { where: { deletedAt: null } } } });
    if (!o) throw new NotFoundException('Order not found');
    assertStoreAccess(user, o.storeId);
    if (!['PENDING', 'CONFIRMED', 'PROCESSING', 'READY'].includes(o.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `A ${o.status} order cannot be cancelled: use a return instead` });
    if (toCents(Number(o.paidTotal)) > 0 && !dto.refund) throw new BadRequestException({ code: 'REFUND_REQUIRED', message: 'Money was paid on this order: say how it is paid back', details: { paid: Number(o.paidTotal) } });
    if (dto.refund) this.assertCanRefund(user);
    return this.process(orderId, { lines: o.lines.map((l) => ({ orderLineId: l.id, quantity: l.quantity })), reason: dto.reason, refund: dto.refund }, user, true);
  }

  private async process(orderId: string, dto: CreateReturnDto, user: AuthUser, cancel: boolean) {
    const order = await this.prisma.db.order.findFirst({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    assertStoreAccess(user, order.storeId);
    if (order.status === 'CANCELLED' || order.status === 'DRAFT') throw new ConflictException({ code: 'INVALID_STATE', message: `Order is ${order.status}` });
    const wh = await this.orders.defaultWarehouse(order.storeId);
    const method = dto.refund ? await this.refundMethod(dto.refund) : null;
    const session = method?.type === 'CASH' ? await this.sessions.requireForSale(user, order.storeId) : await this.sessions.currentFor(user, order.storeId);

    const id = await this.prisma.raw.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`; // serialise concurrent returns on one order
      const lines = await tx.orderLine.findMany({ where: { orderId, deletedAt: null }, include: { returnLines: { where: { deletedAt: null, return: { status: { not: 'REJECTED' }, deletedAt: null } }, select: { quantity: true, refundAmount: true } } } });
      const byId = new Map(lines.map((l) => [l.id, l]));
      const seen = new Set<string>();
      const rows = dto.lines.map((r) => {
        const l = byId.get(r.orderLineId);
        if (!l) throw new BadRequestException({ code: 'UNKNOWN_LINE', message: 'A line does not belong to this order', details: { orderLineId: r.orderLineId } });
        if (seen.has(l.id)) throw new BadRequestException('A line can only appear once per return');
        seen.add(l.id);
        const retQty = l.returnLines.reduce((s, x) => s + x.quantity, 0), retAmt = l.returnLines.reduce((s, x) => s + toCents(Number(x.refundAmount)), 0);
        if (r.quantity > l.quantity - retQty) throw new BadRequestException({ code: 'RETURN_EXCEEDS_SOLD', message: 'Cannot return more than was sold', details: { orderLineId: l.id, returnable: l.quantity - retQty } });
        const condition = (r.condition ?? 'NEW') as 'NEW' | 'OPENED' | 'DAMAGED';
        return { line: l, qty: r.quantity, condition, restock: r.restock ?? condition !== 'DAMAGED', refundAmount: proportionalRefund(Number(l.lineTotal), l.quantity, r.quantity, fromCents(retAmt), retQty) };
      });
      const returnValue = rows.reduce((s, r) => s + toCents(r.refundAmount), 0);

      const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const paidNet = toCents(Number(fresh.paidTotal));
      let refundCents = 0;
      if (dto.refund) {
        refundCents = dto.refund.amount != null ? toCents(dto.refund.amount) : Math.min(returnValue, paidNet);
        if (refundCents > paidNet) throw new BadRequestException({ code: 'REFUND_EXCEEDS_PAID', message: 'Cannot refund more than the customer paid', details: { paid: fromCents(paidNet) } });
        if (refundCents > returnValue && !cancel) throw new BadRequestException({ code: 'REFUND_EXCEEDS_RETURN', message: 'Cannot refund more than the value of the returned items', details: { value: fromCents(returnValue) } });
        if (method!.type === 'CASH') {
          const available = await this.sessions.availableCash(tx, session!.id);
          if (refundCents > available) throw new BadRequestException({ code: 'INSUFFICIENT_CASH', message: 'Not enough cash in the drawer for this refund', details: { available: fromCents(available) } });
        }
      }

      const number = await this.numbering.next(tx, order.storeId, 'RETURN');
      const ret = await tx.return.create({
        data: {
          storeId: order.storeId, number, orderId, customerId: order.customerId, status: refundCents > 0 ? 'REFUNDED' : 'APPROVED', reason: dto.reason, refundTotal: fromCents(refundCents), processedById: user.id, processedAt: new Date(),
          lines: { create: rows.map((r) => ({ orderLineId: r.line.id, quantity: r.qty, condition: r.condition, restock: r.restock, refundAmount: r.refundAmount })) },
        },
      });
      for (const r of rows) {
        if (r.restock && r.line.variantId) await this.stock.move(tx, { storeId: order.storeId, variantId: r.line.variantId, warehouseId: wh.id, type: 'SALE_RETURN', quantity: r.qty, unitCost: r.line.unitCost == null ? undefined : Number(r.line.unitCost), refType: 'Return', refId: ret.id, note: number, actorId: user.id });
      }
      await this.creditNote(tx, order, ret.id, rows, dto.reason);
      if (refundCents > 0) await this.payBack(tx, order, ret.id, method!, dto.refund!, refundCents, session, user);
      await this.orders.recalc(tx, orderId);
      if (cancel) await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: dto.reason } });
      return ret.id;
    });
    return this.get(id, user);
  }

  private async refundMethod(r: RefundInputDto) {
    const m = await this.prisma.db.paymentMethodConfig.findFirst({ where: { id: r.methodId, isActive: true } });
    if (!m) throw new BadRequestException({ code: 'INVALID_PAYMENT_METHOD', message: 'Unknown or inactive refund method' });
    return m;
  }

  private async creditNote(tx: Tx, order: { id: string; storeId: string; customerId: string | null }, returnId: string, rows: { line: { id: string; description: string; taxAmount: unknown; lineTotal: unknown }; qty: number; refundAmount: number }[], reason?: string) {
    const invoice = await tx.invoice.findFirst({ where: { orderId: order.id, deletedAt: null, status: { not: 'VOID' } } });
    const lines = rows.map((r) => {
      const lineTotal = Number(r.line.lineTotal);
      const tax = lineTotal === 0 ? 0 : fromCents(Math.round((toCents(Number(r.line.taxAmount)) * toCents(r.refundAmount)) / toCents(lineTotal)));
      return { description: r.line.description, quantity: r.qty, unitPrice: r.refundAmount / r.qty, taxAmount: tax, lineTotal: r.refundAmount };
    });
    const total = rows.reduce((s, r) => s + toCents(r.refundAmount), 0), taxTotal = lines.reduce((s, l) => s + toCents(l.taxAmount), 0);
    return tx.creditNote.create({
      data: { storeId: order.storeId, number: await this.numbering.next(tx, order.storeId, 'CREDIT_NOTE'), invoiceId: invoice?.id, returnId, customerId: order.customerId, status: 'ISSUED', reason, subtotal: fromCents(total - taxTotal), taxTotal: fromCents(taxTotal), total: fromCents(total), issuedAt: new Date(), lines: { create: lines } },
    });
  }

  private async payBack(tx: Tx, order: { id: string; storeId: string; customerId: string | null }, returnId: string, method: { id: string; type: string }, input: RefundInputDto, cents: number, session: { id: string } | null, user: AuthUser) {
    const original = await tx.payment.findFirst({ where: { orderId: order.id, methodId: method.id, kind: { in: ['PAYMENT', 'DEPOSIT'] }, status: 'CAPTURED', deletedAt: null }, orderBy: { paidAt: 'desc' } });
    const amount = fromCents(cents);
    const payment = await tx.payment.create({ data: { storeId: order.storeId, orderId: order.id, customerId: order.customerId, methodId: method.id, kind: 'REFUND', status: 'CAPTURED', amount, reference: input.reference, cashSessionId: session?.id ?? null, receivedById: user.id } });
    await tx.refund.create({ data: { storeId: order.storeId, orderId: order.id, returnId, paymentId: original?.id, methodId: method.id, amount, status: 'CAPTURED', reference: input.reference, processedById: user.id } });
    if (method.type === 'CASH') await this.sessions.recordCash(tx, { sessionId: session!.id, type: 'REFUND', amount: -amount, paymentId: payment.id, methodId: method.id, actorId: user.id });
  }

  async get(id: string, user: AuthUser) {
    const r = await this.prisma.db.return.findFirst({ where: { id }, include: { lines: { include: { orderLine: { select: { description: true, sku: true } } } }, refunds: { include: {} }, creditNotes: { select: { id: true, number: true, total: true } }, order: { select: { id: true, number: true, status: true, paymentStatus: true, total: true, paidTotal: true, balanceDue: true } } } });
    if (!r) throw new NotFoundException('Return not found');
    assertStoreAccess(user, r.storeId);
    return r;
  }
}
