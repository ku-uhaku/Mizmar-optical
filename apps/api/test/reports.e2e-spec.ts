import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { createTestApp } from './app';
import { setupSales } from './sales-helpers';
import { uid } from './helpers';

type F = Awaited<ReturnType<typeof setupSales>>;
const today = () => new Date().toISOString().slice(0, 10);
const q = (extra = '') => `from=${today()}&to=${today()}${extra}`;

describe('Reports and exports (e2e)', () => {
  let app: INestApplication;
  let f: F;
  let name: string;
  let orderId: string;
  beforeAll(async () => {
    app = await createTestApp(); f = await setupSales(app);
    // one sale with known figures: 2 × 1,200 TTC (VAT 20%), unit cost 400, then one unit returned and refunded
    name = `Report Item ${uid()}`;
    const res = await f.admin.post('/products', { type: 'FRAME', name, status: 'ACTIVE', variants: [{ sku: `REP-${uid()}`.toUpperCase(), price: 1200, cost: 400, initialStock: [{ warehouseId: f.warehouse.casa, quantity: 10 }] }] }).expect(201);
    const s = await f.openCashier(500);
    const sale = (await f.cashier.post('/pos/checkout', { clientRef: randomUUID(), lines: [{ variantId: res.body.variants[0].id, quantity: 2 }], payments: [{ methodId: f.method('cash'), amount: 2400 }] }).expect(201)).body;
    orderId = sale.id;
    await f.closeSession(f.cashier, s.session.id, 2900);
    const m = await f.openManager(2000);
    await f.manager.post(`/orders/${sale.id}/returns`, { reason: 'Changed mind', lines: [{ orderLineId: sale.lines[0].id, quantity: 1 }], refund: { methodId: f.method('cash') } }).expect(201);
    await f.closeSession(f.manager, m.session.id, 800);
  });
  afterAll(async () => { await app.close(); });

  const row = (body: { rows: { key: string }[] }, key: string) => body.rows.find((r) => r.key === key) as Record<string, number | string>;

  it('sales by product: revenue, VAT, cost and margin net of the return', async () => {
    const t = (await f.admin.get(`/reports/sales?${q('&groupBy=product')}`).expect(200)).body;
    const r = row(t, name);
    expect(r).toMatchObject({ orders: 1, units: 1, revenue: 1200, tax: 200, revenueEx: 1000, cost: 400, profit: 600, margin: 60 });
    expect(r.gross).toBe(2400); // gross is what was sold, before the refund
    expect(t.columns.map((c: { key: string }) => c.key)).toEqual(expect.arrayContaining(['revenue', 'tax', 'profit']));
  });

  it('every grouping works and adds up to the same totals', async () => {
    const totals: Record<string, number> = {};
    for (const g of ['day', 'week', 'month', 'store', 'employee', 'category', 'brand', 'product', 'type', 'channel']) {
      const t = (await f.admin.get(`/reports/sales?${q(`&groupBy=${g}`)}`).expect(200)).body;
      totals[g] = t.totals.revenue;
      const sum = t.rows.reduce((n: number, r: { revenue: number }) => n + r.revenue, 0);
      expect(sum).toBeCloseTo(t.totals.revenue, 1);
    }
    const values = Object.values(totals);
    values.forEach((v) => expect(v).toBeCloseTo(values[0], 1));
    const byEmployee = (await f.admin.get(`/reports/sales?${q('&groupBy=employee')}`)).body;
    expect(byEmployee.rows.some((r: { key: string }) => r.key.includes('Nadia'))).toBe(true); // the demo cashier, by name
    await f.admin.get(`/reports/sales?${q('&groupBy=nonsense')}`).expect(400);
    await f.admin.get('/reports/sales?from=2026-13-01&to=x').expect(400);
  });

  it('best sellers, stock value, profit and top customers respond with consistent tables', async () => {
    const best = (await f.admin.get(`/reports/best-sellers?${q('&by=revenue&limit=100')}`).expect(200)).body;
    // the shared test database holds thousands of sales today, so assert the ranking itself rather than one product's place in it
    expect(best.rows[0].rank).toBe(1);
    const revs = best.rows.map((r: { revenue: number }) => r.revenue);
    expect(revs).toEqual([...revs].sort((a: number, b: number) => b - a));
    const byUnits = (await f.admin.get(`/reports/best-sellers?${q('&by=units&limit=5')}`).expect(200)).body;
    expect(byUnits.rows).toHaveLength(5);
    const us = byUnits.rows.map((r: { units: number }) => r.units);
    expect(us).toEqual([...us].sort((a: number, b: number) => b - a));
    const stock = (await f.admin.get('/reports/stock-value').expect(200)).body;
    expect(stock.totals.costValue).toBeGreaterThan(0);
    expect(stock.totals.retailValue).toBeGreaterThanOrEqual(stock.totals.costValue);
    expect(stock.rows.reduce((n: number, r: { costValue: number }) => n + r.costValue, 0)).toBeCloseTo(stock.totals.costValue, 1);
    const profit = (await f.admin.get(`/reports/profit?${q()}`).expect(200)).body;
    expect(profit.rows).toHaveLength(1);
    expect(profit.totals.operating).toBeCloseTo(profit.totals.revenueEx - profit.totals.cost - profit.totals.expenses - profit.totals.payroll, 1);
    await f.admin.get(`/reports/top-customers?${q()}`).expect(200);
  });

  it('the dashboard summarises today, the month, a 30-day series and the alerts', async () => {
    const d = (await f.admin.get('/reports/dashboard').expect(200)).body;
    expect(d.sales.today).toBeGreaterThanOrEqual(1200);
    expect(d.sales.month).toBeGreaterThanOrEqual(d.sales.today);
    expect(d.series).toHaveLength(30);
    expect(d.series[29].date).toBe(today());
    expect(d.series[29].revenue).toBeGreaterThanOrEqual(1200);
    expect(d.alerts).toEqual(expect.objectContaining({ lowStock: expect.any(Number), openJobs: expect.any(Number), appointmentsToday: expect.any(Number) }));
    expect(d.topProducts.length).toBeGreaterThan(0);
  });

  it('exports: xlsx opens in Excel with real numbers, csv is safe, html is a print page', async () => {
    const res = await f.admin.get(`/reports/export/sales?${q('&groupBy=product&format=xlsx&locale=en')}`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (x: Buffer) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const header = ws.getRow(3).values as unknown[];
    expect(header).toContain('Revenue (incl. VAT)');
    let found: ExcelJS.Row | undefined;
    ws.eachRow((r) => { if (r.getCell(1).value === name) found = r; });
    expect(found).toBeTruthy();
    expect(typeof found!.getCell(6).value).toBe('number'); // a number, not text
    expect(found!.getCell(6).value).toBe(1200);

    const csv = (await f.admin.get(`/reports/export/sales?${q('&groupBy=product&format=csv')}`).expect(200)).text;
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(name);
    expect((await f.admin.get(`/reports/export/sales?${q('&groupBy=product&format=csv')}`)).headers['content-disposition']).toContain('.csv');

    const html = (await f.admin.get(`/reports/export/best-sellers?${q('&format=html&locale=ar')}`).expect(200)).body;
    expect(html.html).toContain('dir="rtl"');
    expect(html.html).toContain('<table>');
    await f.admin.get(`/reports/export/nope?${q()}`).expect(404);
    await f.cashier.get(`/reports/export/sales?${q()}`).expect(403);
    await f.cashier.get(`/reports/sales?${q()}`).expect(403);
  });

  it('CSV cells that look like formulas are neutralised', async () => {
    const { toCsv } = await import('../src/modules/reports/report-table');
    const csv = toCsv({ name: 'x', title: 'x', columns: [{ key: 'a', label: 'A', type: 'text' }], rows: [{ a: '=HYPERLINK("http://evil")' }, { a: '+1+1' }, { a: 'plain, "quoted"' }] });
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1+1");
    expect(csv).toContain('"plain, ""quoted"""');
  });

  it('store scoping: a store user cannot read another store\'s figures', async () => {
    const stores = (await f.admin.get('/stores?limit=10')).body.data as { id: string; code: string }[];
    const rabat = stores.find((s) => s.code === 'RABAT')!.id;
    await f.manager.get(`/reports/sales?${q(`&storeId=${rabat}`)}`).expect(403);
    const own = (await f.manager.get(`/reports/sales?${q('&groupBy=store')}`).expect(200)).body;
    expect(own.rows.every((r: { key: string }) => !/Rabat/i.test(r.key))).toBe(true);
    void orderId; void request;
  });
});
