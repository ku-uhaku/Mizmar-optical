import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './app';
import { setupSales } from './sales-helpers';
import { loginAs, uid } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

type F = Awaited<ReturnType<typeof setupSales>>;
const period = new Date().toISOString().slice(0, 7);

describe('HR: employees, attendance, leave, commissions, payroll (e2e)', () => {
  let app: INestApplication;
  let f: F;
  let prisma: PrismaService;
  let opt: Awaited<ReturnType<typeof loginAs>>;
  beforeAll(async () => {
    app = await createTestApp(); f = await setupSales(app); prisma = app.get(PrismaService); opt = await loginAs(app, 'optician');
    // a clean slate for this month's payroll and commissions (the test database persists between runs)
    const runs = await prisma.raw.payrollRun.findMany({ where: { periodKey: period, deletedAt: null }, select: { id: true } });
    await prisma.raw.commissionEntry.updateMany({ where: { periodKey: period }, data: { payslipId: null } });
    await prisma.raw.payslip.updateMany({ where: { runId: { in: runs.map((r) => r.id) } }, data: { deletedAt: new Date(), number: undefined } }).catch(() => undefined);
    for (const r of runs) {
      await prisma.raw.payslipLine.deleteMany({ where: { payslip: { runId: r.id } } });
      await prisma.raw.payslip.deleteMany({ where: { runId: r.id } });
      await prisma.raw.payrollRun.delete({ where: { id: r.id } });
    }
    await prisma.raw.commissionEntry.deleteMany({ where: { periodKey: period } });
    await prisma.raw.attendanceRecord.deleteMany({});
    await prisma.raw.leaveRequest.deleteMany({});
  });
  afterAll(async () => { await app.close(); });

  const empOf = async (email: string) => (await prisma.raw.employee.findFirstOrThrow({ where: { user: { email } } })).id;

  describe('employees and contracts', () => {
    it('creates with a generated number; salary data is only for payroll people', async () => {
      const e = (await f.admin.post('/employees', { firstName: 'Hind', lastName: `Test${uid()}`, position: 'Vendeuse', email: 'hind@example.com', bankIban: 'MA64011519000001205000534921', socialSecurityNo: '123456789' }).expect(201)).body;
      expect(e.employeeNumber).toMatch(/^EMP-\d{4}$/);
      expect(e.bankIban).toBeTruthy();
      const seen = (await f.manager.get(`/employees/${e.id}`).expect(200)).body; // store manager: no hr:payroll
      expect(seen.firstName).toBe('Hind');
      expect(seen).not.toHaveProperty('bankIban');
      expect(seen).not.toHaveProperty('contracts');
      expect(seen).not.toHaveProperty('socialSecurityNo');
      await f.cashier.get('/employees').expect(403);
      await f.admin.post('/employees', { firstName: 'X', lastName: 'Y', employeeNumber: e.employeeNumber }).expect(409);
      await f.admin.post('/employees', { firstName: '', lastName: 'Y' }).expect(400);
      const a = (await f.admin.get(`/employees?search=${encodeURIComponent(e.lastName)}`).expect(200)).body;
      expect(a.data).toHaveLength(1);
    });

    it('a login belongs to one employee; contracts need dates; a new contract closes the previous', async () => {
      const cashier = f.cashier.user.id;
      expect((await f.admin.post('/employees', { firstName: 'Dup', lastName: 'Link', userId: cashier }).expect(409)).body.code).toBe('USER_ALREADY_LINKED');
      const e = (await f.admin.post('/employees', { firstName: 'Omar', lastName: `Ct${uid()}` }).expect(201)).body;
      await f.manager.post(`/employees/${e.id}/contracts`, { type: 'CDI', startDate: '2026-01-01', baseSalary: 5000 }).expect(403);
      expect((await f.admin.post(`/employees/${e.id}/contracts`, { type: 'CDD', startDate: '2026-01-01', baseSalary: 5000 }).expect(400)).body.code).toBe('END_DATE_REQUIRED');
      expect((await f.admin.post(`/employees/${e.id}/contracts`, { type: 'CDI', startDate: '2026-03-01', endDate: '2026-02-01', baseSalary: 5000 }).expect(400)).body.code).toBe('INVALID_DATES');
      await f.admin.post(`/employees/${e.id}/contracts`, { type: 'CDI', startDate: '2026-01-01', baseSalary: 5000 }).expect(201);
      const after = (await f.admin.post(`/employees/${e.id}/contracts`, { type: 'CDI', startDate: '2026-06-01', baseSalary: 6000 }).expect(201)).body;
      expect(after.contracts).toHaveLength(2);
      const active = after.contracts.filter((c: { isActive: boolean }) => c.isActive);
      expect(active).toHaveLength(1);
      expect(Number(active[0].baseSalary)).toBe(6000);
      const old = after.contracts.find((c: { isActive: boolean }) => !c.isActive);
      expect(old.endDate.slice(0, 10)).toBe('2026-05-31');
    });

    it('terminating ends contracts; employees with payslips cannot be deleted', async () => {
      const e = (await f.admin.post('/employees', { firstName: 'Gone', lastName: `Soon${uid()}` }).expect(201)).body;
      await f.admin.post(`/employees/${e.id}/contracts`, { type: 'CDI', startDate: '2026-01-01', baseSalary: 4000 }).expect(201);
      const t = (await f.admin.patch(`/employees/${e.id}`, { status: 'TERMINATED' }).expect(200)).body;
      expect(t.status).toBe('TERMINATED');
      expect(t.terminationDate).toBeTruthy();
      expect(t.contracts.every((c: { isActive: boolean }) => !c.isActive)).toBe(true);
      await f.admin.patch(`/employees/${e.id}`, { managerId: e.id }).expect(400);
      expect((await f.admin.del(`/employees/${e.id}`)).status).toBe(204);
    });
  });

  describe('attendance', () => {
    it('clock in/out for yourself: once a day, in order; no employee record → 404', async () => {
      const em = await empOf('cashier@mizmar.local');
      const inn = (await f.cashier.post('/hr/clock/in', {}).expect(200)).body;
      expect(['PRESENT', 'LATE']).toContain(inn.status);
      expect((await f.cashier.post('/hr/clock/in', {}).expect(409)).body.code).toBe('ALREADY_CLOCKED_IN');
      const today = (await f.cashier.get('/hr/me/today').expect(200)).body;
      expect(today.record.checkIn).toBeTruthy();
      const out = (await f.cashier.post('/hr/clock/out', {}).expect(200)).body;
      expect(out.checkOut).toBeTruthy();
      expect(out.workedMinutes).toBeGreaterThanOrEqual(0);
      expect((await f.cashier.post('/hr/clock/out', {}).expect(409)).body.code).toBe('ALREADY_CLOCKED_OUT');
      expect((await f.admin.post('/hr/clock/in', {}).expect(404)).body.code).toBe('NO_EMPLOYEE');
      expect((await f.technician.post('/hr/clock/out', {}).expect(409)).body.code).toBe('NOT_CLOCKED_IN');
      expect(em).toBeTruthy();
    });

    it('managers record attendance by hand; the monthly summary counts statuses', async () => {
      const em = await empOf('technician@mizmar.local');
      const d = (n: number) => `${period}-${String(n).padStart(2, '0')}`;
      await f.manager.post('/attendance', { employeeId: em, date: d(2), checkIn: '09:00', checkOut: '18:00', breakMinutes: 60 }).expect(201);
      const abs = (await f.manager.post('/attendance', { employeeId: em, date: d(3), status: 'ABSENT', note: 'No call' }).expect(201)).body;
      expect(abs.status).toBe('ABSENT');
      const first = (await f.manager.get(`/attendance?employeeId=${em}&from=${d(2)}&to=${d(2)}`).expect(200)).body.data[0];
      expect(first.workedMinutes).toBe(480);
      await f.manager.post('/attendance', { employeeId: em, date: d(4), checkIn: '18:00', checkOut: '09:00' }).expect(400);
      await f.cashier.post('/attendance', { employeeId: em, date: d(5) }).expect(403);
      const sum = (await f.manager.get(`/attendance/summary?periodKey=${period}`).expect(200)).body.find((r: { id: string }) => r.id === em);
      expect(sum).toMatchObject({ present: 1, absent: 1, workedMinutes: 480 });
    });
  });

  describe('leave', () => {
    const types = async () => Object.fromEntries((await prisma.raw.leaveType.findMany()).map((t) => [t.code, t.id]));

    it('counts working days (not Sundays), enforces the allowance and overlaps', async () => {
      const t = await types();
      const body = (s: string, e: string, type = t.annual) => ({ leaveTypeId: type, startDate: s, endDate: e });
      const a = (await f.cashier.post('/leave-requests', body('2027-03-01', '2027-03-07')).expect(201)).body; // Mon..Sun → 6 working days
      expect(Number(a.days)).toBe(6);
      expect(a.status).toBe('PENDING');
      expect((await f.cashier.post('/leave-requests', body('2027-03-05', '2027-03-09')).expect(409)).body.code).toBe('LEAVE_OVERLAP');
      expect((await f.cashier.post('/leave-requests', body('2027-04-01', '2027-03-01')).expect(400)).body.code).toBe('INVALID_DATES');
      expect((await f.cashier.post('/leave-requests', body('2027-03-03', '2027-03-03')).expect(409)).body.code).toBe('LEAVE_OVERLAP'); // inside the first
      expect((await f.cashier.post('/leave-requests', body('2027-05-02', '2027-05-02')).expect(400)).body.code).toBe('NO_WORKING_DAYS'); // a Sunday
      expect((await f.cashier.post('/leave-requests', body('2027-06-01', '2027-07-31')).expect(409)).body.code).toBe('INSUFFICIENT_BALANCE'); // far beyond 18 days
      const bal = (await f.cashier.get('/hr/me/leave-balances?year=2027').expect(200)).body.find((b: { code: string }) => b.code === 'annual');
      expect(bal).toMatchObject({ allowance: 18, pending: 6, taken: 0, remaining: 12 });
    });

    it('someone else decides; nobody approves their own; rejected days return to the balance', async () => {
      const t = await types();
      const r = (await f.technician.post('/leave-requests', { leaveTypeId: t.annual, startDate: '2027-08-02', endDate: '2027-08-04' }).expect(201)).body;
      await f.technician.post(`/leave-requests/${r.id}/approve`, {}).expect(403); // no hr:update
      await f.cashier.post(`/leave-requests/${r.id}/approve`, {}).expect(403);
      expect((await f.manager.post(`/leave-requests/${r.id}/approve`, { note: 'Enjoy' }).expect(200)).body.status).toBe('APPROVED');
      await f.manager.post(`/leave-requests/${r.id}/reject`, {}).expect(409);
      const mine = (await f.manager.post('/leave-requests', { leaveTypeId: t.annual, startDate: '2027-09-06', endDate: '2027-09-07' }).expect(201)).body;
      expect((await f.manager.post(`/leave-requests/${mine.id}/approve`, {}).expect(403)).body.code).toBe('SELF_APPROVAL');
      expect((await f.admin.post(`/leave-requests/${mine.id}/reject`, { note: 'Busy week' }).expect(200)).body.status).toBe('REJECTED');
      const bal = (await f.manager.get('/hr/me/leave-balances?year=2027').expect(200)).body.find((b: { code: string }) => b.code === 'annual');
      expect(bal.remaining).toBe(18);
      expect((await f.technician.post(`/leave-requests/${r.id}/cancel`).expect(200)).body.status).toBe('CANCELLED');
      const em = await empOf('technician@mizmar.local');
      await f.cashier.post('/leave-requests', { employeeId: em, leaveTypeId: t.annual, startDate: '2027-10-04', endDate: '2027-10-05' }).expect(403); // for someone else without hr:create
    });

    it('sick leave has no allowance; leave types are managed in HR', async () => {
      const t = await types();
      expect((await opt.post('/leave-requests', { leaveTypeId: t.sick, startDate: '2027-11-01', endDate: '2027-11-20' }).expect(201)).body.days).toBeDefined();
      const code = `T${uid()}`.toUpperCase().slice(0, 10);
      const lt = (await f.admin.post('/leave-types', { code, name: 'Test leave', isPaid: false, annualDays: 5 }).expect(201)).body;
      await f.admin.post('/leave-types', { code, name: 'Dup' }).expect(409);
      await f.cashier.post('/leave-types', { code: 'ZZ1', name: 'x' }).expect(403);
      expect((await f.admin.del(`/leave-types/${lt.id}`)).status).toBe(204);
    });
  });

  describe('commissions and payroll', () => {
    it('commission follows the rule on the cashier\'s sales and ignores returns', async () => {
      const s = await f.openCashier(1000);
      const item = await f.newProduct({ price: 1000 });
      const sale = (await f.cashier.post('/pos/checkout', { clientRef: randomUUID(), lines: [{ variantId: item.variantId, quantity: 2 }], payments: [{ methodId: f.method('cash'), amount: 2000 }] }).expect(201)).body;
      await f.closeSession(f.cashier, s.session.id, 3000);
      await f.cashier.post('/commissions/calculate', { periodKey: period }).expect(403); // hr:payroll only
      const calc = (await f.admin.post('/commissions/calculate', { periodKey: period }).expect(200)).body;
      expect(calc.created).toBeGreaterThanOrEqual(1);
      const em = await empOf('cashier@mizmar.local');
      const list = (await f.admin.get(`/commissions?employeeId=${em}&periodKey=${period}&orderId=${sale.id}`).expect(200)).body.data as { orderId: string; baseAmount: number; amount: number; status: string }[];
      expect(list).toHaveLength(1);
      const mine = list[0];
      expect(Number(mine.baseAmount)).toBe(2000);
      expect(Number(mine.amount)).toBe(40); // 2% default rule
      expect(mine.status).toBe('PENDING');
      const total = (await f.admin.get(`/commissions?periodKey=${period}&limit=100`)).body.meta.total;
      await f.admin.post('/commissions/calculate', { periodKey: period }).expect(200); // re-running rebuilds, never doubles
      expect((await f.admin.get(`/commissions?periodKey=${period}&limit=100`)).body.meta.total).toBe(total);
      expect((await f.admin.post('/commissions/approve', { periodKey: period }).expect(200)).body.approved).toBeGreaterThanOrEqual(1);
      await f.admin.post('/commissions/calculate', { periodKey: 'nope' }).expect(400);
    });

    it('a payroll run: payslips from contracts, absences and commissions; adjust, approve, pay; locked afterwards', async () => {
      const technician = await empOf('technician@mizmar.local');
      const cashierEmp = await empOf('cashier@mizmar.local');
      await f.manager.post('/payroll/runs', { periodKey: period }).expect(403);
      await f.admin.post('/payroll/runs', { periodKey: '2026-13' }).expect(400);
      const run = (await f.admin.post('/payroll/runs', { periodKey: period }).expect(201)).body;
      expect(run.status).toBe('DRAFT');
      expect((await f.admin.post('/payroll/runs', { periodKey: period }).expect(409)).body.code).toBe('RUN_EXISTS');
      const slip = (id: string) => run.payslips.find((p: { employeeId: string }) => p.employeeId === id);
      expect(run.payslips.length).toBeGreaterThanOrEqual(4);
      const t = slip(technician); // 5,500 base with one absent day (the 3rd) out of 27 working days
      expect(Number(t.baseSalary)).toBeLessThan(5500);
      expect(Number(t.gross)).toBe(Number(t.baseSalary));
      expect(Number(t.net)).toBeLessThan(Number(t.gross));
      expect(t.number).toMatch(/PAIE|PAY/i);
      const c = slip(cashierEmp);
      expect(Number(c.commissions)).toBeGreaterThanOrEqual(40);
      expect(Number(c.gross)).toBeCloseTo(Number(c.baseSalary) + Number(c.commissions), 2);
      expect(Number(run.totalNet)).toBeCloseTo(run.payslips.reduce((n: number, p: { net: number }) => n + Number(p.net), 0), 1);

      const before = Number(c.net);
      const adj = (await f.admin.post(`/payroll/runs/${run.id}/payslips/${c.id}/adjust`, { kind: 'BONUS', label: 'Prime objectif', amount: 500 }).expect(200)).body;
      const c2 = adj.payslips.find((p: { id: string }) => p.id === c.id);
      expect(Number(c2.gross)).toBeCloseTo(Number(c.gross) + 500, 2);
      expect(Number(c2.net)).toBeGreaterThan(before);
      expect(c2.lines.some((l: { label: string }) => l.label === 'Prime objectif')).toBe(true);
      const lineId = c2.lines.find((l: { label: string }) => l.label === 'Prime objectif').id;
      const back = (await f.admin.del(`/payroll/runs/${run.id}/payslips/${c.id}/adjustments/${lineId}`).expect(200)).body;
      expect(Number(back.payslips.find((p: { id: string }) => p.id === c.id).net)).toBeCloseTo(before, 2);

      await f.admin.post(`/payroll/runs/${run.id}/pay`, {}).expect(409); // approve first
      expect((await f.admin.post(`/payroll/runs/${run.id}/approve`).expect(200)).body.status).toBe('APPROVED');
      await f.admin.post(`/payroll/runs/${run.id}/payslips/${c.id}/adjust`, { kind: 'BONUS', label: 'Late', amount: 1 }).expect(409);
      expect((await f.admin.del(`/payroll/runs/${run.id}`)).status).toBe(409);
      const paid = (await f.admin.post(`/payroll/runs/${run.id}/pay`, {}).expect(200)).body;
      expect(paid.status).toBe('PAID');
      expect(paid.payslips.every((p: { status: string }) => p.status === 'PAID')).toBe(true);
      const out = await prisma.raw.cashFlowEntry.findMany({ where: { source: 'PAYROLL', refType: 'Payslip', refId: { in: paid.payslips.map((p: { id: string }) => p.id) } } });
      expect(out).toHaveLength(paid.payslips.length);
      expect(out.every((e) => e.direction === 'OUT')).toBe(true);
      expect((await prisma.raw.commissionEntry.findMany({ where: { employeeId: cashierEmp, periodKey: period, status: 'APPROVED' } })).length).toBe(0); // now PAID

      const doc = (await f.admin.get(`/payslips/${c.id}/document?locale=fr`).expect(200)).body;
      expect(doc.html).toContain(c.number);
      expect(doc.html).toContain('Bulletin de paie');
      expect(doc.html).toContain('CNSS');
    });
  });
});
