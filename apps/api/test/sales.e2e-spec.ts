import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './app';
import { setupSales } from './sales-helpers';

type F = Awaited<ReturnType<typeof setupSales>>;
const line = (variantId: string, quantity = 1, extra: Record<string, unknown> = {}) => ({ variantId, quantity, ...extra });

describe('POS: register sessions, checkout, payments (e2e)', () => {
  let app: INestApplication;
  let f: F;
  beforeAll(async () => { app = await createTestApp(); f = await setupSales(app); });
  afterAll(async () => { await app.close(); });

  describe('register sessions', () => {
    it('a sale needs an open session; opening is for people allowed to manage a register', async () => {
      const item = await f.newProduct();
      const r = await f.cashier.post('/pos/checkout', { lines: [line(item.variantId)], payments: [{ methodId: f.method('cash'), amount: 100 }] }).expect(409);
      expect(r.body.code).toBe('NO_OPEN_SESSION');
      await f.technician.post('/pos/sessions', { registerId: f.registers.c1, openingFloat: 100 }).expect(403);
      expect((await f.cashier.get('/pos/sessions/current').expect(200)).body.session).toBeNull();
    });

    it('opens with a float; one session per drawer and per user; the report starts at the float', async () => {
      const s = await f.openCashier(500);
      expect(s.cash).toMatchObject({ openingFloat: 500, expected: 500, sales: 0 });
      expect(s.session).toMatchObject({ status: 'OPEN', openedBy: expect.stringContaining('Nadia') });
      const busy = await f.manager.post('/pos/sessions', { registerId: f.registers.c1, openingFloat: 10 }).expect(409);
      expect(busy.body.code).toBe('REGISTER_BUSY');
      const again = await f.cashier.post('/pos/sessions', { registerId: f.registers.c2, openingFloat: 10 }).expect(409);
      expect(again.body.code).toBe('ALREADY_OPEN');
      await f.cashier.post('/pos/sessions', { registerId: f.registers.rabat, openingFloat: 10 }).expect(403); // not their store
      await f.manager.post('/pos/sessions', { registerId: f.registers.c2, openingFloat: -5 }).expect(400);
      const cur = (await f.cashier.get('/pos/sessions/current').expect(200)).body;
      expect(cur.session.id).toBe(s.session.id);
      await f.closeSession(f.cashier, s.session.id, 500).expect(200);
    });

    it('cash in/out move the expected cash; cash out cannot exceed what is in the drawer', async () => {
      const s = await f.openCashier(200);
      let r = (await f.cashier.post(`/pos/sessions/${s.session.id}/movements`, { type: 'CASH_IN', amount: 50, reason: 'Change float' }).expect(201)).body;
      expect(r.cash).toMatchObject({ cashIn: 50, expected: 250 });
      r = (await f.cashier.post(`/pos/sessions/${s.session.id}/movements`, { type: 'CASH_OUT', amount: 100, reason: 'Bank deposit' }).expect(201)).body;
      expect(r.cash).toMatchObject({ cashOut: -100, expected: 150 });
      const over = await f.cashier.post(`/pos/sessions/${s.session.id}/movements`, { type: 'CASH_OUT', amount: 151, reason: 'too much' }).expect(400);
      expect(over.body).toMatchObject({ code: 'INSUFFICIENT_CASH', details: { available: 150 } });
      await f.cashier.post(`/pos/sessions/${s.session.id}/movements`, { type: 'CASH_IN', amount: 0, reason: 'x' }).expect(400);
      await f.cashier.post(`/pos/sessions/${s.session.id}/movements`, { type: 'SALE', amount: 5, reason: 'x' }).expect(400); // only cash in/out are manual
      expect(r.movements).toHaveLength(2);
      await f.closeSession(f.cashier, s.session.id, 150).expect(200);
    });

    it('another cashier cannot touch my session; close reports the variance and freezes the report', async () => {
      const s = await f.openCashier(100);
      await f.manager.post('/pos/sessions', { registerId: f.registers.c2, openingFloat: 0 }).expect(201); // manager's own drawer is fine
      // manager (pos:manage_register) may supervise; a technician may not
      await f.technician.post(`/pos/sessions/${s.session.id}/close`, { countedCash: 1 }).expect(403);
      const closed = (await f.closeSession(f.cashier, s.session.id, 97.5).expect(200)).body;
      expect(closed.cash).toMatchObject({ expected: 100, counted: 97.5, variance: -2.5 });
      expect(closed.session.status).toBe('CLOSED');
      await f.closeSession(f.cashier, s.session.id, 100).expect(409);
      await f.cashier.post(`/pos/sessions/${s.session.id}/movements`, { type: 'CASH_IN', amount: 1, reason: 'x' }).expect(409);
      const again = (await f.cashier.get(`/pos/sessions/${s.session.id}/report`).expect(200)).body;
      expect(again.cash.variance).toBe(-2.5); // the stored Z report
      const me = await f.manager.get('/pos/sessions/current');
      await f.closeSession(f.manager, me.body.session.id, 0).expect(200);
    });
  });

  describe('checkout', () => {
    let session: string;
    beforeAll(async () => { session = (await f.openCashier(500)).session.id; });
    afterAll(async () => { await f.closeSession(f.cashier, session, 99999).catch(() => undefined); });

    it('previews the exact total without side effects, and surfaces lens problems early', async () => {
      const item = await f.newProduct({ price: 120, stock: 5 });
      const before = await f.prisma.raw.order.count();
      const p = (await f.cashier.post('/pos/price', { lines: [line(item.variantId, 3)] }).expect(200)).body;
      expect(p).toMatchObject({ subtotal: 360, discountTotal: 0, taxTotal: 60, total: 360, hasLens: false, minimumPayment: 360, depositPercent: null });
      expect(p.lines[0]).toMatchObject({ quantity: 3, lineTotal: 360, taxAmount: 60 });
      expect(await f.prisma.raw.order.count()).toBe(before);
      expect(await f.stockOf(item.variantId)).toBe(5);
      expect((await f.cashier.post('/pos/price', { lines: [] }).expect(200)).body.total).toBe(0);
      const fr = await f.newProduct({ type: 'FRAME', lens: true, price: 1000 });
      const lens = await f.lensOptions();
      const sv = lens.find((l) => l.code === 'single_vision')!;
      const err = await f.cashier.post('/pos/price', { lines: [line(fr.variantId, 1, { lens: { lensTypeId: sv.id } })] }).expect(400);
      expect(err.body.code).toBe('CUSTOMER_REQUIRED');
      const { customer, rx } = await f.customerWithRx();
      const lp = (await f.cashier.post('/pos/price', { customerId: customer.id, lines: [line(fr.variantId, 1, { lens: { lensTypeId: sv.id, prescriptionId: rx.id } })] }).expect(200)).body;
      expect(lp).toMatchObject({ hasLens: true, depositPercent: 30, minimumPayment: Math.ceil(lp.total * 0.3) });
      await f.cashier.post('/pos/price', { lines: [line(item.variantId, 1, { discount: { type: 'PERCENT', value: 10 } })] }).expect(403); // same permission rules as checkout
      await f.technician.post('/pos/price', { lines: [] }).expect(403);
    });

    it('sells, takes stock, issues a numbered invoice, records payment and the drawer movement (prices are tax-inclusive)', async () => {
      const item = await f.newProduct({ price: 120, cost: 50, stock: 10 });
      const o = (await f.cashier.post('/pos/checkout', { lines: [line(item.variantId, 2)], payments: [{ methodId: f.method('cash'), amount: 240 }] }).expect(201)).body;
      expect(o).toMatchObject({ channel: 'POS', status: 'COMPLETED', paymentStatus: 'PAID', total: 240, subtotal: 240, discountTotal: 0, taxTotal: 40, paidTotal: 240, balanceDue: 0 });
      expect(o.number).toMatch(/^CASA-CMD-\d{4}-\d{6}$/);
      expect(o.lines[0]).toMatchObject({ quantity: 2, unitPrice: 120, unitCost: 50, taxRatePct: 20, taxAmount: 40, lineTotal: 240, sku: item.sku });
      expect(o.invoices[0]).toMatchObject({ status: 'PAID', total: 240, paidTotal: 240 });
      expect(o.invoices[0].number).toMatch(/^CASA-FAC-\d{4}-\d{6}$/);
      expect(await f.stockOf(item.variantId)).toBe(8);
      const mv = await f.prisma.raw.stockMovement.findMany({ where: { variantId: item.variantId, type: 'SALE' } });
      expect(mv).toHaveLength(1);
      expect(mv[0]).toMatchObject({ quantity: -2, refType: 'Order', refId: o.id, balanceAfter: 8 });
      expect(o.payments[0]).toMatchObject({ kind: 'PAYMENT', amount: 240, status: 'CAPTURED', cashSessionId: session });
      const cash = await f.prisma.raw.cashMovement.findMany({ where: { sessionId: session, paymentId: o.payments[0].id } });
      expect(cash).toMatchObject([{ type: 'SALE', amount: expect.anything() }]);
      expect(Number(cash[0].amount)).toBe(240);
    });

    it('never trusts client prices: unknown fields are rejected and totals come from the catalog', async () => {
      const item = await f.newProduct({ price: 100 });
      await f.cashier.post('/pos/checkout', { lines: [{ ...line(item.variantId), unitPrice: 1 }], payments: [{ methodId: f.method('cash'), amount: 1 }] }).expect(400);
      await f.cashier.post('/pos/checkout', { lines: [line(item.variantId)], total: 1, payments: [{ methodId: f.method('cash'), amount: 1 }] }).expect(400);
      const short = await f.cashier.post('/pos/checkout', { lines: [line(item.variantId)], payments: [{ methodId: f.method('cash'), amount: 1 }] }).expect(400);
      expect(short.body).toMatchObject({ code: 'FULL_PAYMENT_REQUIRED', details: { due: 100, received: 1 } });
    });

    it('discounts need pos:discount (cashier no, manager yes); percent and amount; a discount cannot exceed the line', async () => {
      const item = await f.newProduct({ price: 200 });
      const withDisc = (d: unknown) => ({ lines: [line(item.variantId, 1, { discount: d })], payments: [{ methodId: f.method('cash'), amount: 180 }] });
      const denied = await f.cashier.post('/pos/checkout', withDisc({ type: 'PERCENT', value: 10 })).expect(403);
      expect(denied.body.details.missing).toEqual(['pos:discount']);
      const mgrSession = (await f.openManager()).session.id;
      const o = (await f.manager.post('/pos/checkout', withDisc({ type: 'PERCENT', value: 10 })).expect(201)).body;
      expect(o).toMatchObject({ subtotal: 200, discountTotal: 20, total: 180, taxTotal: 30, status: 'COMPLETED' });
      const o2 = (await f.manager.post('/pos/checkout', { lines: [line(item.variantId, 1, { discount: { type: 'AMOUNT', value: 50 } })], payments: [{ methodId: f.method('cash'), amount: 150 }] }).expect(201)).body;
      expect(o2).toMatchObject({ discountTotal: 50, total: 150 });
      const free = (await f.manager.post('/pos/checkout', { lines: [line(item.variantId, 1, { discount: { type: 'AMOUNT', value: 9999 } })], payments: [] }).expect(201)).body;
      expect(free).toMatchObject({ total: 0, status: 'COMPLETED', paymentStatus: 'PAID' }); // fully discounted: nothing to pay
      await f.manager.post('/pos/checkout', withDisc({ type: 'PERCENT', value: 101 })).expect(400);
      await f.manager.post('/pos/checkout', withDisc({ type: 'AMOUNT', value: -1 })).expect(400);
      await f.closeSession(f.manager, mgrSession, 99999);
    });

    it('payment rules: exact payment, no overpayment, split tenders, only POS methods', async () => {
      const item = await f.newProduct({ price: 100 });
      const body = (payments: unknown[]) => ({ lines: [line(item.variantId)], payments });
      const over = await f.cashier.post('/pos/checkout', body([{ methodId: f.method('cash'), amount: 100.01 }])).expect(400);
      expect(over.body.code).toBe('OVERPAYMENT');
      await f.cashier.post('/pos/checkout', body([{ methodId: 'nope', amount: 100 }])).expect(400);
      expect((await f.cashier.post('/pos/checkout', body([{ methodId: f.cod, amount: 100 }])).expect(400)).body.code).toBe('INVALID_PAYMENT_METHOD'); // COD is online-only
      await f.cashier.post('/pos/checkout', body([{ methodId: f.method('cash'), amount: 0 }])).expect(400);
      const o = (await f.cashier.post('/pos/checkout', body([{ methodId: f.method('cash'), amount: 40 }, { methodId: f.method('card'), amount: 60, reference: 'SLIP-1' }])).expect(201)).body;
      expect(o.payments.map((p: any) => [p.method.name, p.amount, p.kind])).toEqual([['Espèces', 40, 'DEPOSIT'], ['Carte bancaire', 60, 'PAYMENT']]);
      expect(o.status).toBe('COMPLETED');
      const rep = (await f.cashier.get(`/pos/sessions/${session}/report`).expect(200)).body;
      const cashRow = rep.payments.find((p: any) => p.type === 'CASH'), cardRow = rep.payments.find((p: any) => p.type === 'CARD');
      expect(cardRow.received).toBeGreaterThanOrEqual(60);
      expect(cashRow.received).toBeGreaterThanOrEqual(40);
      // card money is NOT in the drawer: expected cash = float + cash received only
      expect(rep.cash.expected).toBeCloseTo(500 + rep.cash.sales + rep.cash.refunds + rep.cash.cashIn + rep.cash.cashOut, 2);
    });

    it('is atomic: not enough stock refuses the WHOLE sale and leaves no trace', async () => {
      const a = await f.newProduct({ price: 50, stock: 5 }), b = await f.newProduct({ price: 50, stock: 1 });
      const before = await f.prisma.raw.order.count();
      const payBefore = await f.prisma.raw.payment.count();
      const r = await f.cashier.post('/pos/checkout', { lines: [line(a.variantId, 2), line(b.variantId, 2)], payments: [{ methodId: f.method('cash'), amount: 200 }] }).expect(400);
      expect(r.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { available: 1, requested: 2 } });
      expect(await f.prisma.raw.order.count()).toBe(before);
      expect(await f.prisma.raw.payment.count()).toBe(payBefore);
      expect([await f.stockOf(a.variantId), await f.stockOf(b.variantId)]).toEqual([5, 1]); // first line's stock was NOT taken
    });

    it('only sells items that are on sale (active, unarchived)', async () => {
      const draft = await f.newProduct({ status: 'DRAFT' });
      const r = await f.cashier.post('/pos/checkout', { lines: [line(draft.variantId)], payments: [{ methodId: f.method('cash'), amount: 100 }] }).expect(400);
      expect(r.body.code).toBe('UNKNOWN_VARIANT');
      await f.cashier.post('/pos/checkout', { lines: [], payments: [] }).expect(400);
      await f.cashier.post('/pos/checkout', { lines: [line(draft.variantId, 0)], payments: [] }).expect(400);
    });

    it('is idempotent: the same clientRef returns the same order and sells once, even when submitted concurrently', async () => {
      const item = await f.newProduct({ price: 100, stock: 10 });
      const ref = randomUUID();
      const body = { clientRef: ref, lines: [line(item.variantId)], payments: [{ methodId: f.method('cash'), amount: 100 }] };
      const first = (await f.cashier.post('/pos/checkout', body).expect(201)).body;
      const again = (await f.cashier.post('/pos/checkout', body).expect(201)).body;
      expect(again.id).toBe(first.id);
      expect(again.replayed).toBe(true);
      expect(await f.stockOf(item.variantId)).toBe(9);

      const ref2 = randomUUID();
      const results = await Promise.all(Array.from({ length: 6 }, () => f.cashier.post('/pos/checkout', { ...body, clientRef: ref2 })));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await f.stockOf(item.variantId)).toBe(8); // one more sale, not six
      expect(await f.prisma.raw.order.count({ where: { clientRef: ref2 } })).toBe(1);
    });

    it('never oversells the last unit to two customers at once', async () => {
      const item = await f.newProduct({ price: 100, stock: 1 });
      const rs = await Promise.all([1, 2, 3, 4].map(() => f.cashier.post('/pos/checkout', { lines: [line(item.variantId)], payments: [{ methodId: f.method('card'), amount: 100 }] })));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 400 && r.body.code === 'INSUFFICIENT_STOCK')).toHaveLength(3);
      expect(await f.stockOf(item.variantId)).toBe(0);
    });

    it('permissions: a technician cannot sell; the cashier can read orders but not cancel or refund', async () => {
      const item = await f.newProduct();
      await f.technician.post('/pos/checkout', { lines: [line(item.variantId)], payments: [] }).expect(403);
      const o = (await f.cashier.post('/pos/checkout', { lines: [line(item.variantId)], payments: [{ methodId: f.method('cash'), amount: 100 }] }).expect(201)).body;
      await f.cashier.get(`/orders/${o.id}`).expect(200);
      expect((await f.cashier.post(`/orders/${o.id}/cancel`, { reason: 'x' }).expect(403)).body.details.missing).toEqual(['orders:cancel']);
      expect((await f.cashier.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: o.lines[0].id, quantity: 1 }] }).expect(403)).body.details.missing).toEqual(['returns:create']);
    });
  });
});
