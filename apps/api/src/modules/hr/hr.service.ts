import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, searchWhere } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { SettingsService } from '../settings/settings.service';
import { localDate } from '../appointments/slots';
import { DEFAULT_PAYROLL, periodBounds, workingDaysBetween, type PayrollConfig } from './payroll';
import * as D from './hr.dto';

const canSeePay = (u: AuthUser) => u.isSuperAdmin || u.permissions.includes('hr:payroll');
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  async payrollConfig(storeId?: string | null): Promise<PayrollConfig> {
    return { ...DEFAULT_PAYROLL, ...(await this.settings.value<Partial<PayrollConfig>>('payroll_config', {}, storeId)) };
  }

  // ------------------------------------------------------------------ employees
  private scope(user: AuthUser) {
    const stores = visibleStoreIds(user);
    return stores ? { OR: [{ storeId: { in: stores } }, { storeId: null }] } : {};
  }

  /** Salary and bank details only go to people allowed to run payroll. */
  private shape<T extends Record<string, any>>(e: T, user: AuthUser) {
    if (canSeePay(user)) return e;
    const { bankIban: _b, contracts: _c, socialSecurityNo: _s, nationalId: _n, ...safe } = e;
    return safe;
  }

  async list(dto: D.ListEmployeesDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : null;
    const where = { ...this.scope(user), ...(stores && { storeId: { in: stores } }), ...(dto.status && { status: dto.status }), ...searchWhere(dto.search, ['firstName', 'lastName', 'employeeNumber', 'position', 'email']) } as Record<string, any>;
    const res = await paginate(this.prisma.db.employee, dto, { where: dto.storeId ? where : { AND: [this.scope(user), { ...where, OR: where.OR }] }, sortable: ['lastName', 'firstName', 'hireDate', 'employeeNumber'], defaultSort: 'lastName' });
    return { ...res, data: res.data.map((e: any) => this.shape(e, user)) };
  }

  private async mustGet(id: string, user: AuthUser) {
    const e = await this.prisma.db.employee.findFirst({ where: { id } });
    if (!e) throw new NotFoundException('Employee not found');
    if (e.storeId) assertStoreAccess(user, e.storeId);
    return e;
  }

  async get(id: string, user: AuthUser) {
    await this.mustGet(id, user);
    const e = await this.prisma.db.employee.findFirstOrThrow({
      where: { id },
      include: { manager: { select: { id: true, firstName: true, lastName: true } }, contracts: { where: { deletedAt: null }, orderBy: { startDate: 'desc' } }, user: { select: { id: true, email: true } } },
    });
    return this.shape(e, user);
  }

  private async nextNumber() {
    // numeric max over well-formed numbers only: soft-deleted rows carry a "#del-" suffix and must not confuse the sequence
    const rows = await this.prisma.raw.$queryRaw<{ n: number | null }[]>`SELECT MAX(CAST(SUBSTRING("employeeNumber" FROM 5) AS INTEGER)) AS n FROM "Employee" WHERE "employeeNumber" ~ '^EMP-[0-9]+$'`;
    return `EMP-${String((rows[0]?.n ?? 0) + 1).padStart(4, '0')}`;
  }

  async create(dto: D.CreateEmployeeDto, user: AuthUser) {
    if (dto.storeId) assertStoreAccess(user, dto.storeId);
    if (dto.userId) {
      if (!(await this.prisma.db.user.findFirst({ where: { id: dto.userId, type: 'STAFF' } }))) throw new BadRequestException('Unknown staff user');
      if (await this.prisma.raw.employee.findFirst({ where: { userId: dto.userId, deletedAt: null } })) throw new ConflictException({ code: 'USER_ALREADY_LINKED', message: 'That login already belongs to another employee' });
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const e = await this.prisma.raw.employee.create({ data: { ...dto, employeeNumber: dto.employeeNumber ?? (await this.nextNumber()) } });
        return this.get(e.id, user);
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
        if (dto.employeeNumber) throw new ConflictException({ code: 'DUPLICATE_NUMBER', message: 'That employee number is taken' });
        // two people hired at once drew the same number: draw again
      }
    }
    throw new ConflictException('Could not allocate an employee number');
  }

  async update(id: string, dto: D.UpdateEmployeeDto, user: AuthUser) {
    const e = await this.mustGet(id, user);
    if (dto.storeId) assertStoreAccess(user, dto.storeId);
    if (dto.managerId === id) throw new BadRequestException('An employee cannot manage themselves');
    if (dto.userId && dto.userId !== e.userId && (await this.prisma.raw.employee.findFirst({ where: { userId: dto.userId, deletedAt: null, id: { not: id } } }))) throw new ConflictException({ code: 'USER_ALREADY_LINKED', message: 'That login already belongs to another employee' });
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { ...dto, status: dto.status as 'ACTIVE' | undefined, ...(dto.status === 'TERMINATED' && !dto.terminationDate && { terminationDate: new Date() }) } as never });
      if (dto.status === 'TERMINATED') await tx.employmentContract.updateMany({ where: { employeeId: id, isActive: true }, data: { isActive: false } });
    });
    return this.get(id, user);
  }

  async remove(id: string, user: AuthUser) {
    await this.mustGet(id, user);
    if (await this.prisma.raw.payslip.count({ where: { employeeId: id, deletedAt: null } })) throw new ConflictException({ code: 'HAS_PAYSLIPS', message: 'This employee has payslips: terminate them instead' });
    await this.prisma.raw.employee.update({ where: { id }, data: { deletedAt: new Date(), employeeNumber: `${(await this.prisma.raw.employee.findUniqueOrThrow({ where: { id } })).employeeNumber}#del-${id.slice(-6)}`, userId: null } });
  }

  async addContract(employeeId: string, dto: D.ContractDto, user: AuthUser) {
    await this.mustGet(employeeId, user);
    if (dto.endDate && dto.endDate < dto.startDate) throw new BadRequestException({ code: 'INVALID_DATES', message: 'The contract cannot end before it starts' });
    if (dto.type === 'CDD' && !dto.endDate) throw new BadRequestException({ code: 'END_DATE_REQUIRED', message: 'A fixed-term contract needs an end date' });
    await this.prisma.raw.$transaction(async (tx) => {
      // the previous contract ends the day before the new one starts
      const prev = await tx.employmentContract.findMany({ where: { employeeId, isActive: true, deletedAt: null } });
      for (const p of prev) await tx.employmentContract.update({ where: { id: p.id }, data: { isActive: false, endDate: p.endDate && p.endDate < dto.startDate ? p.endDate : new Date(dto.startDate.getTime() - 86_400_000) } });
      await tx.employmentContract.create({ data: { employeeId, type: dto.type as 'CDI', startDate: dto.startDate, endDate: dto.endDate, baseSalary: dto.baseSalary, hoursPerWeek: dto.hoursPerWeek, probationEnd: dto.probationEnd, documentUrl: dto.documentUrl, isActive: true } });
    });
    return this.get(employeeId, user);
  }

  /** The employee record of the signed-in user (for self-service). */
  async me(user: AuthUser) {
    const e = await this.prisma.db.employee.findFirst({ where: { userId: user.id } });
    if (!e) throw new NotFoundException({ code: 'NO_EMPLOYEE', message: 'Your login is not linked to an employee record' });
    return e;
  }

  // ------------------------------------------------------------------ attendance
  private async tzOf(storeId: string | null) {
    return (storeId ? (await this.prisma.db.store.findFirst({ where: { id: storeId }, select: { timezone: true } }))?.timezone : null) ?? 'Africa/Casablanca';
  }

  async clock(user: AuthUser, action: 'in' | 'out', note?: string) {
    const emp = await this.me(user);
    if (emp.status === 'TERMINATED') throw new ForbiddenException('This employee record is closed');
    const tz = await this.tzOf(emp.storeId);
    const now = new Date();
    const date = day(localDate(now, tz));
    const row = await this.prisma.raw.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: emp.id, date } } });
    if (action === 'in') {
      if (row?.checkIn) throw new ConflictException({ code: 'ALREADY_CLOCKED_IN', message: 'You already clocked in today' });
      const start = await this.settings.value<string>('work_start', '09:00', emp.storeId);
      const grace = await this.settings.value<number>('late_grace_minutes', 10, emp.storeId);
      const local = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
      const [lh, lm] = local.split(':').map(Number), [sh, sm] = start.split(':').map(Number);
      const late = lh * 60 + lm > sh * 60 + sm + grace;
      const data = { checkIn: now, status: (late ? 'LATE' : 'PRESENT') as 'LATE', note, storeId: emp.storeId };
      return row ? this.prisma.raw.attendanceRecord.update({ where: { id: row.id }, data }) : this.prisma.raw.attendanceRecord.create({ data: { employeeId: emp.id, date, ...data } });
    }
    if (!row?.checkIn) throw new ConflictException({ code: 'NOT_CLOCKED_IN', message: 'Clock in first' });
    if (row.checkOut) throw new ConflictException({ code: 'ALREADY_CLOCKED_OUT', message: 'You already clocked out today' });
    const worked = Math.max(0, Math.round((now.getTime() - row.checkIn.getTime()) / 60_000) - row.breakMinutes);
    return this.prisma.raw.attendanceRecord.update({ where: { id: row.id }, data: { checkOut: now, workedMinutes: worked, note: note ?? row.note } });
  }

  today(user: AuthUser) {
    return this.me(user).then(async (emp) => {
      const date = day(localDate(new Date(), await this.tzOf(emp.storeId)));
      return { employee: { id: emp.id, firstName: emp.firstName }, record: await this.prisma.db.attendanceRecord.findFirst({ where: { employeeId: emp.id, date } }) };
    });
  }

  async manual(dto: D.AttendanceManualDto, user: AuthUser) {
    const emp = await this.mustGet(dto.employeeId, user);
    const tz = await this.tzOf(emp.storeId);
    const at = (hhmm?: string) => (hhmm ? new Date(`${dto.date}T${hhmm}:00${offsetSuffix(tz, dto.date)}`) : null);
    const checkIn = at(dto.checkIn), checkOut = at(dto.checkOut);
    if (checkIn && checkOut && checkOut <= checkIn) throw new BadRequestException({ code: 'INVALID_TIMES', message: 'Check-out must be after check-in' });
    const worked = checkIn && checkOut ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000) - (dto.breakMinutes ?? 0)) : null;
    const status = (dto.status ?? 'PRESENT') as 'PRESENT';
    const data = { checkIn, checkOut, breakMinutes: dto.breakMinutes ?? 0, workedMinutes: worked, status, note: dto.note, storeId: emp.storeId };
    return this.prisma.raw.attendanceRecord.upsert({ where: { employeeId_date: { employeeId: emp.id, date: day(dto.date) } }, update: data, create: { employeeId: emp.id, date: day(dto.date), ...data } });
  }

  async listAttendance(dto: D.ListAttendanceDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const where = { ...(stores && { OR: [{ storeId: { in: stores } }, { storeId: null }] }), ...(dto.employeeId && { employeeId: dto.employeeId }), ...((dto.from || dto.to) && { date: { ...(dto.from && { gte: day(dto.from) }), ...(dto.to && { lte: day(dto.to) }) } }) };
    return paginate(this.prisma.db.attendanceRecord, dto, { where, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } }, sortable: ['date'], defaultSort: 'date' });
  }

  /** Per-employee totals for a month: days present / late / absent / on leave, minutes worked. */
  async attendanceSummary(dto: D.PeriodDto, user: AuthUser) {
    const { start, end } = periodBounds(dto.periodKey);
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const emps = await this.prisma.db.employee.findMany({ where: { status: { not: 'TERMINATED' }, ...(stores && { OR: [{ storeId: { in: stores } }, { storeId: null }] }) }, select: { id: true, firstName: true, lastName: true, employeeNumber: true }, orderBy: { lastName: 'asc' } });
    const rows = await this.prisma.db.attendanceRecord.findMany({ where: { employeeId: { in: emps.map((e) => e.id) }, date: { gte: day(start), lte: day(end) } } });
    return emps.map((e) => {
      const mine = rows.filter((r) => r.employeeId === e.id);
      const count = (s: string) => mine.filter((r) => r.status === s).length;
      return { ...e, present: count('PRESENT'), late: count('LATE'), absent: count('ABSENT'), leave: count('LEAVE'), holiday: count('HOLIDAY'), workedMinutes: mine.reduce((n, r) => n + (r.workedMinutes ?? 0), 0) };
    });
  }

  // ------------------------------------------------------------------ leave
  private async leaveDays(start: string, end: string, storeId?: string | null) {
    const cfg = await this.payrollConfig(storeId);
    return workingDaysBetween(start, end, cfg.workingWeekdays);
  }

  /** Allowance, days taken (approved) and days waiting (pending) in a calendar year. */
  async balances(employeeId: string, user: AuthUser, year = new Date().getFullYear()) {
    await this.mustGet(employeeId, user);
    const types = await this.prisma.db.leaveType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    const reqs = await this.prisma.db.leaveRequest.findMany({ where: { employeeId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { gte: day(`${year}-01-01`), lte: day(`${year}-12-31`) } } });
    return types.map((t) => {
      const mine = reqs.filter((r) => r.leaveTypeId === t.id);
      const sum = (s: string) => mine.filter((r) => r.status === s).reduce((n, r) => n + Number(r.days), 0);
      return { leaveTypeId: t.id, code: t.code, name: t.name, isPaid: t.isPaid, allowance: t.annualDays == null ? null : Number(t.annualDays), taken: sum('APPROVED'), pending: sum('PENDING'), remaining: t.annualDays == null ? null : Number(t.annualDays) - sum('APPROVED') - sum('PENDING') };
    });
  }

  async requestLeave(dto: D.CreateLeaveDto, user: AuthUser) {
    let emp;
    if (dto.employeeId && !(await this.prisma.db.employee.findFirst({ where: { id: dto.employeeId, userId: user.id } }))) {
      if (!user.isSuperAdmin && !user.permissions.includes('hr:create')) throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'You can only request leave for yourself' });
      emp = await this.mustGet(dto.employeeId, user);
    } else emp = dto.employeeId ? await this.mustGet(dto.employeeId, user) : await this.me(user);
    if (dto.endDate < dto.startDate) throw new BadRequestException({ code: 'INVALID_DATES', message: 'The end date cannot be before the start date' });
    const type = await this.prisma.db.leaveType.findFirst({ where: { id: dto.leaveTypeId, isActive: true } });
    if (!type) throw new BadRequestException({ code: 'UNKNOWN_LEAVE_TYPE', message: 'Unknown leave type' });
    const days = await this.leaveDays(dto.startDate, dto.endDate, emp.storeId);
    if (days <= 0) throw new BadRequestException({ code: 'NO_WORKING_DAYS', message: 'That period contains no working days' });
    const clash = await this.prisma.db.leaveRequest.findFirst({ where: { employeeId: emp.id, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: day(dto.endDate) }, endDate: { gte: day(dto.startDate) } } });
    if (clash) throw new ConflictException({ code: 'LEAVE_OVERLAP', message: 'This overlaps another leave request' });
    if (type.annualDays != null) {
      const bal = (await this.balances(emp.id, user, Number(dto.startDate.slice(0, 4)))).find((b) => b.leaveTypeId === type.id)!;
      if (bal.remaining! < days) throw new ConflictException({ code: 'INSUFFICIENT_BALANCE', message: `Only ${bal.remaining} day(s) left for ${type.name}`, details: { remaining: bal.remaining!, requested: days } });
    }
    return this.prisma.raw.leaveRequest.create({ data: { employeeId: emp.id, leaveTypeId: type.id, startDate: day(dto.startDate), endDate: day(dto.endDate), days, reason: dto.reason, status: type.requiresApproval ? 'PENDING' : 'APPROVED', ...(type.requiresApproval ? {} : { decidedAt: new Date(), decidedById: user.id }) } });
  }

  async listLeave(dto: D.ListLeaveDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const where = { ...(dto.employeeId && { employeeId: dto.employeeId }), ...(dto.status && { status: dto.status }), ...(stores && { employee: { OR: [{ storeId: { in: stores } }, { storeId: null }] } }) };
    return paginate(this.prisma.db.leaveRequest, dto, { where, include: { employee: { select: { id: true, firstName: true, lastName: true } }, leaveType: { select: { id: true, name: true, isPaid: true } } }, sortable: ['startDate', 'createdAt'], defaultSort: 'startDate' });
  }

  async myLeave(user: AuthUser) {
    const emp = await this.me(user);
    return this.prisma.db.leaveRequest.findMany({ where: { employeeId: emp.id }, orderBy: { startDate: 'desc' }, take: 50, include: { leaveType: { select: { name: true, isPaid: true } } } });
  }

  async decide(id: string, approve: boolean, dto: D.DecideLeaveDto, user: AuthUser) {
    const r = await this.prisma.db.leaveRequest.findFirst({ where: { id }, include: { employee: true } });
    if (!r) throw new NotFoundException('Leave request not found');
    if (r.employee.storeId) assertStoreAccess(user, r.employee.storeId);
    if (r.status !== 'PENDING') throw new ConflictException({ code: 'INVALID_STATE', message: `This request is ${r.status}` });
    // nobody approves their own leave
    if (r.employee.userId === user.id && !user.isSuperAdmin) throw new ForbiddenException({ code: 'SELF_APPROVAL', message: 'You cannot decide your own leave request' });
    return this.prisma.raw.leaveRequest.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: user.id, decidedAt: new Date(), decisionNote: dto.note } });
  }

  async cancelLeave(id: string, user: AuthUser) {
    const r = await this.prisma.db.leaveRequest.findFirst({ where: { id }, include: { employee: true } });
    if (!r) throw new NotFoundException('Leave request not found');
    const mine = r.employee.userId === user.id;
    if (!mine && !user.isSuperAdmin && !user.permissions.includes('hr:update')) throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Not your request' });
    if (!['PENDING', 'APPROVED'].includes(r.status) || r.startDate < day(iso(new Date()))) throw new ConflictException({ code: 'INVALID_STATE', message: 'Only pending or upcoming leave can be cancelled' });
    return this.prisma.raw.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
}

/** "+01:00"-style suffix for a wall-clock time in `tz` on `date` (so manual attendance times are stored as the right instants). */
function offsetSuffix(tz: string, date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const v = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const diff = Math.round((Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - at.getTime()) / 60_000);
  const sign = diff < 0 ? '-' : '+', abs = Math.abs(diff);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
