import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { fromCents, toCents } from '@mizmar/shared';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import { StockService } from '../inventory/stock.service';
import { CartPricingService, type PricedCart } from '../sales/cart-pricing.service';
import { OrdersService } from '../sales/orders.service';
import { createJobsForOrder } from '../workshop/workshop.jobs';
import { PaymentProviders } from './payment-providers';
import * as D from './shop.dto';

const ONLINE_TYPES = ['CASH_ON_DELIVERY', 'BANK_TRANSFER', 'ONLINE_PROVIDER', 'CARD'];

/** Spreads a discount over lines in proportion to their value, to the cent, never exceeding a line (largest-remainder). */
export function distribute(discountCents: number, grosses: number[]): number[] {
  const total = grosses.reduce((n, g) => n + g, 0);
  if (total <= 0 || discountCents <= 0) return grosses.map(() => 0);
  const d = Math.min(discountCents, total);
  const raw = grosses.map((g) => (g * d) / total);
  const out = raw.map(Math.floor);
  let left = d - out.reduce((n, x) => n + x, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; if (out[i] < grosses[i]) { out[i]++; left--; } }
  return out;
}

type CouponCheck = { ok: true; id: string; code: string; discountCents: number; freeShipping: boolean } | { ok: false; reason: string };

@Injectable()
export class ShopCheckoutService {
  constructor(
    private readonly prisma: PrismaService, private readonly pricing: CartPricingService, private readonly orders: OrdersService, private readonly numbering: NumberingService,
    private readonly stock: StockService, private readonly settings: SettingsService, private readonly providers: PaymentProviders, @InjectQueue('mail') private readonly mail: Queue,
  ) {}

  // ------------------------------------------------------------------ lookups
  paymentMethods() {
    return this.prisma.db.paymentMethodConfig.findMany({ where: { isActive: true, availableOnline: true, type: { in: ONLINE_TYPES as any } }, orderBy: { sortOrder: 'asc' }, select: { code: true, name: true, type: true, translations: true } });
  }

  async shippingMethods() {
    const rows = await this.prisma.db.shippingMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    return rows.map((m) => this.shippingView(m, 0, false));
  }

  private shippingView(m: any, subtotal: number, freeShipping: boolean) {
    const free = freeShipping || (m.freeOverAmount != null && subtotal >= Number(m.freeOverAmount));
    return { id: m.id, code: m.code, name: m.name, description: m.description, translations: m.translations, price: free ? 0 : Number(m.price), freeOverAmount: m.freeOverAmount == null ? null : Number(m.freeOverAmount), estimatedDaysMin: m.estimatedDaysMin, estimatedDaysMax: m.estimatedDaysMax, zones: m.zones };
  }

  /** The store that fulfils delivery orders (setting `online.fulfilment_store_id`, else the default/first active store). */
  private async deliveryStore() {
    const id = await this.settings.value<string | null>('fulfilment_store_id', null);
    const store = (id && (await this.prisma.db.store.findFirst({ where: { id, isActive: true } }))) || (await this.prisma.db.store.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }));
    if (!store) throw new ConflictException({ code: 'NO_STORE', message: 'No store is open for online orders' });
    return store;
  }

  private async fulfilmentStore(dto: D.QuoteDto) {
    if ((dto.fulfillment ?? 'PICKUP') === 'DELIVERY') return this.deliveryStore();
    if (!dto.storeId) return this.deliveryStore();
    const store = await this.prisma.db.store.findFirst({ where: { id: dto.storeId, isActive: true, showOnLocator: true } });
    if (!store) throw new BadRequestException({ code: 'UNKNOWN_STORE', message: 'Unknown pickup store' });
    return store;
  }

  // ------------------------------------------------------------------ coupons
  private async checkCoupon(code: string, cart: PricedCart, customerId: string | null, tx?: Tx): Promise<CouponCheck> {
    const db: Tx = tx ?? this.prisma.raw; // soft-deleted rows are excluded by hand because a transaction client has no filter
    const c = await db.coupon.findFirst({ where: { code: code.trim().toUpperCase(), isActive: true, deletedAt: null } });
    if (!c) return { ok: false, reason: 'COUPON_UNKNOWN' };
    const now = new Date();
    if (c.startsAt && c.startsAt > now) return { ok: false, reason: 'COUPON_NOT_STARTED' };
    if (c.endsAt && c.endsAt < now) return { ok: false, reason: 'COUPON_EXPIRED' };
    if (c.usageLimit != null && c.usedCount >= c.usageLimit) return { ok: false, reason: 'COUPON_EXHAUSTED' };
    if (c.perCustomerLimit != null && customerId && (await db.couponRedemption.count({ where: { couponId: c.id, customerId, deletedAt: null } })) >= c.perCustomerLimit) return { ok: false, reason: 'COUPON_ALREADY_USED' };

    const scope = (c.appliesTo ?? {}) as { categoryIds?: string[]; brandIds?: string[]; productIds?: string[] };
    const restricted = !!(scope.categoryIds?.length || scope.brandIds?.length || scope.productIds?.length);
    let eligible = cart.lines;
    if (restricted) {
      const prods = await db.product.findMany({ where: { id: { in: cart.lines.map((l) => l.productId) }, deletedAt: null }, select: { id: true, brandId: true, categoryId: true } });
      const p = new Map(prods.map((x) => [x.id, x]));
      eligible = cart.lines.filter((l) => {
        const x = p.get(l.productId);
        return !!x && (scope.productIds?.includes(x.id) || (x.brandId && scope.brandIds?.includes(x.brandId)) || (x.categoryId && scope.categoryIds?.includes(x.categoryId)));
      });
      if (!eligible.length) return { ok: false, reason: 'COUPON_NOT_APPLICABLE' };
    }
    const base = eligible.reduce((n, l) => n + toCents(l.gross), 0);
    if (c.minSubtotal != null && toCents(cart.subtotal) < toCents(Number(c.minSubtotal))) return { ok: false, reason: 'COUPON_MIN_SUBTOTAL' };
    if (c.type === 'FREE_SHIPPING') return { ok: true, id: c.id, code: c.code, discountCents: 0, freeShipping: true };
    let d = c.type === 'PERCENT' ? Math.round((base * Number(c.value)) / 100) : toCents(Number(c.value));
    if (c.maxDiscount != null) d = Math.min(d, toCents(Number(c.maxDiscount)));
    return { ok: true, id: c.id, code: c.code, discountCents: Math.min(d, base), freeShipping: false };
  }

  // ------------------------------------------------------------------ pricing
  private toLines(lines: D.ShopLineDto[], discounts?: number[]) {
    return lines.map((l, i) => ({ variantId: l.variantId, quantity: l.quantity, lens: l.lens as any, ...(discounts?.[i] ? { discount: { type: 'AMOUNT' as const, value: fromCents(discounts[i]) } } : {}) }));
  }

  private async build(dto: D.QuoteDto, user: AuthUser | null) {
    const fulfillment = dto.fulfillment ?? 'PICKUP';
    const store = await this.fulfilmentStore(dto);
    const customerId = user?.customerId ?? null;
    if (dto.lines.some((l) => l.lens) && !customerId) throw new BadRequestException({ code: 'ACCOUNT_REQUIRED', message: 'Sign in to order prescription lenses: your prescription is saved to your account' });
    const ctx = { user: null, storeId: store.id, customerId, trustedDiscounts: true };
    const base = await this.pricing.price(this.toLines(dto.lines), ctx);

    let couponResult: CouponCheck | null = null;
    let cart = base;
    if (dto.couponCode?.trim()) {
      couponResult = await this.checkCoupon(dto.couponCode, base, customerId);
      if (couponResult.ok && couponResult.discountCents > 0) {
        const grosses = base.lines.map((l) => toCents(l.gross));
        let eligible = grosses;
        const c = await this.prisma.db.coupon.findFirst({ where: { id: couponResult.id } });
        const scope = (c?.appliesTo ?? {}) as { categoryIds?: string[]; brandIds?: string[]; productIds?: string[] };
        if (scope.categoryIds?.length || scope.brandIds?.length || scope.productIds?.length) {
          const prods = await this.prisma.db.product.findMany({ where: { id: { in: base.lines.map((l) => l.productId) } }, select: { id: true, brandId: true, categoryId: true } });
          const p = new Map(prods.map((x) => [x.id, x]));
          eligible = base.lines.map((l, i) => { const x = p.get(l.productId); return x && (scope.productIds?.includes(x.id) || (x.brandId && scope.brandIds?.includes(x.brandId)) || (x.categoryId && scope.categoryIds?.includes(x.categoryId))) ? grosses[i] : 0; });
        }
        cart = await this.pricing.price(this.toLines(dto.lines, distribute(couponResult.discountCents, eligible)), ctx);
      }
    }
    const freeShipping = !!(couponResult && couponResult.ok && couponResult.freeShipping);

    // shipping
    let shipping: ReturnType<ShopCheckoutService['shippingView']> | null = null;
    let options: ReturnType<ShopCheckoutService['shippingView']>[] = [];
    let undeliverable = false;
    const afterDiscount = cart.subtotal - cart.discountTotal;
    if (fulfillment === 'DELIVERY') {
      const methods = await this.prisma.db.shippingMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
      const city = dto.city?.trim().toLowerCase();
      const serves = (m: any) => !Array.isArray(m.zones) || m.zones.length === 0 || !city || (m.zones as string[]).some((z) => z.trim().toLowerCase() === city);
      options = methods.filter(serves).map((m) => this.shippingView(m, afterDiscount, freeShipping));
      undeliverable = options.length === 0;
      shipping = options.find((o) => o.id === dto.shippingMethodId) ?? options[0] ?? null;
    }
    const shippingCents = shipping ? toCents(shipping.price) : 0;
    const def = await this.prisma.db.taxRate.findFirst({ where: { isDefault: true, isActive: true } });
    const rate = def ? Number(def.rate) : 0;
    const shipTax = def?.isInclusive === false ? 0 : Math.round((shippingCents * rate) / (100 + rate));
    const totals = {
      subtotal: cart.subtotal, discountTotal: cart.discountTotal, shippingTotal: fromCents(shippingCents),
      taxTotal: fromCents(toCents(cart.taxTotal) + shipTax), total: fromCents(toCents(cart.total) + shippingCents),
    };
    return { fulfillment, store, customerId, cart, totals, coupon: couponResult, shipping, options, undeliverable, shipTaxCents: shipTax };
  }

  /** What the cart would cost, with no side effects: the cart page and the checkout summary both show exactly this. */
  async quote(dto: D.QuoteDto, user: AuthUser | null) {
    const b = await this.build(dto, user);
    const wh = await this.orders.defaultWarehouse(b.store.id);
    const levels = await this.prisma.db.stockLevel.findMany({ where: { warehouseId: wh.id, variantId: { in: b.cart.lines.map((l) => l.variantId) } } });
    const free = new Map(levels.map((l) => [l.variantId, l.quantity - l.reserved]));
    const wanted = new Map<string, number>();
    for (const l of b.cart.lines) wanted.set(l.variantId, (wanted.get(l.variantId) ?? 0) + l.quantity);
    return {
      lines: b.cart.lines.map((l) => ({
        variantId: l.variantId, sku: l.sku, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal,
        available: Math.max(0, free.get(l.variantId) ?? 0) >= (wanted.get(l.variantId) ?? 0),
        lens: l.lens && { lensTypeName: l.lens.lensTypeName, lensEntryName: l.lens.lensEntryName, treatments: l.lens.treatments.map((t) => t.name), lensPrice: l.lens.lensPrice, treatmentsPrice: l.lens.treatmentsPrice },
      })),
      ...b.totals, hasLens: b.cart.hasLens,
      coupon: b.coupon ? (b.coupon.ok ? { code: b.coupon.code, discount: fromCents(b.coupon.discountCents), freeShipping: b.coupon.freeShipping } : { error: b.coupon.reason }) : null,
      fulfillment: b.fulfillment, storeId: b.store.id, shippingOptions: b.options, shippingMethodId: b.shipping?.id ?? null, undeliverable: b.undeliverable,
    };
  }

  // ------------------------------------------------------------------ place order
  async place(dto: D.CheckoutDto, user: AuthUser | null) {
    const store0 = await this.fulfilmentStore(dto);
    if (dto.clientRef) {
      const existing = await this.prisma.raw.order.findFirst({ where: { storeId: store0.id, clientRef: dto.clientRef, deletedAt: null } });
      if (existing) return { ...(await this.summary(existing.id)), replayed: true };
    }
    const b = await this.build(dto, user);
    const { store, cart, totals } = b;
    if (b.coupon && !b.coupon.ok) throw new BadRequestException({ code: b.coupon.reason, message: 'This coupon cannot be used' });
    if (b.fulfillment === 'DELIVERY') {
      if (!dto.address) throw new BadRequestException({ code: 'ADDRESS_REQUIRED', message: 'A delivery address is required' });
      if (b.undeliverable || !b.shipping) throw new BadRequestException({ code: 'NOT_DELIVERABLE', message: 'We do not deliver to this city' });
    }
    const method = await this.prisma.db.paymentMethodConfig.findFirst({ where: { code: dto.paymentMethod, isActive: true, availableOnline: true } });
    if (!method || !ONLINE_TYPES.includes(method.type)) throw new BadRequestException({ code: 'INVALID_PAYMENT_METHOD', message: 'Unknown or unavailable payment method' });
    const provider = method.type === 'ONLINE_PROVIDER' || method.type === 'CARD' ? this.providers.get(method.provider) : null;
    if ((method.type === 'ONLINE_PROVIDER' || method.type === 'CARD') && !provider) throw new BadRequestException({ code: 'PAYMENT_PROVIDER_UNAVAILABLE', message: 'This payment method is not available right now' });
    if (!b.customerId && !dto.contact) throw new BadRequestException({ code: 'CONTACT_REQUIRED', message: 'Your name, email and phone are required' });

    const wh = await this.orders.defaultWarehouse(store.id);
    const allowNegative = false;
    try {
      const out = await this.prisma.raw.$transaction(async (tx) => {
        const customerId = b.customerId ?? (await this.guestCustomer(tx, dto.contact!));
        // coupon: re-validate under a row lock so two simultaneous orders cannot both take the last use
        let couponId: string | null = null;
        if (b.coupon?.ok) {
          await tx.$queryRaw`SELECT id FROM "Coupon" WHERE id = ${b.coupon.id} FOR UPDATE`;
          const again = await this.checkCoupon(b.coupon.code, cart, customerId, tx);
          if (!again.ok) throw new BadRequestException({ code: again.reason, message: 'This coupon cannot be used' });
          couponId = again.id;
        }
        const number = await this.numbering.next(tx, store.id, 'ORDER');
        const address = dto.address && b.fulfillment === 'DELIVERY' ? { ...dto.address, country: 'MA' } : null;
        const order = await tx.order.create({
          data: {
            storeId: store.id, number, channel: 'ONLINE', status: 'PENDING', paymentStatus: 'UNPAID', fulfillment: b.fulfillment === 'DELIVERY' ? 'DELIVERY' : 'PICKUP', customerId, couponId,
            shippingMethodId: b.shipping?.id ?? null, currency: store.currency, subtotal: totals.subtotal, discountTotal: totals.discountTotal, taxTotal: totals.taxTotal, shippingTotal: totals.shippingTotal, total: totals.total, balanceDue: totals.total,
            shippingAddress: address as any, billingAddress: address as any, customerNote: dto.note, placedAt: new Date(), clientRef: dto.clientRef,
          },
        });
        const lensLines: Parameters<typeof createJobsForOrder>[2]['lines'] = [];
        for (const [i, l] of cart.lines.entries()) {
          const line = await tx.orderLine.create({
            data: {
              orderId: order.id, variantId: l.variantId, sku: l.sku, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost, discount: l.discount, taxRateId: l.taxRateId, taxRatePct: l.taxRatePct, taxAmount: l.taxAmount, lineTotal: l.lineTotal, sortOrder: i,
              ...(l.lens && { lensConfig: { create: { lensTypeId: l.lens.lensTypeId, lensEntryId: l.lens.lensEntryId, prescriptionId: l.lens.prescriptionId, prescriptionSnapshot: l.lens.prescriptionSnapshot as any, lensPrice: l.lens.lensPrice, treatmentsPrice: l.lens.treatmentsPrice, notes: l.lens.notes, treatments: { create: l.lens.treatments } } } }),
            },
          });
          await this.stock.move(tx, { storeId: store.id, variantId: l.variantId, warehouseId: wh.id, type: 'SALE', quantity: -l.quantity, unitCost: l.unitCost ?? undefined, refType: 'Order', refId: order.id, note: number, allowNegative });
          if (l.lens) lensLines.push({ lineId: line.id, variantId: l.variantId, description: l.description, lens: l.lens });
        }
        if (lensLines.length) await createJobsForOrder(tx, this.numbering, { orderId: order.id, storeId: store.id, customerId, userId: null, defaultDays: await this.settings.value<number>('default_days', 5, store.id), lines: lensLines });

        const invoice = await this.orders.createInvoice(tx, { orderId: order.id, storeId: store.id, customerId, cart: { ...cart, taxTotal: totals.taxTotal, total: totals.total }, number: await this.numbering.next(tx, store.id, 'INVOICE') });
        if (toCents(totals.shippingTotal) > 0) {
          await tx.invoiceLine.create({ data: { invoiceId: invoice.id, description: b.shipping!.name, quantity: 1, unitPrice: totals.shippingTotal, discount: 0, taxRatePct: 0, taxAmount: fromCents(b.shipTaxCents), lineTotal: totals.shippingTotal, sortOrder: cart.lines.length } });
        }
        if (couponId) {
          await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
          await tx.couponRedemption.create({ data: { couponId, orderId: order.id, customerId, amount: totals.discountTotal } });
        }
        if (b.fulfillment === 'DELIVERY') await tx.shipment.create({ data: { orderId: order.id, shippingMethodId: b.shipping!.id, status: 'PENDING', address: address as any } });

        let redirectUrl: string | undefined;
        let confirmed = method.type === 'CASH_ON_DELIVERY'; // pay on delivery / at the store: the order is accepted now, the money comes later
        if (provider) {
          const r = await provider.charge({ orderId: order.id, number, amount: totals.total, currency: store.currency, config: (method.config ?? {}) as Record<string, unknown> });
          if (r.status === 'CAPTURED') {
            await tx.payment.create({ data: { storeId: store.id, orderId: order.id, invoiceId: invoice.id, customerId, methodId: method.id, kind: 'PAYMENT', status: 'CAPTURED', amount: totals.total, currency: store.currency, providerTransactionId: r.transactionId, providerPayload: r.payload as any } });
            confirmed = true;
          } else redirectUrl = r.redirectUrl;
        }
        await this.orders.recalc(tx, order.id);
        if (confirmed) await tx.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } });
        return { id: order.id, redirectUrl, customerId };
      });

      const summary = await this.summary(out.id);
      await this.confirmationEmail(out.customerId, summary.number, dto.locale).catch(() => undefined);
      return { ...summary, redirectUrl: out.redirectUrl ?? null, paymentInstructions: method.type === 'BANK_TRANSFER' ? await this.settings.value<string | null>('bank_transfer_instructions', null) : null };
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002' && dto.clientRef) {
        const existing = await this.prisma.raw.order.findFirst({ where: { storeId: store.id, clientRef: dto.clientRef, deletedAt: null } });
        if (existing) return { ...(await this.summary(existing.id)), replayed: true };
      }
      throw e;
    }
  }

  private async guestCustomer(tx: Tx, c: D.ContactDto) {
    const email = c.email.trim().toLowerCase();
    const found = await tx.customer.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, phone: c.phone, userId: null, deletedAt: null } });
    if (found) return found.id;
    return (await tx.customer.create({ data: { firstName: c.firstName.trim(), lastName: c.lastName.trim(), email, phone: c.phone, source: 'ONLINE' } })).id;
  }

  private async confirmationEmail(customerId: string | null, number: string, locale = 'fr') {
    if (!customerId) return;
    const c = await this.prisma.raw.customer.findUnique({ where: { id: customerId } });
    if (c?.email) await this.mail.add('order_confirmation', { to: c.email, template: 'order_confirmation', locale, data: { firstName: c.firstName, orderNumber: number } });
  }

  /** Customer-safe view of an order. */
  async summary(orderId: string) {
    const o = await this.prisma.raw.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        lines: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' }, select: { description: true, quantity: true, unitPrice: true, discount: true, lineTotal: true } },
        shipments: { where: { deletedAt: null }, select: { carrier: true, trackingNumber: true, trackingUrl: true, status: true, shippedAt: true, deliveredAt: true } },
        jobOrders: { where: { deletedAt: null }, select: { number: true, status: true, promisedAt: true, readyAt: true } },
      },
    });
    const store = await this.prisma.raw.store.findUnique({ where: { id: o.storeId }, select: { name: true, address: true, city: true, phone: true } });
    const n = (v: unknown) => Number(v);
    return {
      id: o.id, number: o.number, status: o.status, paymentStatus: o.paymentStatus, fulfillment: o.fulfillment, placedAt: o.placedAt, currency: o.currency,
      subtotal: n(o.subtotal), discountTotal: n(o.discountTotal), shippingTotal: n(o.shippingTotal), taxTotal: n(o.taxTotal), total: n(o.total), paidTotal: n(o.paidTotal), balanceDue: n(o.balanceDue),
      store, shippingAddress: o.shippingAddress,
      lines: o.lines.map((l) => ({ ...l, unitPrice: n(l.unitPrice), discount: n(l.discount), lineTotal: n(l.lineTotal) })),
      shipments: o.shipments, workshop: o.jobOrders.map((j) => ({ number: j.number, status: j.status, promisedAt: j.promisedAt, readyAt: j.readyAt })),
    };
  }

  /** Public tracking: the order number AND the email/phone it was placed with must both match (the number alone is guessable). */
  async track(dto: D.TrackDto) {
    const number = dto.number.trim();
    const contact = dto.contact.trim().toLowerCase();
    const digits = contact.replace(/\D/g, '');
    const o = await this.prisma.raw.order.findFirst({ where: { number: { equals: number, mode: 'insensitive' }, deletedAt: null }, include: { customer: true } });
    const ok = !!o?.customer && ((o.customer.email ?? '').toLowerCase() === contact || (digits.length >= 6 && (o.customer.phone ?? '').replace(/\D/g, '') === digits));
    if (!o || !ok) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'No order matches these details' });
    return this.summary(o.id);
  }
}
