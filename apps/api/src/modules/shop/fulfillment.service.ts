import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { fromCents, toCents } from '@mizmar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { assertStoreAccess } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { OrdersService } from '../sales/orders.service';
import { deliverJobsForOrder, notReadyJobs } from '../workshop/workshop.jobs';
import { ShopCheckoutService } from './shop-checkout.service';
import * as D from './shop.dto';

/** Staff-side handling of ONLINE orders: confirm a transfer, ship, hand to the courier, mark delivered, call for pickup. */
@Injectable()
export class FulfillmentService {
  constructor(private readonly prisma: PrismaService, private readonly orders: OrdersService, private readonly checkout: ShopCheckoutService, @InjectQueue('mail') private readonly mail: Queue) {}

  private async online(id: string, user: AuthUser) {
    const o = await this.prisma.db.order.findFirst({ where: { id, channel: 'ONLINE' } });
    if (!o) throw new NotFoundException('Online order not found');
    assertStoreAccess(user, o.storeId);
    return o;
  }

  /** Records money received outside the till (bank transfer, cheque, courier remittance). No drawer is involved, so no register session is needed. */
  async confirmPayment(id: string, dto: D.ConfirmPaymentDto, user: AuthUser) {
    const o0 = await this.online(id, user);
    const method = await this.prisma.db.paymentMethodConfig.findFirst({ where: { id: dto.methodId, isActive: true } });
    if (!method || method.type === 'CASH') throw new BadRequestException({ code: 'INVALID_PAYMENT_METHOD', message: 'Cash must be taken at the till; pick another method' });
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const o = await tx.order.findUniqueOrThrow({ where: { id } });
      if (o.status === 'CANCELLED') throw new ConflictException({ code: 'INVALID_STATE', message: 'Order is cancelled' });
      const due = toCents(Number(o.balanceDue));
      if (due <= 0) throw new ConflictException({ code: 'NOTHING_DUE', message: 'This order is already fully paid' });
      const amount = dto.amount ?? fromCents(due);
      if (toCents(amount) > due) throw new BadRequestException({ code: 'OVERPAYMENT', message: 'Amount exceeds the balance due', details: { due: fromCents(due) } });
      const invoice = await tx.invoice.findFirst({ where: { orderId: id, deletedAt: null, status: { not: 'VOID' } } });
      await tx.payment.create({ data: { storeId: o.storeId, orderId: id, invoiceId: invoice?.id, customerId: o.customerId, methodId: method.id, kind: toCents(amount) < due ? 'DEPOSIT' : 'PAYMENT', status: 'CAPTURED', amount, currency: o.currency, reference: dto.reference, receivedById: user.id } });
      await this.orders.recalc(tx, id);
      if (o.status === 'PENDING') await tx.order.update({ where: { id }, data: { status: 'CONFIRMED' } });
    });
    void o0;
    return this.checkout.summary(id);
  }

  async ship(id: string, dto: D.ShipDto, user: AuthUser) {
    const o = await this.online(id, user);
    if (o.fulfillment !== 'DELIVERY') throw new ConflictException({ code: 'INVALID_STATE', message: 'This order is for pickup' });
    if (!['CONFIRMED', 'PROCESSING'].includes(o.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `A ${o.status} order cannot be shipped` });
    await this.prisma.raw.$transaction(async (tx) => {
      const waiting = await notReadyJobs(tx, id);
      if (waiting.length) throw new ConflictException({ code: 'JOBS_NOT_READY', message: 'The workshop has not finished every pair yet', details: { jobs: waiting } });
      await deliverJobsForOrder(tx, id, user.id); // the pairs leave with the parcel
      const ship = await tx.shipment.findFirst({ where: { orderId: id, deletedAt: null } });
      const data = { carrier: dto.carrier, trackingNumber: dto.trackingNumber, trackingUrl: dto.trackingUrl, status: 'IN_TRANSIT' as const, shippedAt: new Date() };
      if (ship) await tx.shipment.update({ where: { id: ship.id }, data }); else await tx.shipment.create({ data: { orderId: id, shippingMethodId: o.shippingMethodId, address: o.shippingAddress as any, ...data } });
      await tx.order.update({ where: { id }, data: { status: 'SHIPPED' } });
    });
    return this.checkout.summary(id);
  }

  async delivered(id: string, dto: D.DeliveredDto, user: AuthUser) {
    const o = await this.online(id, user);
    if (o.status !== 'SHIPPED') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only a shipped order can be marked delivered' });
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.shipment.updateMany({ where: { orderId: id, deletedAt: null }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      const fresh = await tx.order.findUniqueOrThrow({ where: { id } });
      if (dto.collected && toCents(Number(fresh.balanceDue)) > 0) {
        const cod = await tx.paymentMethodConfig.findFirst({ where: { type: 'CASH_ON_DELIVERY', isActive: true } });
        if (!cod) throw new ConflictException({ code: 'INVALID_PAYMENT_METHOD', message: 'No cash-on-delivery method is configured' });
        const invoice = await tx.invoice.findFirst({ where: { orderId: id, deletedAt: null, status: { not: 'VOID' } } });
        await tx.payment.create({ data: { storeId: fresh.storeId, orderId: id, invoiceId: invoice?.id, customerId: fresh.customerId, methodId: cod.id, kind: 'PAYMENT', status: 'CAPTURED', amount: fresh.balanceDue, currency: fresh.currency, receivedById: user.id, note: 'Collected by the courier' } });
        await this.orders.recalc(tx, id);
      }
      const after = await tx.order.findUniqueOrThrow({ where: { id } });
      const settled = toCents(Number(after.balanceDue)) === 0;
      await tx.order.update({ where: { id }, data: settled ? { status: 'COMPLETED', completedAt: new Date() } : { status: 'DELIVERED' } });
    });
    return this.checkout.summary(id);
  }

  /** Pickup orders: tell the customer their order waits at the store. (Hand-over itself is the till's `orders/:id/deliver`.) */
  async readyForPickup(id: string, user: AuthUser) {
    const o = await this.online(id, user);
    if (o.fulfillment !== 'PICKUP') throw new ConflictException({ code: 'INVALID_STATE', message: 'This order is for delivery' });
    if (!['CONFIRMED', 'PROCESSING'].includes(o.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `A ${o.status} order cannot be called for pickup` });
    await this.prisma.raw.$transaction(async (tx) => {
      const waiting = await notReadyJobs(tx, id);
      if (waiting.length) throw new ConflictException({ code: 'JOBS_NOT_READY', message: 'The workshop has not finished every pair yet', details: { jobs: waiting } });
      await tx.order.update({ where: { id }, data: { status: 'READY' } });
    });
    const c = o.customerId ? await this.prisma.raw.customer.findUnique({ where: { id: o.customerId } }) : null;
    const store = await this.prisma.raw.store.findUnique({ where: { id: o.storeId } });
    if (c?.email) await this.mail.add('order_ready', { to: c.email, template: 'order_ready', data: { firstName: c.firstName, orderNumber: o.number, storeName: store?.name ?? '' } }).catch(() => undefined);
    return this.checkout.summary(id);
  }
}
