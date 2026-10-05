import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { fromCents, toCents } from '@mizmar/shared';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import { HrService } from './hr.service';
import { computePayslip, periodBounds, workingDaysBetween } from './payroll';
import * as D from './hr.dto';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const overlapDays = (aStart: Date, aEnd: Date, from: string, to: string) => {
  const s = aStart > day(from) ? aStart : day(from), e = aEnd < day(to) ? aEnd : day(to);
  return e < s ? null : { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
};

@Injectable()
export class CommissionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(dto: D.ListCommissionsDto, user: AuthUser) {
    const stores = visibleStoreIds(user);
    const where = { ...(dto.employeeId && { employeeId: dto.employeeId }), ...(dto.orderId && { orderId: dto.orderId }), ...(dto.periodKey && { periodKey: dto.periodKey }), ...(dto.status && { status: dto.status }), ...(stores && { employee: { OR: [{ storeId: { in: stores } }, { storeId: null }] } }) };
    return paginate(this.prisma.db.commissionEntry, dto, { where, include: { employee: { select: { id: true, firstName: true, lastName: true } }, rule: { select: { id: true, name: true } } }, sortable: ['createdAt', 'amount'] });
  }

  /**
   * Works out commission for the till sales of a month. Rules are additive (every matching rule pays). Returned items earn nothing: the
   * refunded value and quantity are taken off. Safe to re-run: unfinalised (PENDING) entries are rebuilt, approved/paid ones are kept.
   */
  async calculate(periodKey: string) {
    const { start, end } = periodBounds(periodKey);
    const from = day(start), to = new Date(day(end).getTime() + 86_400_000 - 1);
    const [rules, employees] = await Promise.all([
      this.prisma.raw.commissionRule.findMany({ where: { isActive: true, deletedAt: null, OR: [{ startsAt: null }, { startsAt: { lte: to } }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: from } }] }] } }),
      this.prisma.raw.employee.findMany({ where: { deletedAt: null, userId: { not: null } }, select: { id: true, userId: true } }),
    ]);
    const byUser = new Map(employees.map((e) => [e.userId!, e.id]));
    const orders = await this.prisma.raw.order.findMany({
      where: { channel: 'POS', deletedAt: null, status: { not: 'CANCELLED' }, placedAt: { gte: from, lte: to }, cashierId: { in: [...byUser.keys()] } },
      include: { lines: { where: { deletedAt: null }, include: { variant: { select: { product: { select: { type: true, brandId: true, categoryId: true } } } }, returnLines: { where: { deletedAt: null, return: { status: { not: 'REJECTED' } } }, select: { quantity: true, refundAmount: true } } } } },
    });
    const made: { employeeId: string; ruleId: string; orderId: string; baseAmount: number; amount: number }[] = [];
    for (const o of orders) {
      const employeeId = byUser.get(o.cashierId!)!;
      for (const rule of rules) {
        let base = 0, units = 0;
        for (const l of o.lines) {
          const p = l.variant?.product;
          const ok = rule.scope === 'ALL' || (p && ((rule.scope === 'CATEGORY' && rule.categoryId === p.categoryId) || (rule.scope === 'BRAND' && rule.brandId === p.brandId) || (rule.scope === 'PRODUCT_TYPE' && rule.productType === p.type)));
          if (!ok) continue;
          base += toCents(Number(l.lineTotal)) - l.returnLines.reduce((n, r) => n + toCents(Number(r.refundAmount)), 0);
          units += l.quantity - l.returnLines.reduce((n, r) => n + r.quantity, 0);
        }
        if (base <= 0 || units <= 0) continue;
        if (rule.minSale != null && base < toCents(Number(rule.minSale))) continue;
        const amount = rule.rateType === 'PERCENT' ? Math.round((base * Number(rule.value)) / 100) : toCents(Number(rule.value)) * units;
        if (amount > 0) made.push({ employeeId, ruleId: rule.id, orderId: o.id, baseAmount: fromCents(base), amount: fromCents(amount) });
      }
    }
    return this.prisma.raw.$transaction(async (tx) => {
      await tx.commissionEntry.deleteMany({ where: { periodKey, status: 'PENDING', payslipId: null } }); // rebuild what is not yet final
      const kept = await tx.commissionEntry.findMany({ where: { periodKey, status: { not: 'VOID' } }, select: { orderId: true, ruleId: true, employeeId: true } });
      const have = new Set(kept.map((k) => `${k.employeeId}|${k.orderId}|${k.ruleId}`));
      const fresh = made.filter((m) => !have.has(`${m.employeeId}|${m.orderId}|${m.ruleId}`));
      if (fresh.length) await tx.commissionEntry.createMany({ data: fresh.map((m) => ({ ...m, periodKey, status: 'PENDING' as const })) });
      return { created: fresh.length, total: fromCents(fresh.reduce((n, m) => n + toCents(m.amount), 0)) };
    });
  }

  async approve(periodKey: string) {
    const r = await this.prisma.raw.commissionEntry.updateMany({ where: { periodKey, status: 'PENDING', deletedAt: null }, data: { status: 'APPROVED' } });
    return { approved: r.count };
  }

  async void(id: string) {
    const e = await this.prisma.db.commissionEntry.findFirst({ where: { id } });
    if (!e) throw new NotFoundException('Commission not found');
    if (e.status === 'PAID' || e.payslipId) throw new ConflictException({ code: 'ALREADY_PAID', message: 'This commission is already on a payslip' });
    return this.prisma.raw.commissionEntry.update({ where: { id }, data: { status: 'VOID' } });
  }
}

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly hr: HrService) {}

  list(dto: D.ListRunsDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    return paginate(this.prisma.db.payrollRun, dto, { where: { ...(stores && { OR: [{ storeId: { in: stores } }, { storeId: null }] }), ...(dto.status && { status: dto.status }) }, include: { _count: { select: { payslips: true } } }, sortable: ['periodKey', 'createdAt'], defaultSort: 'periodKey' });
  }

  private async mustRun(id: string, user: AuthUser) {
    const r = await this.prisma.db.payrollRun.findFirst({ where: { id } });
    if (!r) throw new NotFoundException('Payroll run not found');
    if (r.storeId) assertStoreAccess(user, r.storeId);
    return r;
  }

  async get(id: string, user: AuthUser) {
    await this.mustRun(id, user);
    return this.prisma.db.payrollRun.findFirstOrThrow({ where: { id }, include: { payslips: { where: { deletedAt: null }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } }, lines: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } }, orderBy: { number: 'asc' } } } });
  }

  /** Working days of the month and the days this employee does not get paid for (absences + approved unpaid leave). */
  private async facts(tx: Tx, empId: string, periodKey: string, cfg: Awaited<ReturnType<HrService['payrollConfig']>>) {
    const { start, end } = periodBounds(periodKey);
    const workingDays = workingDaysBetween(start, end, cfg.workingWeekdays);
    const absent = await tx.attendanceRecord.findMany({ where: { employeeId: empId, status: 'ABSENT', date: { gte: day(start), lte: day(end) }, deletedAt: null }, select: { date: true } });
    const unpaid = await tx.leaveRequest.findMany({ where: { employeeId: empId, status: 'APPROVED', deletedAt: null, leaveType: { isPaid: false }, startDate: { lte: day(end) }, endDate: { gte: day(start) } } });
    let absentDays = new Set(absent.map((a) => a.date.toISOString().slice(0, 10)).filter((d) => cfg.workingWeekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()))).size;
    for (const l of unpaid) { const o = overlapDays(l.startDate, l.endDate, start, end); if (o) absentDays += workingDaysBetween(o.start, o.end, cfg.workingWeekdays); }
    return { workingDays, absentDays };
  }

  private lines(r: ReturnType<typeof computePayslip>, c: { commissions: number; bonuses: number; overtime: number; deductions: number; absentDays: number; extraLines: { kind: 'EARNING' | 'DEDUCTION'; label: string; amount: number }[] }) {
    const L: { kind: 'EARNING' | 'DEDUCTION' | 'CONTRIBUTION' | 'TAX'; label: string; amount: number }[] = [{ kind: 'EARNING', label: 'Salaire de base', amount: r.baseSalary }];
    if (r.absenceCut > 0) L.push({ kind: 'DEDUCTION', label: `Absences non payées (${c.absentDays} j)`, amount: -r.absenceCut });
    if (c.commissions > 0) L.push({ kind: 'EARNING', label: 'Commissions', amount: c.commissions });
    for (const x of c.extraLines) L.push({ kind: x.kind, label: x.label, amount: x.kind === 'DEDUCTION' ? -x.amount : x.amount });
    L.push({ kind: 'CONTRIBUTION', label: 'CNSS (part salariale)', amount: -r.cnss }, { kind: 'CONTRIBUTION', label: 'AMO (part salariale)', amount: -r.amo }, { kind: 'TAX', label: 'Impôt sur le revenu (IR)', amount: -r.incomeTax });
    return L;
  }

  async create(dto: D.PeriodDto, user: AuthUser) {
    if (dto.storeId) assertStoreAccess(user, dto.storeId);
    const { start, end } = periodBounds(dto.periodKey);
    if (await this.prisma.raw.payrollRun.findFirst({ where: { periodKey: dto.periodKey, storeId: dto.storeId ?? null, deletedAt: null } })) throw new ConflictException({ code: 'RUN_EXISTS', message: 'A payroll run already exists for this period' });
    const stores = visibleStoreIds(user);
    const emps = await this.prisma.raw.employee.findMany({
      where: { deletedAt: null, status: { not: 'TERMINATED' }, ...(dto.storeId ? { storeId: dto.storeId } : stores ? { OR: [{ storeId: { in: stores } }, { storeId: null }] } : {}), hireDate: { lte: day(end) } },
      include: { contracts: { where: { deletedAt: null, startDate: { lte: day(end) }, OR: [{ endDate: null }, { endDate: { gte: day(start) } }] }, orderBy: { startDate: 'desc' }, take: 1 } },
    });
    const eligible = emps.filter((e) => e.contracts[0]);
    if (!eligible.length) throw new BadRequestException({ code: 'NO_EMPLOYEES', message: 'No employee with a contract covers this period' });
    const fallbackStore = dto.storeId ?? (await this.prisma.raw.store.findFirstOrThrow({ where: { isActive: true, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] })).id;

    const id = await this.prisma.raw.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({ data: { storeId: dto.storeId ?? null, periodKey: dto.periodKey, periodStart: day(start), periodEnd: day(end), status: 'DRAFT' } });
      let gross = 0, net = 0;
      for (const e of eligible) {
        const salary = Number(e.contracts[0].baseSalary);
        const cfg = await this.hr.payrollConfig(e.storeId);
        const { workingDays, absentDays } = await this.facts(tx, e.id, dto.periodKey, cfg);
        const comm = await tx.commissionEntry.findMany({ where: { employeeId: e.id, periodKey: dto.periodKey, status: 'APPROVED', payslipId: null, deletedAt: null } });
        const commissions = fromCents(comm.reduce((n, c) => n + toCents(Number(c.amount)), 0));
        const r = computePayslip({ baseSalary: salary, absentDays, workingDays, commissions, bonuses: 0, overtime: 0, deductions: 0 }, cfg);
        const number = await this.numbering.next(tx, e.storeId ?? fallbackStore, 'PAYSLIP');
        const slip = await tx.payslip.create({
          data: { runId: run.id, employeeId: e.id, number, baseSalary: r.basePaid, commissions, bonuses: 0, overtime: 0, deductions: r.absenceCut, socialContrib: r.socialContrib, incomeTax: r.incomeTax, gross: r.gross, net: r.net, status: 'DRAFT',
            lines: { create: this.lines(r, { commissions, bonuses: 0, overtime: 0, deductions: 0, absentDays, extraLines: [] }).map((l, i) => ({ ...l, sortOrder: i })) } },
        });
        if (comm.length) await tx.commissionEntry.updateMany({ where: { id: { in: comm.map((c) => c.id) } }, data: { payslipId: slip.id } });
        gross += toCents(r.gross); net += toCents(r.net);
      }
      await tx.payrollRun.update({ where: { id: run.id }, data: { totalGross: fromCents(gross), totalNet: fromCents(net) } });
      return run.id;
    });
    return this.get(id, user);
  }

  /** Add a bonus, overtime or deduction to a draft payslip: the whole slip (and run totals) are recomputed. */
  async adjust(runId: string, payslipId: string, dto: D.AdjustPayslipDto, user: AuthUser) {
    const run = await this.mustRun(runId, user);
    if (run.status !== 'DRAFT') throw new ConflictException({ code: 'RUN_LOCKED', message: 'Only a draft payroll can be changed' });
    const slip = await this.prisma.db.payslip.findFirst({ where: { id: payslipId, runId }, include: { employee: { include: { contracts: { where: { deletedAt: null, isActive: true }, take: 1 } } }, lines: { where: { deletedAt: null } } } });
    if (!slip) throw new NotFoundException('Payslip not found');
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.payslipLine.create({ data: { payslipId, kind: dto.kind === 'DEDUCTION' ? 'DEDUCTION' : 'EARNING', label: `${dto.kind === 'OVERTIME' ? 'Heures supplémentaires — ' : ''}${dto.label}`, amount: dto.kind === 'DEDUCTION' ? -dto.amount : dto.amount, sortOrder: 50 } });
      await this.rebuild(tx, slip.id, run.periodKey);
      await this.totals(tx, runId);
    });
    return this.get(runId, user);
  }

  async removeAdjustment(runId: string, payslipId: string, lineId: string, user: AuthUser) {
    const run = await this.mustRun(runId, user);
    if (run.status !== 'DRAFT') throw new ConflictException({ code: 'RUN_LOCKED', message: 'Only a draft payroll can be changed' });
    const line = await this.prisma.db.payslipLine.findFirst({ where: { id: lineId, payslipId, sortOrder: 50 } });
    if (!line) throw new NotFoundException('Adjustment not found');
    await this.prisma.raw.$transaction(async (tx) => { await tx.payslipLine.update({ where: { id: lineId }, data: { deletedAt: new Date() } }); await this.rebuild(tx, payslipId, run.periodKey); await this.totals(tx, runId); });
    return this.get(runId, user);
  }

  /** Recompute a payslip from its contract + manual adjustment lines (sortOrder 50). */
  private async rebuild(tx: Tx, payslipId: string, periodKey: string) {
    const slip = await tx.payslip.findUniqueOrThrow({ where: { id: payslipId }, include: { employee: { include: { contracts: { where: { deletedAt: null }, orderBy: { startDate: 'desc' }, take: 1 } } } } });
    const manual = await tx.payslipLine.findMany({ where: { payslipId, sortOrder: 50, deletedAt: null } });
    const bonuses = manual.filter((l) => l.kind === 'EARNING').reduce((n, l) => n + Number(l.amount), 0);
    const deductions = manual.filter((l) => l.kind === 'DEDUCTION').reduce((n, l) => n - Number(l.amount), 0);
    const salary = Number(slip.employee.contracts[0]?.baseSalary ?? 0);
    const cfg = await this.hr.payrollConfig(slip.employee.storeId);
    const { workingDays, absentDays } = await this.facts(tx, slip.employee.id, periodKey, cfg);
    const own = await tx.commissionEntry.findMany({ where: { payslipId }, select: { amount: true } });
    const commOnSlip = fromCents(own.reduce((n, c) => n + toCents(Number(c.amount)), 0));
    const r2 = computePayslip({ baseSalary: salary, absentDays, workingDays, commissions: commOnSlip, bonuses, overtime: 0, deductions }, cfg);
    await tx.payslipLine.deleteMany({ where: { payslipId, sortOrder: { lt: 50 } } });
    await tx.payslipLine.createMany({ data: this.lines(r2, { commissions: commOnSlip, bonuses, overtime: 0, deductions, absentDays, extraLines: [] }).map((l, i) => ({ ...l, payslipId, sortOrder: i })) });
    await tx.payslip.update({ where: { id: payslipId }, data: { baseSalary: r2.basePaid, commissions: commOnSlip, bonuses, deductions: r2.absenceCut + deductions, socialContrib: r2.socialContrib, incomeTax: r2.incomeTax, gross: r2.gross, net: r2.net } });
  }

  private async totals(tx: Tx, runId: string) {
    const slips = await tx.payslip.findMany({ where: { runId, deletedAt: null }, select: { gross: true, net: true } });
    await tx.payrollRun.update({ where: { id: runId }, data: { totalGross: fromCents(slips.reduce((n, s) => n + toCents(Number(s.gross)), 0)), totalNet: fromCents(slips.reduce((n, s) => n + toCents(Number(s.net)), 0)) } });
  }

  async approve(id: string, user: AuthUser) {
    const run = await this.mustRun(id, user);
    if (run.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_STATE', message: `The run is ${run.status}` });
    await this.prisma.raw.$transaction([
      this.prisma.raw.payrollRun.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() } }),
      this.prisma.raw.payslip.updateMany({ where: { runId: id }, data: { status: 'APPROVED' } }),
    ]);
    return this.get(id, user);
  }

  /** Marks salaries paid and records the cash leaving (one cash-flow entry per payslip). */
  async pay(id: string, bankAccountId: string | undefined, user: AuthUser) {
    const run = await this.mustRun(id, user);
    if (run.status !== 'APPROVED') throw new ConflictException({ code: 'INVALID_STATE', message: 'Approve the run before paying it' });
    if (bankAccountId && !(await this.prisma.db.bankAccount.findFirst({ where: { id: bankAccountId, isActive: true } }))) throw new BadRequestException('Unknown bank account');
    const fallback = run.storeId ?? (await this.prisma.raw.store.findFirstOrThrow({ where: { isActive: true, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] })).id;
    await this.prisma.raw.$transaction(async (tx) => {
      const slips = await tx.payslip.findMany({ where: { runId: id, deletedAt: null }, include: { employee: { select: { storeId: true, firstName: true, lastName: true } } } });
      const now = new Date();
      for (const s of slips) await tx.cashFlowEntry.create({ data: { storeId: s.employee.storeId ?? fallback, bankAccountId, direction: 'OUT', amount: s.net, source: 'PAYROLL', refType: 'Payslip', refId: s.id, description: `${s.number} — ${s.employee.firstName} ${s.employee.lastName}`, occurredAt: now } });
      await tx.payslip.updateMany({ where: { runId: id }, data: { status: 'PAID', paidAt: now } });
      await tx.commissionEntry.updateMany({ where: { payslip: { runId: id } }, data: { status: 'PAID' } });
      await tx.payrollRun.update({ where: { id }, data: { status: 'PAID', paidAt: now } });
    });
    return this.get(id, user);
  }

  async remove(id: string, user: AuthUser) {
    const run = await this.mustRun(id, user);
    if (run.status !== 'DRAFT') throw new ConflictException({ code: 'RUN_LOCKED', message: 'Only a draft payroll can be deleted' });
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.commissionEntry.updateMany({ where: { payslip: { runId: id } }, data: { payslipId: null } }); // back to the pool for the next run
      const slips = await tx.payslip.findMany({ where: { runId: id }, select: { id: true, number: true } });
      for (const s of slips) await tx.payslip.update({ where: { id: s.id }, data: { deletedAt: new Date(), number: `${s.number}#del-${s.id.slice(-6)}` } });
      await tx.payrollRun.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }
}
