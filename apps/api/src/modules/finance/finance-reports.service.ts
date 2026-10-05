import { Injectable } from '@nestjs/common';
import { fromCents, toCents } from '@mizmar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import * as D from './finance.dto';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const endOfDay = (s: string) => new Date(`${s}T23:59:59.999Z`);
const cents = (v: unknown) => toCents(Number(v ?? 0));
const bucket = (d: Date, by: 'day' | 'month') => d.toISOString().slice(0, by === 'month' ? 7 : 10);

/** Read-only money views for accountants: cash flow, VAT, payments, credit notes, headline numbers. */
@Injectable()
export class FinanceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private stores(user: AuthUser, storeId?: string) { return storeId ? (assertStoreAccess(user, storeId), [storeId]) : visibleStoreIds(user); }

  /**
   * Cash flow assembled from where the money actually moved: customer payments (in), refunds, supplier payments, and the ledger of
   * expenses / payroll / manual entries (out or in). Nothing is copied into a second table, so it can never drift from the source.
   */
  async cashFlow(dto: D.RangeDto, user: AuthUser) {
    const stores = this.stores(user, dto.storeId);
    const by = dto.groupBy ?? 'day';
    const scope = stores ? { storeId: { in: stores } } : {};
    const range = (field: string) => ({ [field]: { gte: day(dto.from), lte: endOfDay(dto.to) } });
    const onlyAccount = !!dto.bankAccountId; // customer payments are not tied to an account, so an account view shows only account movements
    const [pays, refunds, supp, ledger] = await Promise.all([
      onlyAccount ? [] : this.prisma.db.payment.findMany({ where: { ...scope, status: 'CAPTURED', kind: { in: ['PAYMENT', 'DEPOSIT'] }, ...range('paidAt') }, select: { paidAt: true, amount: true }, take: 50_000 }),
      onlyAccount ? [] : this.prisma.db.refund.findMany({ where: { ...scope, status: 'CAPTURED', ...range('refundedAt') }, select: { refundedAt: true, amount: true }, take: 50_000 }),
      this.prisma.db.supplierPayment.findMany({ where: { ...scope, status: 'CAPTURED', ...(dto.bankAccountId && { bankAccountId: dto.bankAccountId }), ...range('paidAt') }, select: { paidAt: true, amount: true }, take: 50_000 }),
      this.prisma.db.cashFlowEntry.findMany({ where: { ...scope, ...(dto.bankAccountId && { bankAccountId: dto.bankAccountId }), ...range('occurredAt') }, select: { occurredAt: true, amount: true, direction: true, source: true }, take: 50_000 }),
    ]);
    const series = new Map<string, { key: string; in: number; out: number }>();
    const sources = new Map<string, { source: string; direction: 'IN' | 'OUT'; amount: number }>();
    const add = (at: Date, direction: 'IN' | 'OUT', amount: unknown, source: string) => {
      const c = cents(amount), k = bucket(at, by);
      const s = series.get(k) ?? { key: k, in: 0, out: 0 };
      if (direction === 'IN') s.in += c; else s.out += c;
      series.set(k, s);
      const sk = `${source}|${direction}`, x = sources.get(sk) ?? { source, direction, amount: 0 };
      x.amount += c; sources.set(sk, x);
    };
    pays.forEach((p) => add(p.paidAt, 'IN', p.amount, 'SALES'));
    refunds.forEach((r) => add(r.refundedAt, 'OUT', r.amount, 'REFUNDS'));
    supp.forEach((s) => add(s.paidAt, 'OUT', s.amount, 'SUPPLIERS'));
    ledger.forEach((l) => add(l.occurredAt, l.direction, l.amount, l.source));
    const rows = [...series.values()].sort((a, b) => a.key.localeCompare(b.key)).map((s) => ({ key: s.key, in: fromCents(s.in), out: fromCents(s.out), net: fromCents(s.in - s.out) }));
    const totalIn = rows.reduce((n, r) => n + toCents(r.in), 0), totalOut = rows.reduce((n, r) => n + toCents(r.out), 0);
    return { from: dto.from, to: dto.to, groupBy: by, totals: { in: fromCents(totalIn), out: fromCents(totalOut), net: fromCents(totalIn - totalOut) }, series: rows, bySource: [...sources.values()].map((s) => ({ ...s, amount: fromCents(s.amount) })).sort((a, b) => b.amount - a.amount) };
  }

  /** VAT collected on sales (net of credit notes) against VAT recoverable on supplier invoices and expenses. */
  async vat(dto: D.RangeDto, user: AuthUser) {
    const stores = this.stores(user, dto.storeId);
    const scope = stores ? { storeId: { in: stores } } : {};
    const inv = { ...scope, status: { not: 'VOID' as const }, deletedAt: null, issuedAt: { gte: day(dto.from), lte: endOfDay(dto.to) } };
    const [lines, credits, supplierInv, expenses] = await Promise.all([
      this.prisma.db.invoiceLine.groupBy({ by: ['taxRatePct'], where: { invoice: inv }, _sum: { taxAmount: true, lineTotal: true } }),
      this.prisma.db.creditNote.aggregate({ where: { ...scope, status: { in: ['ISSUED', 'APPLIED'] as ('ISSUED' | 'APPLIED')[] }, issuedAt: { gte: day(dto.from), lte: endOfDay(dto.to) } }, _sum: { taxTotal: true, total: true } }),
      this.prisma.db.supplierInvoice.aggregate({ where: { ...scope, status: { not: 'VOID' }, issuedAt: { gte: day(dto.from), lte: endOfDay(dto.to) } }, _sum: { taxTotal: true, subtotal: true } }),
      this.prisma.db.expense.aggregate({ where: { ...scope, status: { in: ['APPROVED', 'PAID'] }, incurredAt: { gte: day(dto.from), lte: endOfDay(dto.to) } }, _sum: { taxAmount: true, amount: true } }),
    ]);
    const byRate = lines.map((l) => ({ ratePct: Number(l.taxRatePct ?? 0), taxableBase: fromCents(cents(l._sum.lineTotal) - cents(l._sum.taxAmount)), vat: fromCents(cents(l._sum.taxAmount)) })).sort((a, b) => b.ratePct - a.ratePct);
    const collectedGross = byRate.reduce((n, r) => n + toCents(r.vat), 0);
    const creditVat = cents(credits._sum.taxTotal);
    const collected = collectedGross - creditVat;
    const deductible = cents(supplierInv._sum.taxTotal) + cents(expenses._sum.taxAmount);
    return {
      from: dto.from, to: dto.to, byRate, collectedBeforeCredits: fromCents(collectedGross), creditNotes: fromCents(creditVat), collected: fromCents(collected),
      deductible: { supplierInvoices: Number(supplierInv._sum.taxTotal ?? 0), expenses: Number(expenses._sum.taxAmount ?? 0), total: fromCents(deductible) },
      due: fromCents(collected - deductible), note: 'Indicative: confirm the filing figures with your accountant.',
    };
  }

  async payments(dto: D.ListPaymentsDto, user: AuthUser) {
    const stores = this.stores(user, dto.storeId);
    const where = { ...(stores && { storeId: { in: stores } }), ...(dto.methodId && { methodId: dto.methodId }), ...(dto.kind && { kind: dto.kind }), ...((dto.from || dto.to) && { paidAt: { ...(dto.from && { gte: day(dto.from) }), ...(dto.to && { lte: endOfDay(dto.to) }) } }) };
    return paginate(this.prisma.db.payment, dto, { where, include: { method: { select: { id: true, name: true, type: true } }, order: { select: { id: true, number: true, channel: true } }, customer: { select: { id: true, firstName: true, lastName: true } } }, sortable: ['paidAt', 'amount'], defaultSort: 'paidAt' });
  }

  async paymentsByMethod(dto: D.RangeDto, user: AuthUser) {
    const stores = this.stores(user, dto.storeId);
    const rows = await this.prisma.db.payment.groupBy({ by: ['methodId'], where: { ...(stores && { storeId: { in: stores } }), status: 'CAPTURED', kind: { in: ['PAYMENT', 'DEPOSIT'] }, paidAt: { gte: day(dto.from), lte: endOfDay(dto.to) } }, _sum: { amount: true }, _count: { _all: true } });
    const methods = new Map((await this.prisma.db.paymentMethodConfig.findMany({ select: { id: true, name: true, type: true } })).map((m) => [m.id, m]));
    return rows.map((r) => ({ methodId: r.methodId, name: methods.get(r.methodId)?.name ?? '—', type: methods.get(r.methodId)?.type, count: r._count._all, amount: Number(r._sum.amount ?? 0) })).sort((a, b) => b.amount - a.amount);
  }

  async creditNotes(dto: D.ListCreditNotesDto, user: AuthUser) {
    const stores = this.stores(user, dto.storeId);
    const where = { ...(stores && { storeId: { in: stores } }), ...((dto.from || dto.to) && { createdAt: { ...(dto.from && { gte: day(dto.from) }), ...(dto.to && { lte: endOfDay(dto.to) }) } }) };
    return paginate(this.prisma.db.creditNote, dto, { where, include: { customer: { select: { id: true, firstName: true, lastName: true } }, invoice: { select: { id: true, number: true } } }, sortable: ['createdAt', 'total', 'number'], defaultSort: 'createdAt' });
  }

  /** Headline numbers for the finance page: this month's cash, what customers owe, what we owe, spending and VAT. */
  async summary(user: AuthUser, storeId?: string) {
    const stores = this.stores(user, storeId);
    const scope = stores ? { storeId: { in: stores } } : {};
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10), to = now.toISOString().slice(0, 10);
    const range = { from, to, storeId, groupBy: 'month' as const };
    const [cash, vat, receivable, payable, spend] = await Promise.all([
      this.cashFlow(range, user), this.vat(range, user),
      this.prisma.db.order.aggregate({ where: { ...scope, status: { notIn: ['CANCELLED', 'DRAFT'] }, balanceDue: { gt: 0 } }, _sum: { balanceDue: true }, _count: { _all: true } }),
      this.prisma.db.supplierInvoice.findMany({ where: { ...scope, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } }, select: { total: true, paidTotal: true, dueAt: true } }),
      this.prisma.db.expense.aggregate({ where: { ...scope, status: { in: ['APPROVED', 'PAID'] }, incurredAt: { gte: day(from), lte: endOfDay(to) } }, _sum: { amount: true } }),
    ]);
    const owed = payable.reduce((n, i) => n + cents(i.total) - cents(i.paidTotal), 0);
    const overdue = payable.filter((i) => i.dueAt && i.dueAt < day(to)).reduce((n, i) => n + cents(i.total) - cents(i.paidTotal), 0);
    return {
      period: { from, to }, cash: cash.totals, receivables: { amount: Number(receivable._sum.balanceDue ?? 0), orders: receivable._count._all },
      payables: { amount: fromCents(owed), overdue: fromCents(overdue), invoices: payable.length }, expenses: Number(spend._sum.amount ?? 0), vatDue: vat.due,
    };
  }
}
