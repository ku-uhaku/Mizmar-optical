import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { SettingsService } from '../settings/settings.service';
import { toCents, fromCents } from '@mizmar/shared';
import type { CashMovementDto, CloseSessionDto, ListSessionsDto, OpenSessionDto } from './pos.dto';

type CashType = 'SALE' | 'DEPOSIT' | 'REFUND' | 'CASH_IN' | 'CASH_OUT';
const sumCents = (xs: { amount: unknown }[]) => xs.reduce((n, x) => n + toCents(Number(x.amount)), 0);

/** UTC offset (minutes) of `tz` at instant `d`. */
function tzOffsetMinutes(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime()) / 60000;
}
/** [start, end) instants of the local calendar day `date` (YYYY-MM-DD) in `tz`. */
export function dayRange(date: string, tz: string): [Date, Date] {
  const at = (iso: string) => { const base = new Date(`${iso}T00:00:00Z`); return new Date(base.getTime() - tzOffsetMinutes(base, tz) * 60000); };
  const next = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  return [at(date), at(next)];
}

export interface PaymentTotals { methodId: string; name: string; type: string; received: number; refunded: number; net: number }

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  // ---------------------------------------------------------------- lookups used by checkout / refunds
  currentFor(user: AuthUser, storeId: string) {
    return this.prisma.db.cashSession.findFirst({ where: { storeId, openedById: user.id, status: 'OPEN' }, include: { register: { select: { id: true, code: true, name: true } } } });
  }

  /** The session a sale must be attached to. With `pos.require_open_session` (default on) a sale without one is refused. */
  async requireForSale(user: AuthUser, storeId: string) {
    const session = await this.currentFor(user, storeId);
    if (!session && (await this.settings.value('require_open_session', true, storeId))) {
      throw new ConflictException({ code: 'NO_OPEN_SESSION', message: 'Open a cash register session before selling' });
    }
    return session;
  }

  /** Cash currently in the drawer (cents): opening float plus every signed movement. */
  async availableCash(tx: Pick<Tx, 'cashMovement' | 'cashSession'>, sessionId: string) {
    const s = await tx.cashSession.findUniqueOrThrow({ where: { id: sessionId } });
    return this.expectedCash(tx, sessionId, Number(s.openingFloat));
  }

  /** Cash drawer entry inside the caller's transaction. Amount is SIGNED from the drawer's point of view. */
  recordCash(tx: Tx, p: { sessionId: string; type: CashType; amount: number; paymentId?: string; methodId?: string; reason?: string; actorId: string }) {
    return tx.cashMovement.create({ data: { sessionId: p.sessionId, type: p.type, amount: p.amount, paymentId: p.paymentId, methodId: p.methodId, reason: p.reason, actorId: p.actorId } });
  }

  // ---------------------------------------------------------------- open / movements / close
  async open(dto: OpenSessionDto, user: AuthUser) {
    const register = await this.prisma.db.cashRegister.findFirst({ where: { id: dto.registerId } });
    if (!register || !register.isActive) throw new BadRequestException('Unknown or inactive register');
    assertStoreAccess(user, register.storeId);
    const id = await this.prisma.raw.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CashRegister" WHERE id = ${register.id} FOR UPDATE`; // serialise concurrent opens of one drawer
      if (await tx.cashSession.findFirst({ where: { registerId: register.id, status: 'OPEN', deletedAt: null } })) throw new ConflictException({ code: 'REGISTER_BUSY', message: 'This register already has an open session' });
      if (await tx.cashSession.findFirst({ where: { storeId: register.storeId, openedById: user.id, status: 'OPEN', deletedAt: null } })) throw new ConflictException({ code: 'ALREADY_OPEN', message: 'You already have an open session in this store' });
      return (await tx.cashSession.create({ data: { registerId: register.id, storeId: register.storeId, openedById: user.id, openingFloat: dto.openingFloat } })).id;
    });
    return this.report(id, user);
  }

  private async mustGet(id: string, user: AuthUser) {
    const s = await this.prisma.db.cashSession.findFirst({ where: { id }, include: { register: { select: { id: true, code: true, name: true } } } });
    if (!s) throw new NotFoundException('Session not found');
    assertStoreAccess(user, s.storeId);
    return s;
  }

  async movement(id: string, dto: CashMovementDto, user: AuthUser) {
    const s = await this.mustGet(id, user);
    this.assertCanUse(s, user);
    if (s.status !== 'OPEN') throw new ConflictException({ code: 'SESSION_CLOSED', message: 'Session is closed' });
    if (dto.amount <= 0) throw new BadRequestException('amount must be greater than 0');
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CashSession" WHERE id = ${id} FOR UPDATE`;
      if (dto.type === 'CASH_OUT') {
        const expected = await this.expectedCash(tx, id, Number(s.openingFloat));
        if (toCents(dto.amount) > expected) throw new BadRequestException({ code: 'INSUFFICIENT_CASH', message: 'Not enough cash in the drawer', details: { available: fromCents(expected) } });
      }
      await this.recordCash(tx, { sessionId: id, type: dto.type, amount: dto.type === 'CASH_OUT' ? -dto.amount : dto.amount, reason: dto.reason, actorId: user.id });
    });
    return this.report(id, user);
  }

  private async expectedCash(tx: Pick<Tx, 'cashMovement'>, sessionId: string, openingFloat: number) {
    const ms = await tx.cashMovement.findMany({ where: { sessionId, deletedAt: null }, select: { amount: true } });
    return toCents(openingFloat) + sumCents(ms);
  }

  async close(id: string, dto: CloseSessionDto, user: AuthUser) {
    const s = await this.mustGet(id, user);
    this.assertCanUse(s, user);
    if (s.status !== 'OPEN') throw new ConflictException({ code: 'SESSION_CLOSED', message: 'Session is already closed' });
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CashSession" WHERE id = ${id} FOR UPDATE`;
      const expected = await this.expectedCash(tx, id, Number(s.openingFloat));
      const counted = toCents(dto.countedCash);
      const report = await this.buildReport(tx as any, id, { countedCash: dto.countedCash, expectedCents: expected });
      await tx.cashSession.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date(), closedById: user.id, expectedCash: fromCents(expected), countedCash: dto.countedCash, variance: fromCents(counted - expected), notes: dto.notes, closingReport: report as any },
      });
    });
    return this.report(id, user);
  }

  // ---------------------------------------------------------------- reports
  /** Live report while open (an "X report"); the frozen snapshot once closed (the "Z report"). */
  async report(id: string, user: AuthUser) {
    const s = await this.mustGet(id, user);
    this.assertCanUse(s, user);
    if (s.status === 'CLOSED' && s.closingReport) return s.closingReport;
    return this.buildReport(this.prisma.raw, id);
  }

  async buildReport(db: PrismaService['raw'], id: string, closing?: { countedCash: number; expectedCents: number }) {
    const s = await db.cashSession.findUniqueOrThrow({ where: { id }, include: { register: { select: { id: true, code: true, name: true } } } });
    const [orders, payments, movements, opener, closer] = await Promise.all([
      db.order.findMany({ where: { cashSessionId: id, deletedAt: null }, select: { subtotal: true, discountTotal: true, taxTotal: true, total: true } }),
      db.payment.findMany({ where: { cashSessionId: id, deletedAt: null, status: 'CAPTURED' }, include: { method: { select: { id: true, name: true, type: true } } } }),
      db.cashMovement.findMany({ where: { sessionId: id, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
      db.user.findUnique({ where: { id: s.openedById }, select: { firstName: true, lastName: true } }),
      s.closedById ? db.user.findUnique({ where: { id: s.closedById }, select: { firstName: true, lastName: true } }) : null,
    ]);
    const byMethod = new Map<string, PaymentTotals>();
    for (const p of payments) {
      const t = byMethod.get(p.methodId) ?? { methodId: p.methodId, name: p.method.name, type: p.method.type, received: 0, refunded: 0, net: 0 };
      if (p.kind === 'REFUND') t.refunded += toCents(Number(p.amount)); else t.received += toCents(Number(p.amount));
      byMethod.set(p.methodId, t);
    }
    const methods = [...byMethod.values()].map((t) => ({ ...t, received: fromCents(t.received), refunded: fromCents(t.refunded), net: fromCents(t.received - t.refunded) }));
    const cents = (types: string[]) => sumCents(movements.filter((m) => types.includes(m.type)));
    const expected = closing?.expectedCents ?? toCents(Number(s.openingFloat)) + sumCents(movements);
    const counted = closing?.countedCash ?? (s.countedCash == null ? null : Number(s.countedCash));
    return {
      session: { id: s.id, status: closing ? 'CLOSED' : s.status, register: s.register, storeId: s.storeId, openedAt: s.openedAt, closedAt: closing ? new Date() : s.closedAt, openedBy: opener && `${opener.firstName} ${opener.lastName}`, closedBy: closer && `${closer.firstName} ${closer.lastName}`, notes: s.notes },
      sales: { orders: orders.length, gross: fromCents(sumCents(orders.map((o) => ({ amount: o.subtotal })))), discounts: fromCents(sumCents(orders.map((o) => ({ amount: o.discountTotal })))), tax: fromCents(sumCents(orders.map((o) => ({ amount: o.taxTotal })))), total: fromCents(sumCents(orders.map((o) => ({ amount: o.total })))) },
      payments: methods,
      cash: { openingFloat: Number(s.openingFloat), sales: fromCents(cents(['SALE', 'DEPOSIT'])), refunds: fromCents(cents(['REFUND'])), cashIn: fromCents(cents(['CASH_IN'])), cashOut: fromCents(cents(['CASH_OUT'])), expected: fromCents(expected), counted, variance: counted == null ? null : fromCents(toCents(counted) - expected) },
      movements: movements.filter((m) => m.type === 'CASH_IN' || m.type === 'CASH_OUT').map((m) => ({ type: m.type, amount: Number(m.amount), reason: m.reason, at: m.createdAt })),
    };
  }

  async list(dto: ListSessionsDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    return paginate(this.prisma.db.cashSession, dto, {
      where: { ...(stores && { storeId: { in: stores } }), ...(dto.status && { status: dto.status as any }) },
      include: { register: { select: { id: true, code: true, name: true } } }, sortable: ['openedAt', 'closedAt', 'variance'], defaultSort: 'openedAt',
    });
  }

  /** Whole-store, whole-day totals across all sessions (the "end of day" report). */
  async daily(storeId: string | undefined, date: string | undefined, user: AuthUser, activeStoreId?: string | null) {
    const sid = storeId ?? activeStoreId ?? user.defaultStoreId;
    if (!sid) throw new BadRequestException('storeId is required');
    assertStoreAccess(user, sid);
    const store = await this.prisma.db.store.findFirst({ where: { id: sid } });
    if (!store) throw new NotFoundException('Store not found');
    const day = date ?? new Intl.DateTimeFormat('en-CA', { timeZone: store.timezone }).format(new Date());
    const [from, to] = dayRange(day, store.timezone);
    const range = { gte: from, lt: to };
    const [orders, payments, returns, sessions] = await Promise.all([
      this.prisma.db.order.findMany({ where: { storeId: sid, channel: 'POS', placedAt: range, status: { not: 'CANCELLED' } }, select: { subtotal: true, discountTotal: true, taxTotal: true, total: true } }),
      this.prisma.db.payment.findMany({ where: { storeId: sid, paidAt: range, status: 'CAPTURED' }, include: { method: { select: { id: true, name: true, type: true } } } }),
      this.prisma.db.return.findMany({ where: { storeId: sid, createdAt: range }, select: { refundTotal: true } }),
      this.prisma.db.cashSession.findMany({ where: { storeId: sid, OR: [{ openedAt: range }, { closedAt: range }] }, include: { register: { select: { code: true, name: true } } }, orderBy: { openedAt: 'asc' } }),
    ]);
    const by = new Map<string, PaymentTotals>();
    for (const p of payments) {
      const t = by.get(p.methodId) ?? { methodId: p.methodId, name: p.method.name, type: p.method.type, received: 0, refunded: 0, net: 0 };
      if (p.kind === 'REFUND') t.refunded += toCents(Number(p.amount)); else t.received += toCents(Number(p.amount));
      by.set(p.methodId, t);
    }
    const money = (xs: { amount: unknown }[]) => fromCents(sumCents(xs));
    return {
      storeId: sid, storeName: store.name, date: day, timezone: store.timezone,
      sales: { orders: orders.length, gross: money(orders.map((o) => ({ amount: o.subtotal }))), discounts: money(orders.map((o) => ({ amount: o.discountTotal }))), tax: money(orders.map((o) => ({ amount: o.taxTotal }))), total: money(orders.map((o) => ({ amount: o.total }))) },
      returns: { count: returns.length, refunded: money(returns.map((r) => ({ amount: r.refundTotal }))) },
      payments: [...by.values()].map((t) => ({ ...t, received: fromCents(t.received), refunded: fromCents(t.refunded), net: fromCents(t.received - t.refunded) })),
      netCollected: fromCents([...by.values()].reduce((n, t) => n + t.received - t.refunded, 0)),
      sessions: sessions.map((s) => ({ id: s.id, register: s.register.name, status: s.status, openedAt: s.openedAt, closedAt: s.closedAt, expectedCash: s.expectedCash == null ? null : Number(s.expectedCash), countedCash: s.countedCash == null ? null : Number(s.countedCash), variance: s.variance == null ? null : Number(s.variance) })),
      unclosedSessions: sessions.filter((s) => s.status === 'OPEN').length,
    };
  }

  /** Only the opener or someone allowed to manage registers may act on a session (checked by the controller's permission). */
  assertCanUse(session: { openedById: string }, user: AuthUser) {
    if (session.openedById !== user.id && !user.isSuperAdmin && !user.permissions.includes('pos:manage_register')) throw new ForbiddenException('This session belongs to another cashier');
  }
}
