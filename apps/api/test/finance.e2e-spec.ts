import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './app';
import { setupSales } from './sales-helpers';
import { uid } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

type F = Awaited<ReturnType<typeof setupSales>>;
const today = () => new Date().toISOString().slice(0, 10);
const range = `from=${today()}&to=${today()}`;

describe('Finance: expenses, cash flow, VAT, payments (e2e)', () => {
  let app: INestApplication;
  let f: F;
  let prisma: PrismaService;
  let category: string;
  beforeAll(async () => {
    app = await createTestApp(); f = await setupSales(app); prisma = app.get(PrismaService);
    category = (await prisma.raw.expenseCategory.findFirstOrThrow({ where: { code: 'supplies' } })).id;
  });
  afterAll(async () => { await app.close(); });

  const newExpense = async (over: Record<string, unknown> = {}) => (await f.admin.post('/expenses', { categoryId: category, description: `Cartouches ${uid()}`, amount: 120, taxAmount: 20, incurredAt: today(), ...over }).expect(201)).body;

  it('expense lifecycle: draft → approved → paid, with checks at every step', async () => {
    const e = await newExpense();
    expect(e).toMatchObject({ status: 'DRAFT', number: expect.stringMatching(/-/) });
    expect((await f.admin.post('/expenses', { categoryId: category, description: 'x', amount: 100, taxAmount: 150, incurredAt: today() }).expect(400)).body.code).toBe('INVALID_TAX');
    await f.admin.post('/expenses', { categoryId: 'nope', description: 'x', amount: 10, incurredAt: today() }).expect(400);
    await f.admin.post('/expenses', { categoryId: category, description: 'x', amount: 0, incurredAt: today() }).expect(400);
    await f.cashier.post('/expenses', { categoryId: category, description: 'x', amount: 10, incurredAt: today() }).expect(403);
    expect(Number((await f.admin.patch(`/expenses/${e.id}`, { amount: 150, taxAmount: 25 }).expect(200)).body.amount)).toBe(150);
    await f.admin.post(`/expenses/${e.id}/pay`, {}).expect(409); // approve first
    expect((await f.admin.post(`/expenses/${e.id}/approve`).expect(200)).body.status).toBe('APPROVED');
    await f.admin.patch(`/expenses/${e.id}`, { amount: 1 }).expect(409); // locked once approved
    const acct = (await prisma.raw.bankAccount.findFirstOrThrow({ where: { isCashAccount: true } })).id;
    const paid = (await f.admin.post(`/expenses/${e.id}/pay`, { bankAccountId: acct }).expect(200)).body;
    expect(paid.status).toBe('PAID');
    const entries = await prisma.raw.cashFlowEntry.findMany({ where: { refType: 'Expense', refId: e.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ direction: 'OUT', source: 'EXPENSE' });
    expect(Number(entries[0].amount)).toBe(150);
    await f.admin.post(`/expenses/${e.id}/pay`, {}).expect(409);
    const r = await newExpense();
    expect((await f.admin.post(`/expenses/${r.id}/reject`).expect(200)).body.status).toBe('REJECTED');
    const d = await newExpense();
    expect((await f.admin.del(`/expenses/${d.id}`)).status).toBe(204);
    await f.admin.get(`/expenses/${d.id}`).expect(404);
    expect((await f.admin.get(`/expenses?status=PAID&limit=100`).expect(200)).body.data.some((x: { id: string }) => x.id === e.id)).toBe(true);
  });

  it('two accountants paying the same expense at once: one payment, one cash-flow entry', async () => {
    const e = await newExpense({ amount: 80, taxAmount: 0 });
    await f.admin.post(`/expenses/${e.id}/approve`).expect(200);
    const res = await Promise.all([f.admin.post(`/expenses/${e.id}/pay`, {}), f.manager.post(`/expenses/${e.id}/pay`, {})]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.raw.cashFlowEntry.count({ where: { refType: 'Expense', refId: e.id } })).toBe(1);
  });

  it('cash flow adds up customer payments, refunds, supplier payments, expenses and manual entries', async () => {
    const before = (await f.admin.get(`/finance/cash-flow?${range}`).expect(200)).body;
    const s = await f.openCashier(500);
    const item = await f.newProduct({ price: 600 });
    await f.cashier.post('/pos/checkout', { clientRef: randomUUID(), lines: [{ variantId: item.variantId, quantity: 1 }], payments: [{ methodId: f.method('cash'), amount: 600 }] }).expect(201);
    await f.closeSession(f.cashier, s.session.id, 1100);
    const e = await newExpense({ amount: 240, taxAmount: 40 });
    await f.admin.post(`/expenses/${e.id}/approve`).expect(200);
    await f.admin.post(`/expenses/${e.id}/pay`, {}).expect(200);
    await f.admin.post('/finance/cash-entries', { direction: 'IN', amount: 1000, description: 'Apport du gérant' }).expect(201);
    const after = (await f.admin.get(`/finance/cash-flow?${range}`).expect(200)).body;
    expect(after.totals.in - before.totals.in).toBeCloseTo(1600, 2);
    expect(after.totals.out - before.totals.out).toBeCloseTo(240, 2);
    expect(after.totals.net).toBeCloseTo(after.totals.in - after.totals.out, 2);
    expect(after.series).toHaveLength(1);
    const src = (name: string, dir: string) => after.bySource.find((x: { source: string; direction: string }) => x.source === name && x.direction === dir)?.amount ?? 0;
    expect(src('MANUAL', 'IN')).toBeGreaterThanOrEqual(1000);
    expect(src('EXPENSE', 'OUT')).toBeGreaterThanOrEqual(240);
    expect((await f.admin.get(`/finance/cash-flow?from=${today()}&to=${today()}&groupBy=month`).expect(200)).body.series[0].key).toBe(today().slice(0, 7));
    await f.admin.get('/finance/cash-flow?from=bad&to=bad').expect(400);
    await f.cashier.get(`/finance/cash-flow?${range}`).expect(403);
  });

  it('manual entries can be removed, generated ones cannot; accounts show a running balance', async () => {
    const acct = (await f.admin.post('/bank-accounts', { name: `Compte ${uid()}`, openingBalance: 1000, bankName: 'BMCE' }).expect(201)).body;
    await f.cashier.post('/bank-accounts', { name: 'x' }).expect(403);
    const m = (await f.admin.post('/finance/cash-entries', { direction: 'IN', amount: 500, description: 'Dépôt', bankAccountId: acct.id }).expect(201)).body;
    await f.admin.post('/finance/cash-entries', { direction: 'OUT', amount: 200, description: 'Frais bancaires', bankAccountId: acct.id }).expect(201);
    const bal = (await f.admin.get('/finance/balances').expect(200)).body.find((a: { id: string }) => a.id === acct.id);
    expect(bal.balance).toBe(1300);
    const view = (await f.admin.get(`/finance/cash-flow?${range}&bankAccountId=${acct.id}`).expect(200)).body;
    expect(view.totals).toMatchObject({ in: 500, out: 200 }); // only this account's movements
    await f.admin.del(`/finance/cash-entries/${m.id}`).expect(204);
    expect((await f.admin.get('/finance/balances')).body.find((a: { id: string }) => a.id === acct.id).balance).toBe(800);
    const gen = (await prisma.raw.cashFlowEntry.findFirstOrThrow({ where: { source: 'EXPENSE' } })).id;
    expect((await f.admin.del(`/finance/cash-entries/${gen}`).expect(409)).body.code).toBe('NOT_MANUAL');
    expect((await f.admin.del(`/bank-accounts/${acct.id}`)).status).toBe(409); // has movements
  });

  it('VAT: collected on sales, recoverable on expenses, the difference is due', async () => {
    const before = (await f.admin.get(`/finance/vat?${range}`).expect(200)).body;
    const s = await f.openCashier(0);
    const item = await f.newProduct({ price: 1200 });
    await f.cashier.post('/pos/checkout', { clientRef: randomUUID(), lines: [{ variantId: item.variantId, quantity: 1 }], payments: [{ methodId: f.method('cash'), amount: 1200 }] }).expect(201);
    await f.closeSession(f.cashier, s.session.id, 1200);
    const e = await newExpense({ amount: 360, taxAmount: 60 });
    await f.admin.post(`/expenses/${e.id}/approve`).expect(200);
    const after = (await f.admin.get(`/finance/vat?${range}`).expect(200)).body;
    expect(after.collected - before.collected).toBeCloseTo(200, 2); // 1,200 TTC at 20% → 200
    expect(after.deductible.expenses - before.deductible.expenses).toBeCloseTo(60, 2);
    expect(after.due).toBeCloseTo(after.collected - after.deductible.total, 2);
    const twenty = after.byRate.find((r: { ratePct: number }) => r.ratePct === 20);
    expect(twenty.vat).toBeGreaterThanOrEqual(200);
    expect(twenty.taxableBase).toBeGreaterThanOrEqual(1000);
  });

  it('payments by method, credit notes, expense summary and the headline numbers respond', async () => {
    const pays = (await f.admin.get('/finance/payments?limit=5').expect(200)).body;
    expect(pays.data.length).toBeGreaterThan(0);
    expect(pays.data[0]).toHaveProperty('method.name');
    const byMethod = (await f.admin.get(`/finance/payments/by-method?${range}`).expect(200)).body;
    expect(byMethod.find((m: { type: string }) => m.type === 'CASH').amount).toBeGreaterThan(0);
    await f.admin.get('/credit-notes?limit=5').expect(200);
    const sum = (await f.admin.get(`/expenses/summary?${range}`).expect(200)).body;
    expect(sum.total).toBeGreaterThan(0);
    expect(sum.categories[0]).toHaveProperty('name');
    const head = (await f.admin.get('/finance/summary').expect(200)).body;
    expect(head).toHaveProperty('cash.net');
    expect(head).toHaveProperty('receivables.amount');
    expect(head).toHaveProperty('payables.amount');
    await f.cashier.get('/finance/summary').expect(403);
    await f.cashier.get('/finance/payments').expect(200); // cashiers have payments:read
  });

  it('expense categories: unique code, protected when used', async () => {
    const code = `c-${uid()}`.slice(0, 20);
    const c = (await f.admin.post('/expense-categories', { code, name: 'Test' }).expect(201)).body;
    await f.admin.post('/expense-categories', { code, name: 'Dup' }).expect(409);
    await newExpense({ categoryId: c.id });
    expect((await f.admin.del(`/expense-categories/${c.id}`)).status).toBe(409);
  });
});
