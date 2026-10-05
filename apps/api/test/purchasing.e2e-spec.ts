import { INestApplication } from '@nestjs/common';
import { createTestApp } from './app';
import { setupSales } from './sales-helpers';
import { uid } from './helpers';

type F = Awaited<ReturnType<typeof setupSales>>;

describe('Purchasing: suppliers, orders, receipts, invoices, payments (e2e)', () => {
  let app: INestApplication;
  let f: F;
  let supplierId: string;
  beforeAll(async () => {
    app = await createTestApp();
    f = await setupSales(app);
    supplierId = (await f.admin.post('/suppliers', { code: `T${uid()}`.toUpperCase().slice(0, 12), name: `Supplier ${uid()}`, paymentTermsDays: 30 }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });

  const newPo = async (variantId: string, quantity = 10, unitCost = 50) =>
    (await f.admin.post('/purchase-orders', { supplierId, warehouseId: f.warehouse.casa, lines: [{ variantId, quantity, unitCost, taxRatePct: 20 }] }).expect(201)).body;

  it('suppliers: unique code, permissions', async () => {
    const dup = await f.admin.post('/suppliers', { code: 'SUP-LUXOTTICA', name: 'Dup' });
    expect(dup.status).toBe(409);
    await f.cashier.get('/suppliers').expect(403);
    await f.admin.get('/suppliers?search=luxottica').expect(200);
  });

  it('PO is priced tax-exclusive, edited only while draft, and needs approval to send', async () => {
    const item = await f.newProduct({ stock: 0 });
    const po = await newPo(item.variantId, 10, 50);
    expect(po.status).toBe('DRAFT');
    expect(Number(po.subtotal)).toBe(500);
    expect(Number(po.taxTotal)).toBe(100);
    expect(Number(po.total)).toBe(600);
    await f.admin.post(`/purchase-orders/${po.id}/receipts`, { lines: [{ purchaseOrderLineId: po.lines[0].id, quantity: 1 }] }).expect(409); // not sent
    await f.admin.post(`/purchase-orders/${po.id}/send`).expect(200);
    await f.admin.patch(`/purchase-orders/${po.id}`, { notes: 'x' }).expect(409);
  });

  it('partial then full receipt moves stock and cost; over-receipt is refused', async () => {
    const item = await f.newProduct({ stock: 0 });
    const po = await newPo(item.variantId, 10, 50);
    await f.admin.post(`/purchase-orders/${po.id}/send`).expect(200);
    const lineId = po.lines[0].id;
    const over = await f.admin.post(`/purchase-orders/${po.id}/receipts`, { lines: [{ purchaseOrderLineId: lineId, quantity: 11 }] }).expect(400);
    expect(over.body.code).toBe('OVER_RECEIPT');
    await f.admin.post(`/purchase-orders/${po.id}/receipts`, { lines: [{ purchaseOrderLineId: lineId, quantity: 4 }] }).expect(201);
    expect(await f.stockOf(item.variantId)).toBe(4);
    expect((await f.admin.get(`/purchase-orders/${po.id}`)).body.status).toBe('PARTIALLY_RECEIVED');
    await f.admin.post(`/purchase-orders/${po.id}/receipts`, { lines: [{ purchaseOrderLineId: lineId, quantity: 6 }] }).expect(201);
    expect(await f.stockOf(item.variantId)).toBe(10);
    expect((await f.admin.get(`/purchase-orders/${po.id}`)).body.status).toBe('RECEIVED');
    await f.admin.post(`/purchase-orders/${po.id}/cancel`).expect(409); // has receipts
  });

  it('voiding a receipt reverses stock; an invoiced receipt cannot be voided', async () => {
    const item = await f.newProduct({ stock: 0 });
    const po = await newPo(item.variantId, 5, 20);
    await f.admin.post(`/purchase-orders/${po.id}/send`).expect(200);
    const r = (await f.admin.post(`/purchase-orders/${po.id}/receipts`, { lines: [{ purchaseOrderLineId: po.lines[0].id, quantity: 5 }] }).expect(201)).body;
    await f.admin.post(`/goods-receipts/${r.id}/void`).expect(200);
    expect(await f.stockOf(item.variantId)).toBe(0);
    expect((await f.admin.get(`/purchase-orders/${po.id}`)).body.status).toBe('SENT');

    const r2 = (await f.admin.post(`/purchase-orders/${po.id}/receipts`, { lines: [{ purchaseOrderLineId: po.lines[0].id, quantity: 5 }] }).expect(201)).body;
    const un = (await f.admin.get(`/purchase-orders/${po.id}/uninvoiced`).expect(200)).body;
    await f.admin.post('/supplier-invoices', { supplierId, supplierRef: `V-${uid()}`, issuedAt: '2026-10-01', purchaseOrderId: po.id, lines: [{ description: 'x', quantity: 5, unitCost: 20, goodsReceiptLineId: un[0].goodsReceiptLineId }] }).expect(201);
    const blocked = await f.admin.post(`/goods-receipts/${r2.id}/void`).expect(409);
    expect(blocked.body.code).toBe('RECEIPT_INVOICED');
  });

  it('invoice matching, duplicates, payments and overdue', async () => {
    const item = await f.newProduct({ stock: 0 });
    const po = await newPo(item.variantId, 10, 100);
    await f.admin.post(`/purchase-orders/${po.id}/send`).expect(200);
    await f.admin.post(`/purchase-orders/${po.id}/receipts`, { lines: [{ purchaseOrderLineId: po.lines[0].id, quantity: 6 }] }).expect(201);
    const un = (await f.admin.get(`/purchase-orders/${po.id}/uninvoiced`).expect(200)).body;
    const glid = un[0].goodsReceiptLineId;
    const ref = `F-${uid()}`;
    const body = (q: number, r = ref) => ({ supplierId, supplierRef: r, issuedAt: '2026-01-01', purchaseOrderId: po.id, lines: [{ description: 'Frames', quantity: q, unitCost: 100, goodsReceiptLineId: glid }] });
    const tooMuch = await f.admin.post('/supplier-invoices', body(7)).expect(409);
    expect(tooMuch.body.code).toBe('INVOICE_EXCEEDS_RECEIPT');
    const inv = (await f.admin.post('/supplier-invoices', body(6)).expect(201)).body;
    expect(Number(inv.total)).toBe(720);
    expect(inv.isOverdue).toBe(true); // issued Jan 1 + 30d terms
    expect((await f.admin.post('/supplier-invoices', body(1, ref)).expect(409)).body.code).toBe('DUPLICATE_INVOICE');
    expect((await f.admin.post('/supplier-invoices', body(1, `${ref}-b`)).expect(409)).body.code).toBe('INVOICE_EXCEEDS_RECEIPT');

    const cash = f.method('cash');
    await f.cashier.post(`/supplier-invoices/${inv.id}/payments`, { methodId: cash, amount: 10 }).expect(403);
    expect((await f.admin.post(`/supplier-invoices/${inv.id}/payments`, { methodId: cash, amount: 721 }).expect(400)).body.code).toBe('OVERPAYMENT');
    const half = (await f.admin.post(`/supplier-invoices/${inv.id}/payments`, { methodId: cash, amount: 300 }).expect(201)).body;
    expect(half.status).toBe('PARTIALLY_PAID');
    expect(half.balance).toBe(420);
    await f.admin.post(`/supplier-invoices/${inv.id}/void`).expect(409); // has payments
    const sum = (await f.admin.get('/purchasing/summary').expect(200)).body;
    expect(sum.overdueInvoices).toBeGreaterThanOrEqual(1);
    const st = (await f.admin.get(`/suppliers/${supplierId}/statement`).expect(200)).body;
    expect(st.totals.balance).toBeGreaterThanOrEqual(420);
    const done = (await f.admin.post(`/supplier-invoices/${inv.id}/payments`, { methodId: cash, amount: 420 }).expect(201)).body;
    expect(done.status).toBe('PAID');
    await f.admin.post(`/supplier-invoices/${inv.id}/payments`, { methodId: cash, amount: 1 }).expect(409);
    expect((await f.admin.get('/supplier-invoices?overdue=true').expect(200)).body.data.some((i: { id: string }) => i.id === inv.id)).toBe(false);
  });

  it('direct receipt (no PO) adds stock; PO document renders', async () => {
    const item = await f.newProduct({ stock: 0 });
    await f.admin.post('/goods-receipts', { supplierId, warehouseId: f.warehouse.casa, lines: [{ variantId: item.variantId, quantity: 3, unitCost: 10 }] }).expect(201);
    expect(await f.stockOf(item.variantId)).toBe(3);
    const po = await newPo(item.variantId);
    const doc = (await f.admin.get(`/purchase-orders/${po.id}/document?locale=fr`).expect(200)).body;
    expect(doc.html).toContain(po.number);
    expect(doc.html).toContain('Bon de commande');
  });

  it('a supplier in use cannot be deleted', async () => {
    expect((await f.admin.del(`/suppliers/${supplierId}`)).status).toBe(409);
  });
});
