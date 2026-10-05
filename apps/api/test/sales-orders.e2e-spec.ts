import { INestApplication } from '@nestjs/common';
import { createTestApp } from './app';
import { setupSales } from './sales-helpers';
import { uid } from './helpers';

type F = Awaited<ReturnType<typeof setupSales>>;
const line = (variantId: string, quantity = 1, extra: Record<string, unknown> = {}) => ({ variantId, quantity, ...extra });

describe('Prescription orders, returns, quotes, documents, scoping, reports (e2e)', () => {
  let app: INestApplication;
  let f: F;
  let cashSession: string, mgrSession: string;
  let sv: Awaited<ReturnType<F['lensOptions']>>[number], prog: typeof sv, plano: typeof sv, ar: { id: string; name: string; price: number };

  beforeAll(async () => {
    app = await createTestApp();
    f = await setupSales(app);
    cashSession = (await f.openCashier(1000)).session.id;
    mgrSession = (await f.openManager(1000)).session.id;
    const lens = await f.lensOptions();
    sv = lens.find((l) => l.code === 'single_vision')!; prog = lens.find((l) => l.code === 'progressive')!; plano = lens.find((l) => l.code === 'plano')!;
    ar = sv.treatments.find((t) => /reflet/i.test(t.name))!;
  });
  afterAll(async () => {
    await f.closeSession(f.cashier, cashSession, 99999).catch(() => undefined);
    await f.closeSession(f.manager, mgrSession, 99999).catch(() => undefined);
    await app.close();
  });

  const cash = () => f.method('cash'), card = () => f.method('card');
  const frame = (o: { price?: number; stock?: number } = {}) => f.newProduct({ type: 'FRAME', lens: true, price: o.price ?? 1000, stock: o.stock ?? 10 });
  const sell = async (variantId: string, qty: number, amount: number, extra: Record<string, unknown> = {}, who = f.cashier) =>
    (await who.post('/pos/checkout', { lines: [line(variantId, qty, extra)], payments: [{ methodId: cash(), amount }] }).expect(201)).body;

  describe('prescription (lens) orders', () => {
    it('deposit rule, balance tracking, treatments/prescription snapshot, then delivery', async () => {
      const fr = await frame({ price: 1000 });
      const { customer, rx } = await f.customerWithRx();
      const entry = sv.entries.find((e) => e.price === 200) ?? sv.entries[0];
      const cart = (amount: number) => ({ customerId: customer.id, lines: [line(fr.variantId, 1, { lens: { lensTypeId: sv.id, lensEntryId: entry.id, treatmentIds: [ar.id], prescriptionId: rx.id } })], payments: [{ methodId: cash(), amount }] });
      const total = 1000 + entry.price + ar.price;
      const low = await f.cashier.post('/pos/checkout', cart(Math.floor(total * 0.3) - 1)).expect(400);
      expect(low.body).toMatchObject({ code: 'DEPOSIT_TOO_LOW', details: { percent: 30, minimum: Math.ceil(total * 0.3) } });
      await f.cashier.post('/pos/checkout', { ...cart(0), payments: [] }).expect(400);

      const deposit = Math.ceil(total * 0.3);
      const o = (await f.cashier.post('/pos/checkout', cart(deposit)).expect(201)).body;
      expect(o).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PARTIAL', total, paidTotal: deposit, balanceDue: total - deposit });
      expect(o.payments[0].kind).toBe('DEPOSIT');
      expect(o.invoices[0].status).toBe('PARTIALLY_PAID');
      const lc = o.lines[0].lensConfig;
      expect(lc).toMatchObject({ lensPrice: entry.price, treatmentsPrice: ar.price, prescriptionId: rx.id });
      expect(lc.prescriptionSnapshot).toMatchObject({ odSph: -2, odCyl: -0.5, odAxis: 90, osSph: -1.75 });
      expect(lc.treatments).toEqual([expect.objectContaining({ name: ar.name, price: ar.price })]);
      expect(o.lines[0].description).toContain(entry.name);
      expect(await f.stockOf(fr.variantId)).toBe(9);
      // the snapshot keeps the order stable even if the prescription changes afterwards
      await f.admin.patch(`/prescriptions/${rx.id}`, { odSph: -3 }).expect(200);
      expect((await f.cashier.get(`/orders/${o.id}`)).body.lines[0].lensConfig.prescriptionSnapshot.odSph).toBe(-2);

      await f.cashier.post(`/orders/${o.id}/deliver`).expect(409).then((r) => expect(r.body).toMatchObject({ code: 'BALANCE_DUE', details: { due: total - deposit } }));
      const over = await f.cashier.post(`/orders/${o.id}/payments`, { methodId: card(), amount: total - deposit + 0.01 }).expect(400);
      expect(over.body.code).toBe('OVERPAYMENT');
      const part = (await f.cashier.post(`/orders/${o.id}/payments`, { methodId: card(), amount: 500 }).expect(201)).body;
      expect(part).toMatchObject({ paymentStatus: 'PARTIAL', balanceDue: total - deposit - 500, status: 'CONFIRMED' });
      const full = (await f.cashier.post(`/orders/${o.id}/payments`, { methodId: card(), amount: total - deposit - 500 }).expect(201)).body;
      expect(full).toMatchObject({ paymentStatus: 'PAID', balanceDue: 0, paidTotal: total, status: 'CONFIRMED' }); // prescription order waits for hand-over
      expect(full.invoices[0].status).toBe('PAID');
      await f.cashier.post(`/orders/${o.id}/payments`, { methodId: card(), amount: 1 }).expect(409).then((r) => expect(r.body.code).toBe('NOTHING_DUE'));
      const done = (await f.cashier.post(`/orders/${o.id}/deliver`).expect(200)).body;
      expect(done.status).toBe('COMPLETED');
    });

    it('lens validation: customer, prescription, expiry, addition, range, treatment, frame type', async () => {
      const fr = await frame();
      const { customer, rx } = await f.customerWithRx();
      const post = (lens: Record<string, unknown> | undefined, over: Record<string, unknown> = {}) => f.cashier.post('/pos/checkout', { customerId: customer.id, lines: [line(fr.variantId, 1, lens && { lens })], payments: [{ methodId: cash(), amount: 400 }], ...over });
      const base = { lensTypeId: sv.id, prescriptionId: rx.id };

      expect((await post(base, { customerId: undefined }).expect(400)).body.code).toBe('CUSTOMER_REQUIRED');
      expect((await post({ lensTypeId: sv.id }).expect(400)).body.code).toBe('PRESCRIPTION_REQUIRED');
      expect((await post({ ...base, prescriptionId: 'nope' }).expect(400)).body.code).toBe('PRESCRIPTION_NOT_FOUND');
      const other = await f.customerWithRx();
      expect((await post({ ...base, prescriptionId: other.rx.id }).expect(400)).body.code).toBe('PRESCRIPTION_NOT_FOUND'); // someone else's prescription
      const old = await f.customerWithRx({ issuedAt: '2020-01-01', expiresAt: '2022-01-01' });
      expect((await post({ lensTypeId: sv.id, prescriptionId: old.rx.id }, { customerId: old.customer.id }).expect(400)).body.code).toBe('PRESCRIPTION_EXPIRED');
      expect((await post({ lensTypeId: prog.id, prescriptionId: rx.id }).expect(400)).body.code).toBe('ADDITION_REQUIRED'); // progressive needs ADD
      const withAdd = await f.customerWithRx({ odAdd: 2, osAdd: 2 });
      await post({ lensTypeId: prog.id, prescriptionId: withAdd.rx.id }, { customerId: withAdd.customer.id, payments: [{ methodId: cash(), amount: 1000 }] }).expect(201);
      const strong = await f.customerWithRx({ odSph: -9 });
      const narrow = sv.entries.find((e) => e.sphMin != null && e.sphMin > -9)!;
      expect((await post({ lensTypeId: sv.id, lensEntryId: narrow.id, prescriptionId: strong.rx.id }, { customerId: strong.customer.id }).expect(400)).body).toMatchObject({ code: 'LENS_OUT_OF_RANGE', details: { eye: 'OD', sph: -9 } });
      const newT = (await f.admin.post('/lens-treatments', { code: `unlinked_${uid()}`.replace(/[^a-z0-9_]/g, ''), category: 'TINT', name: 'Unlinked', price: 10 }).expect(201)).body;
      expect((await post({ ...base, treatmentIds: [newT.id] }).expect(400)).body.code).toBe('TREATMENT_NOT_AVAILABLE');
      expect((await post({ ...base, lensEntryId: prog.entries[0].id }).expect(400)).body.message).toMatch(/does not belong/);
      const acc = await f.newProduct();
      expect((await f.cashier.post('/pos/checkout', { customerId: customer.id, lines: [line(acc.variantId, 1, { lens: base })], payments: [{ methodId: cash(), amount: 300 }] }).expect(400)).body.message).toMatch(/frames and sunglasses/);
      // plano (no correction) needs no prescription
      const sun = await frame({ price: 500 });
      const p = (await f.cashier.post('/pos/checkout', { customerId: customer.id, lines: [line(sun.variantId, 1, { lens: { lensTypeId: plano.id } })], payments: [{ methodId: cash(), amount: 500 }] }).expect(201)).body;
      expect(p.lines[0].lensConfig.prescriptionId).toBeNull();
    });
  });

  describe('returns, refunds and cancellation', () => {
    it('partial return: stock back, credit note, refund from the drawer, order marked partially refunded', async () => {
      const it = await f.newProduct({ price: 100, stock: 10 });
      const o = await sell(it.variantId, 3, 300);
      const before = (await f.manager.get(`/pos/sessions/${mgrSession}/report`).expect(200)).body.cash.expected;
      const r = (await f.manager.post(`/orders/${o.id}/returns`, { reason: 'Changed mind', lines: [{ orderLineId: o.lines[0].id, quantity: 1 }], refund: { methodId: cash() } }).expect(201)).body;
      expect(r).toMatchObject({ status: 'REFUNDED', refundTotal: 100 });
      expect(r.number).toMatch(/^CASA-RET-\d{4}-\d{6}$/);
      expect(r.creditNotes[0].number).toMatch(/^CASA-AVR-\d{4}-\d{6}$/);
      expect(Number(r.creditNotes[0].total)).toBe(100);
      expect(r.order).toMatchObject({ paymentStatus: 'PARTIALLY_REFUNDED', paidTotal: 200, balanceDue: 0 });
      expect(await f.stockOf(it.variantId)).toBe(8); // 10 - 3 + 1
      expect(await f.prisma.raw.stockMovement.count({ where: { variantId: it.variantId, type: 'SALE_RETURN', quantity: 1 } })).toBe(1);
      const after = (await f.manager.get(`/pos/sessions/${mgrSession}/report`).expect(200)).body.cash;
      expect(after.expected).toBe(before - 100);
      expect(after.refunds).toBeLessThanOrEqual(-100);
      const view = (await f.manager.get(`/orders/${o.id}`).expect(200)).body;
      expect(view.lines[0]).toMatchObject({ returnedQty: 1, returnableQty: 2 });
      expect(view.returns).toHaveLength(1);
      // the rest
      await f.manager.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: o.lines[0].id, quantity: 3 }] }).expect(400).then((x) => expect(x.body).toMatchObject({ code: 'RETURN_EXCEEDS_SOLD', details: { returnable: 2 } }));
      const all = (await f.manager.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: o.lines[0].id, quantity: 2 }], refund: { methodId: cash() } }).expect(201)).body;
      expect(all.order).toMatchObject({ paymentStatus: 'REFUNDED', paidTotal: 0 });
      expect(await f.stockOf(it.variantId)).toBe(10);
    });

    it('refund rounding: returning units one by one refunds EXACTLY what was paid, to the cent', async () => {
      const it = await f.newProduct({ price: 33.33, stock: 10 });
      const o = (await f.manager.post('/pos/checkout', { lines: [line(it.variantId, 3, { discount: { type: 'AMOUNT', value: 0.01 } })], payments: [{ methodId: cash(), amount: 99.98 }] }).expect(201)).body;
      expect(o.total).toBe(99.98);
      const refunds: number[] = [];
      for (let i = 0; i < 3; i++) refunds.push((await f.manager.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: o.lines[0].id, quantity: 1 }], refund: { methodId: cash() } }).expect(201)).body.refundTotal);
      expect(refunds).toEqual([33.33, 33.33, 33.32]);
      expect(Math.round(refunds.reduce((a, b) => a + b, 0) * 100)).toBe(9998);
      expect((await f.manager.get(`/orders/${o.id}`)).body).toMatchObject({ paymentStatus: 'REFUNDED', paidTotal: 0 });
    });

    it('guards: permission, refund ceiling, damaged goods stay out of stock, unknown lines, drawer cash, no session', async () => {
      const it = await f.newProduct({ price: 100, stock: 5 });
      const o = await sell(it.variantId, 2, 200);
      const ln = o.lines[0].id;
      await f.cashier.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: ln, quantity: 1 }] }).expect(403);
      expect((await f.manager.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: 'nope', quantity: 1 }] }).expect(400)).body.code).toBe('UNKNOWN_LINE');
      expect((await f.manager.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: ln, quantity: 1 }, { orderLineId: ln, quantity: 1 }] }).expect(400)).body.message).toMatch(/only appear once/);
      expect((await f.manager.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: ln, quantity: 1 }], refund: { methodId: cash(), amount: 250 } }).expect(400)).body.code).toBe('REFUND_EXCEEDS_PAID');
      expect((await f.manager.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: ln, quantity: 1 }], refund: { methodId: cash(), amount: 150 } }).expect(400)).body.code).toBe('REFUND_EXCEEDS_RETURN');
      // damaged: money back, but NOT back on the shelf
      const d = (await f.manager.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: ln, quantity: 1, condition: 'DAMAGED' }], refund: { methodId: card() } }).expect(201)).body;
      expect(d.lines[0]).toMatchObject({ condition: 'DAMAGED', restock: false });
      expect(await f.stockOf(it.variantId)).toBe(3);
      // a return without a refund is allowed (credit later): APPROVED, nothing paid back
      const nr = (await f.manager.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: ln, quantity: 1 }] }).expect(201)).body;
      expect(nr).toMatchObject({ status: 'APPROVED', refundTotal: 0 });
      // cash refunds need the drawer to hold the cash
      const big = await f.newProduct({ price: 5000, stock: 2 });
      const bo = await sell(big.variantId, 1, 5000, {}, f.cashier);
      const noCash = await f.manager.post(`/orders/${bo.id}/returns`, { lines: [{ orderLineId: bo.lines[0].id, quantity: 1 }], refund: { methodId: cash() } }).expect(400);
      expect(noCash.body.code).toBe('INSUFFICIENT_CASH');
      // refund to a card needs no open session and no drawer cash
      await f.manager.post(`/orders/${bo.id}/returns`, { lines: [{ orderLineId: bo.lines[0].id, quantity: 1 }], refund: { methodId: card() } }).expect(201);
    });

    it('cancel: only before hand-over; refunds what was paid; restocks everything', async () => {
      const fr = await frame({ price: 1000, stock: 5 });
      const { customer, rx } = await f.customerWithRx();
      const o = (await f.cashier.post('/pos/checkout', { customerId: customer.id, lines: [line(fr.variantId, 1, { lens: { lensTypeId: sv.id, prescriptionId: rx.id } })], payments: [{ methodId: cash(), amount: 500 }] }).expect(201)).body;
      expect(await f.stockOf(fr.variantId)).toBe(4);
      expect((await f.manager.post(`/orders/${o.id}/cancel`, { reason: 'Customer withdrew' }).expect(400)).body).toMatchObject({ code: 'REFUND_REQUIRED', details: { paid: 500 } });
      await f.cashier.post(`/orders/${o.id}/cancel`, { reason: 'x', refund: { methodId: cash() } }).expect(403);
      const c = (await f.manager.post(`/orders/${o.id}/cancel`, { reason: 'Customer withdrew', refund: { methodId: cash() } }).expect(200)).body;
      expect(c.order).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED', paidTotal: 0 });
      expect(Number(c.refundTotal)).toBe(500);
      expect(await f.stockOf(fr.variantId)).toBe(5);
      expect((await f.manager.get(`/orders/${o.id}`).expect(200)).body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Customer withdrew' });
      await f.manager.post(`/orders/${o.id}/cancel`, { reason: 'again' }).expect(409);
      await f.cashier.post(`/orders/${o.id}/payments`, { methodId: cash(), amount: 1 }).expect(409);
      // a completed (handed over) sale is returned, not cancelled
      const plain = await sell((await f.newProduct()).variantId, 1, 100);
      await f.manager.post(`/orders/${plain.id}/cancel`, { reason: 'x', refund: { methodId: cash() } }).expect(409).then((r) => expect(r.body.code).toBe('INVALID_STATE'));
    });
  });

  describe('quotes', () => {
    it('draft -> edit -> sent -> accepted, loads into the till, and converts at checkout exactly once', async () => {
      const fr = await frame({ price: 800 });
      const { customer, rx } = await f.customerWithRx();
      const lens = { lensTypeId: sv.id, prescriptionId: rx.id, treatmentIds: [ar.id] };
      const q = (await f.cashier.post('/quotes', { customerId: customer.id, validUntil: '2099-01-01', notes: 'Pour Mme', lines: [line(fr.variantId, 1, { lens })] }).expect(201)).body;
      expect(q).toMatchObject({ status: 'DRAFT', total: 800 + sv.basePrice + ar.price });
      expect(q.number).toMatch(/^CASA-DEV-\d{4}-\d{6}$/);
      expect(await f.stockOf(fr.variantId)).toBe(10); // a quote reserves nothing
      const edited = (await f.cashier.patch(`/quotes/${q.id}`, { lines: [line(fr.variantId, 2)] }).expect(200)).body;
      expect(edited.total).toBe(1600);
      await f.cashier.post(`/quotes/${q.id}/send`).expect(200);
      await f.cashier.patch(`/quotes/${q.id}`, { notes: 'x' }).expect(409); // only drafts are editable
      await f.manager.del(`/quotes/${q.id}`).expect(409);
      await f.cashier.post(`/quotes/${q.id}/send`).expect(409);
      expect((await f.cashier.post(`/quotes/${q.id}/accept`).expect(200)).body.status).toBe('ACCEPTED');
      await f.cashier.post(`/quotes/${q.id}/reject`).expect(409);
      const cart = (await f.cashier.get(`/quotes/${q.id}/cart`).expect(200)).body;
      expect(cart).toMatchObject({ quoteId: q.id, customerId: customer.id, lines: [{ variantId: fr.variantId, quantity: 2 }] });
      const o = (await f.cashier.post('/pos/checkout', { quoteId: q.id, lines: cart.lines, payments: [{ methodId: cash(), amount: 1600 }] }).expect(201)).body;
      expect(o.customer.id).toBe(customer.id); // the quote's customer carries over
      expect(await f.stockOf(fr.variantId)).toBe(8);
      const conv = (await f.cashier.get(`/quotes/${q.id}`).expect(200)).body;
      expect(conv).toMatchObject({ status: 'CONVERTED', convertedOrderId: o.id });
      await f.cashier.post('/pos/checkout', { quoteId: q.id, lines: cart.lines, payments: [{ methodId: cash(), amount: 1600 }] }).expect(409).then((r) => expect(r.body.code).toBe('QUOTE_NOT_USABLE'));
    });

    it('quotes expire, drafts can be deleted, and lens rules still apply when quoting', async () => {
      const item = await f.newProduct({ price: 100 });
      const old = (await f.cashier.post('/quotes', { validUntil: '2020-01-01', lines: [line(item.variantId)] }).expect(201)).body;
      expect((await f.cashier.get(`/quotes/${old.id}`).expect(200)).body.status).toBe('EXPIRED');
      await f.cashier.post('/pos/checkout', { quoteId: old.id, lines: [line(item.variantId)], payments: [{ methodId: cash(), amount: 100 }] }).expect(409);
      const draft = (await f.cashier.post('/quotes', { lines: [line(item.variantId)] }).expect(201)).body;
      await f.cashier.del(`/quotes/${draft.id}`).expect(403); // deleting is a manager task
      await f.manager.del(`/quotes/${draft.id}`).expect(204);
      await f.cashier.get(`/quotes/${draft.id}`).expect(404);
      const fr = await frame();
      await f.cashier.post('/quotes', { lines: [line(fr.variantId, 1, { lens: { lensTypeId: sv.id } })] }).expect(400); // lens needs a customer
      const list = (await f.cashier.get('/quotes?search=CASA-DEV&limit=5').expect(200)).body;
      expect(list.meta.total).toBeGreaterThan(0);
      await f.technician.get('/quotes').expect(403);
    });
  });

  describe('documents', () => {
    it('receipt, invoice and quote render as printable HTML in fr/en/ar; customer-supplied text can never inject markup', async () => {
      const evil = await f.newCustomer({ firstName: '<img src=x onerror=alert(1)>', lastName: '"><script>alert(2)</script>' });
      const it = await f.newProduct({ price: 250 });
      const o = (await f.cashier.post('/pos/checkout', { customerId: evil.id, lines: [line(it.variantId)], payments: [{ methodId: cash(), amount: 250 }] }).expect(201)).body;

      const rec = (await f.cashier.get(`/orders/${o.id}/receipt`).expect(200)).body;
      expect(rec).toMatchObject({ number: o.number, locale: 'fr' });
      expect(rec.html).toContain(o.number);
      expect(rec.html).toContain('dir="ltr"');
      expect(rec.html).toMatch(/250,00/);
      expect(rec.html).not.toMatch(/<img src=x|<script>alert/);
      expect(rec.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      const ar = (await f.cashier.get(`/orders/${o.id}/receipt?locale=ar`).expect(200)).body;
      expect(ar.html).toContain('dir="rtl"');
      expect(ar.html).toContain('وصل');
      await f.cashier.get(`/orders/${o.id}/receipt?locale=xx`).expect(400);

      const inv = (await f.cashier.get(`/invoices/${o.invoices[0].id}/document?locale=en`).expect(200)).body;
      expect(inv.html).toContain(o.invoices[0].number);
      expect(inv.html).toContain('Invoice');
      expect(inv.html).toContain('000000000000000'); // the company's ICE from branding.legal, printed on the invoice
      expect(inv.html).toMatch(/Total incl\. VAT/);
      expect(inv.html).not.toMatch(/<img src=x|<script>alert/);

      const q = (await f.cashier.post('/quotes', { customerId: evil.id, validUntil: '2099-02-03', lines: [line(it.variantId)] }).expect(201)).body;
      const qd = (await f.cashier.get(`/quotes/${q.id}/document`).expect(200)).body;
      expect(qd.html).toContain(q.number);
      expect(qd.html).toContain('Devis');
      expect(qd.html).not.toMatch(/Balance|Reste à payer/);
      expect(qd.html).not.toMatch(/<script>alert/);
    });

    it('prints a deposit receipt with the balance still due, and a refund line after a return', async () => {
      const fr = await frame({ price: 1000 });
      const { customer, rx } = await f.customerWithRx();
      const o = (await f.cashier.post('/pos/checkout', { customerId: customer.id, lines: [line(fr.variantId, 1, { lens: { lensTypeId: sv.id, prescriptionId: rx.id } })], payments: [{ methodId: cash(), amount: 400 }] }).expect(201)).body;
      const rec = (await f.cashier.get(`/orders/${o.id}/receipt`).expect(200)).body.html;
      expect(rec).toMatch(/Reste à payer/);
      expect(rec).toMatch(/Verres sur ordonnance/);
    });
  });

  describe('visibility, listing and reports', () => {
    it('store scoping: Rabat orders are invisible to a Casablanca manager; super admin sees both', async () => {
      const rab = await f.newProduct({ price: 100, wh: f.warehouse.rabat });
      const s = (await f.rabatAdmin.post('/pos/sessions', { registerId: f.registers.rabat, openingFloat: 50 }).expect(201)).body;
      try {
        const o = (await f.rabatAdmin.post('/pos/checkout', { lines: [line(rab.variantId)], payments: [{ methodId: cash(), amount: 100 }] }).expect(201)).body;
        expect(o.number).toMatch(/^RABAT-CMD-/);
        await f.manager.get(`/orders/${o.id}`).expect(403);
        await f.manager.get(`/orders/${o.id}/receipt`).expect(403);
        await f.manager.get(`/invoices/${o.invoices[0].id}`).expect(403);
        await f.manager.post(`/orders/${o.id}/returns`, { lines: [{ orderLineId: o.lines[0].id, quantity: 1 }] }).expect(403);
        expect((await f.manager.get(`/orders?search=${o.number}`).expect(200)).body.meta.total).toBe(0);
        expect((await f.admin.get(`/orders?search=${o.number}`).expect(200)).body.meta.total).toBe(1);
        await f.manager.get(`/orders?storeId=${f.rabat}`).expect(403);
        // selling Rabat's stock from the Casablanca till fails: the sale takes stock from the ACTIVE store's warehouse
        const r = await f.cashier.post('/pos/checkout', { lines: [line(rab.variantId)], payments: [{ methodId: cash(), amount: 100 }] }).expect(400);
        expect(r.body.code).toBe('INSUFFICIENT_STOCK');
      } finally { await f.rabatAdmin.post(`/pos/sessions/${s.session.id}/close`, { countedCash: 999 }); }
    });

    it('lists orders with search/filters and a customer purchase history', async () => {
      const { customer } = await f.customerWithRx();
      const it = await f.newProduct({ price: 100 });
      const paid = (await f.cashier.post('/pos/checkout', { customerId: customer.id, lines: [line(it.variantId)], payments: [{ methodId: cash(), amount: 100 }] }).expect(201)).body;
      const fr = await frame();
      const { rx } = { rx: (await f.admin.get(`/customers/${customer.id}/prescriptions`)).body[0] };
      const open = (await f.cashier.post('/pos/checkout', { customerId: customer.id, lines: [line(fr.variantId, 1, { lens: { lensTypeId: sv.id, prescriptionId: rx.id } })], payments: [{ methodId: cash(), amount: 400 }] }).expect(201)).body;
      const byName = (await f.cashier.get(`/orders?search=${encodeURIComponent(customer.lastName)}`).expect(200)).body;
      expect(byName.data.map((x: any) => x.id).sort()).toEqual([paid.id, open.id].sort());
      expect((await f.cashier.get(`/orders?search=${customer.phone.slice(-6)}`)).body.meta.total).toBe(2);
      const owing = (await f.cashier.get(`/orders?customerId=${customer.id}&hasBalance=true`)).body.data;
      expect(owing.map((x: any) => x.id)).toEqual([open.id]);
      expect((await f.cashier.get(`/orders?customerId=${customer.id}&paymentStatus=PAID`)).body.data.map((x: any) => x.id)).toEqual([paid.id]);
      expect((await f.cashier.get(`/orders?customerId=${customer.id}&status=COMPLETED&channel=POS`)).body.data).toHaveLength(1);
      const history = (await f.cashier.get(`/customers/${customer.id}/orders`).expect(200)).body;
      expect(history.meta.total).toBe(2);
      expect(history.data[0]).toHaveProperty('invoices');
      await f.cashier.get('/orders?status=NOPE').expect(400);
      await f.cashier.get('/orders?limit=1000').expect(400);
      const inv = (await f.cashier.get(`/invoices?search=${paid.invoices[0].number}`).expect(200)).body;
      expect(inv.data.map((x: any) => x.id)).toEqual([paid.invoices[0].id]);
      const invDetail = (await f.cashier.get(`/invoices/${paid.invoices[0].id}`).expect(200)).body;
      expect(invDetail.lines).toHaveLength(1);
      await f.technician.get('/orders').expect(403);
    });

    it('daily report adds up every session, payment method, refund and discount for the day', async () => {
      const day = new Date().toISOString().slice(0, 10);
      const rep = (await f.manager.get(`/pos/reports/daily?date=${day}`).expect(200)).body;
      expect(rep).toMatchObject({ date: day, timezone: 'Africa/Casablanca' });
      expect(rep.sales.orders).toBeGreaterThan(5);
      const cashRow = rep.payments.find((p: any) => p.type === 'CASH'), cardRow = rep.payments.find((p: any) => p.type === 'CARD');
      expect(cashRow.received).toBeGreaterThan(0);
      expect(cardRow.refunded).toBeGreaterThan(0); // the card refunds above
      expect(rep.netCollected).toBeCloseTo(rep.payments.reduce((n: number, p: any) => n + p.net, 0), 2);
      expect(rep.returns.count).toBeGreaterThan(0);
      expect(rep.unclosedSessions).toBeGreaterThanOrEqual(2); // the two drawers this suite has open
      expect(rep.sessions.some((s: any) => s.id === cashSession)).toBe(true);
      await f.manager.get('/pos/reports/daily?date=05-10-2026').expect(400);
      await f.manager.get(`/pos/reports/daily?storeId=${f.rabat}`).expect(403);
      await f.cashier.get('/pos/reports/daily').expect(200); // the cashier role holds pos:manage_register
      await f.technician.get('/pos/reports/daily').expect(403);
      const list = (await f.manager.get('/pos/sessions?status=OPEN').expect(200)).body;
      expect(list.data.every((s: any) => s.status === 'OPEN')).toBe(true);
      expect((await f.manager.get('/pos/sessions?limit=3').expect(200)).body.meta.limit).toBe(3);
    });

    it('config for the till and parked sales', async () => {
      const cfg = (await f.cashier.get('/pos/config').expect(200)).body;
      expect(cfg.paymentMethods.map((m: any) => m.code)).toEqual(expect.arrayContaining(['cash', 'card']));
      expect(cfg.paymentMethods.map((m: any) => m.code)).not.toContain('cod');
      expect(cfg.settings).toMatchObject({ requireOpenSession: true, minDepositPct: 30, allowNegativeStock: false });
      expect(cfg.defaultTax).toMatchObject({ rate: 20, isInclusive: true });
      expect(cfg.currentSession.id).toBe(cashSession);
      expect(cfg.registers.find((r: any) => r.id === f.registers.c1).openSession.id).toBe(cashSession);
      const lens = (await f.cashier.get('/pos/lens-options').expect(200)).body;
      expect(lens.find((l: any) => l.code === 'progressive')).toMatchObject({ requiresAdd: true });
      expect(lens[0].treatments.length).toBeGreaterThan(0);

      const h = (await f.cashier.post('/pos/held', { label: 'Mme Alaoui', cart: { lines: [{ variantId: 'x', quantity: 1 }] } }).expect(201)).body;
      expect((await f.cashier.get('/pos/held').expect(200)).body.map((x: any) => x.id)).toContain(h.id);
      await f.cashier.post('/pos/held', { cart: 'not an object' }).expect(400);
      await f.cashier.post('/pos/held', { cart: { blob: 'x'.repeat(70_000) } }).expect(400);
      await f.technician.get('/pos/held').expect(403);
      await f.cashier.del(`/pos/held/${h.id}`).expect(204);
      await f.cashier.del(`/pos/held/${h.id}`).expect(404);
    });
  });
});
