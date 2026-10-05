import { INestApplication } from '@nestjs/common';
import { createTestApp } from './app';
import { loginAs, uid } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

type Client = Awaited<ReturnType<typeof loginAs>>;

describe('Products & inventory (e2e)', () => {
  let app: INestApplication;
  let admin: Client;
  let casa: string, rabat: string; // main warehouse ids
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = await loginAs(app, 'admin');
    const wh = (await admin.get('/warehouses').expect(200)).body as { id: string; code: string; store: { code: string } }[];
    casa = wh.find((w) => w.store.code === 'CASA')!.id;
    rabat = wh.find((w) => w.store.code === 'RABAT')!.id;
  });
  afterAll(async () => { await app.close(); });

  const newProduct = async (over: Record<string, any> = {}, stock = 10) => {
    const k = uid();
    const body = {
      type: 'FRAME', name: `Spec Frame ${k}`, gender: 'UNISEX', status: 'ACTIVE', isPublished: true,
      frameSpec: { rimType: 'FULL_RIM', lensWidthMm: 52, bridgeMm: 18, templeMm: 145 },
      variants: [{ sku: `SPEC-${k}-01`, barcode: `99${Date.now()}${Math.floor(Math.random() * 90 + 10)}`, color: 'Noir', colorHex: '#111111', price: 1200.5, cost: 600, initialStock: stock ? [{ warehouseId: casa, quantity: stock }] : [] }],
      ...over,
    };
    const res = await admin.post('/products', body).expect(201);
    return res.body;
  };
  const qty = async (variantId: string, wh = casa) => (await prisma.raw.stockLevel.findUnique({ where: { variantId_warehouseId: { variantId, warehouseId: wh } } }))?.quantity ?? 0;

  describe('products', () => {
    it('creates a product with variants, frame spec and opening stock recorded in the ledger', async () => {
      const p = await newProduct();
      expect(p.slug).toMatch(/^spec-frame-/);
      expect(typeof p.variants[0].price).toBe('number'); // Decimal serialised as a number
      expect(p.variants[0].price).toBe(1200.5);
      expect(p.frameSpec.lensWidthMm).toBe(52);
      expect(p.variants[0].stock[0].quantity).toBe(10);
      const mv = await prisma.raw.stockMovement.findMany({ where: { variantId: p.variants[0].id } });
      expect(mv).toHaveLength(1);
      expect(mv[0]).toMatchObject({ type: 'INITIAL', quantity: 10, balanceAfter: 10 });
    });

    it('rejects bad input: duplicate SKU in one request, frameSpec on a non-frame, unknown warehouse/brand', async () => {
      const k = uid();
      const v = { sku: `DUP-${k}`, price: 10 };
      await admin.post('/products', { type: 'ACCESSORY', name: 'x', variants: [v, v] }).expect(400);
      await admin.post('/products', { type: 'ACCESSORY', name: 'x', frameSpec: { lensWidthMm: 50 } }).expect(400);
      await admin.post('/products', { type: 'ACCESSORY', name: 'x', brandId: 'nope' }).expect(400);
      await admin.post('/products', { type: 'ACCESSORY', name: 'x', variants: [{ sku: `W-${k}`, price: 5, initialStock: [{ warehouseId: 'nope', quantity: 1 }] }] }).expect(400);
      await admin.post('/products', { type: 'ACCESSORY', name: 'x', variants: [{ sku: `N-${k}`, price: -5 }] }).expect(400);
      await admin.post('/products', { type: 'ACCESSORY', name: 'x', variants: [{ sku: 'bad sku!', price: 5 }] }).expect(400);
    });

    it('SKU is unique across products (409) and reusable after delete', async () => {
      const p = await newProduct({}, 0);
      const sku = p.variants[0].sku;
      await admin.post('/products', { type: 'ACCESSORY', name: 'clash', variants: [{ sku, price: 5 }] }).expect(409);
      await admin.del(`/products/${p.id}`).expect(204);
      await admin.get(`/products/${p.id}`).expect(404);
      const again = await admin.post('/products', { type: 'ACCESSORY', name: 'reuse', variants: [{ sku, price: 5 }] }).expect(201);
      expect(again.body.variants[0].sku).toBe(sku);
      await admin.del(`/products/${again.body.id}`).expect(204);
    });

    it('cannot delete a product (or variant) that still has stock', async () => {
      const p = await newProduct({}, 3);
      expect((await admin.del(`/products/${p.id}`).expect(409)).body.code).toBe('HAS_STOCK');
      expect((await admin.del(`/products/variants/${p.variants[0].id}`).expect(409)).body.code).toBe('HAS_STOCK');
    });

    it('updates a product + frame spec, adds/edits/removes variants', async () => {
      const p = await newProduct({}, 0);
      const upd = (await admin.patch(`/products/${p.id}`, { isFeatured: true, frameSpec: { templeMm: 150 } }).expect(200)).body;
      expect(upd.isFeatured).toBe(true);
      expect(upd.frameSpec).toMatchObject({ templeMm: 150, lensWidthMm: 52 });
      await admin.patch(`/products/${p.id}`, { type: 'LENS' }).expect(400); // type is immutable
      const v = (await admin.post(`/products/${p.id}/variants`, { sku: `${p.variants[0].sku}-B`, price: 99, initialStock: [{ warehouseId: casa, quantity: 4 }] }).expect(201)).body;
      expect(await qty(v.id)).toBe(4);
      await admin.patch(`/products/variants/${v.id}`, { price: 109.9 }).expect(200);
      expect((await admin.get(`/products/${p.id}`)).body.variants.find((x: any) => x.id === v.id).price).toBe(109.9);
      await admin.patch(`/products/variants/${p.variants[0].id}`, { sku: `${p.variants[0].sku}-B` }).expect(409); // sku taken
    });

    it('looks products up by barcode or SKU (case-insensitive) with stock for the active store', async () => {
      const p = await newProduct();
      const v = p.variants[0];
      for (const code of [v.barcode, v.sku, v.sku.toLowerCase()]) {
        const r = (await admin.get(`/products/lookup/${code}`).expect(200)).body;
        expect(r.id).toBe(v.id);
        expect(r.product.name).toBe(p.name);
        expect(r.stock.find((s: any) => s.warehouse.id === casa).available).toBe(10);
      }
      await admin.get('/products/lookup/does-not-exist').expect(404);
    });

    it('lookup hides drafts by default (POS scan) but inventory screens can opt in with includeInactive', async () => {
      const draft = await newProduct({ status: 'DRAFT' });
      const sku = draft.variants[0].sku;
      await admin.get(`/products/lookup/${sku}`).expect(404);
      const found = (await admin.get(`/products/lookup/${sku}?includeInactive=true`).expect(200)).body;
      expect(found.id).toBe(draft.variants[0].id);
      await admin.get(`/products/lookup/${sku}?includeInactive=banana`).expect(400);
      const archived = await newProduct({ status: 'ARCHIVED' });
      await admin.get(`/products/lookup/${archived.variants[0].sku}`).expect(404);
      await admin.get(`/products/lookup/${archived.variants[0].sku}?includeInactive=true`).expect(200);
    });

    it('lists with filters, search (name / sku / barcode), price range and stock totals', async () => {
      const p = await newProduct({ name: `Zzfilter ${uid()}`, gender: 'WOMEN' });
      const v = p.variants[0];
      const byName = (await admin.get(`/products?search=${encodeURIComponent(p.name)}`).expect(200)).body;
      expect(byName.data).toHaveLength(1);
      expect(byName.data[0]).toMatchObject({ variantCount: 1, priceFrom: 1200.5, priceTo: 1200.5, stock: 10 });
      expect((await admin.get(`/products?search=${v.sku}`)).body.data.map((x: any) => x.id)).toContain(p.id);
      expect((await admin.get(`/products?search=${v.barcode}`)).body.data.map((x: any) => x.id)).toContain(p.id);
      expect((await admin.get(`/products?search=${encodeURIComponent(p.name)}&gender=MEN`)).body.data).toHaveLength(0);
      expect((await admin.get(`/products?search=${encodeURIComponent(p.name)}&minPrice=1300`)).body.data).toHaveLength(0);
      expect((await admin.get(`/products?search=${encodeURIComponent(p.name)}&minPrice=1000&maxPrice=1300&type=FRAME&isPublished=true`)).body.data).toHaveLength(1);
      await admin.get('/products?type=BOGUS').expect(400);
      await admin.get('/products?sortBy=passwordHash').expect(200); // unknown sort column is ignored, never reaches SQL
    });

    it('manages images: first becomes primary, primary switches, reorder, delete promotes next', async () => {
      const p = await newProduct({}, 0);
      const a = (await admin.post(`/products/${p.id}/images`, { url: 'https://cdn.example.com/a.jpg', alt: 'A' }).expect(201)).body;
      const b = (await admin.post(`/products/${p.id}/images`, { url: '/uploads/b.jpg' }).expect(201)).body;
      expect([a.isPrimary, b.isPrimary]).toEqual([true, false]);
      await admin.post('/products/' + p.id + '/images', { url: 'javascript:alert(1)' }).expect(400);
      await admin.post(`/products/images/${b.id}/primary`).expect(204);
      let imgs = (await admin.get(`/products/${p.id}`)).body.images;
      expect(imgs.find((i: any) => i.isPrimary).id).toBe(b.id);
      await admin.put(`/products/${p.id}/images/order`, { ids: [a.id] }).expect(400); // must list every image
      await admin.put(`/products/${p.id}/images/order`, { ids: [b.id, a.id] }).expect(204);
      await admin.del(`/products/images/${b.id}`).expect(204);
      imgs = (await admin.get(`/products/${p.id}`)).body.images;
      expect(imgs).toHaveLength(1);
      expect(imgs[0]).toMatchObject({ id: a.id, isPrimary: true });
    });

    it('enforces permissions: technician reads but cannot write; cashier can scan', async () => {
      const tech = await loginAs(app, 'technician');
      await tech.get('/products').expect(200);
      expect((await tech.post('/products', { type: 'ACCESSORY', name: 'x' }).expect(403)).body.details.missing).toEqual(['products:create']);
      const cashier = await loginAs(app, 'cashier');
      await cashier.get('/products?limit=1').expect(200);
      await cashier.post('/inventory/adjustments', { warehouseId: casa, reason: 'FOUND', lines: [] }).expect(403);
    });
  });

  describe('inventory', () => {
    it('adjustment: applies deltas, writes the ledger, numbers the document, and is atomic', async () => {
      const p = await newProduct({}, 5);
      const v = p.variants[0].id;
      const adj = (await admin.post('/inventory/adjustments', { warehouseId: casa, reason: 'FOUND', lines: [{ variantId: v, quantityDelta: 3 }] }).expect(201)).body;
      expect(adj.number).toMatch(/^CASA-AJU-\d{4}-\d{6}$/);
      expect(await qty(v)).toBe(8);
      // removing more than available fails, and a failing line rolls back the OTHER lines of the same document
      const other = (await newProduct({}, 5)).variants[0].id;
      const bad = await admin.post('/inventory/adjustments', { warehouseId: casa, reason: 'DAMAGED', lines: [{ variantId: other, quantityDelta: -2 }, { variantId: v, quantityDelta: -99 }] }).expect(400);
      expect(bad.body.code).toBe('INSUFFICIENT_STOCK');
      expect(bad.body.details).toMatchObject({ available: 8, requested: 99 });
      expect(await qty(other)).toBe(5);
      expect(await qty(v)).toBe(8);
      const ledger = await prisma.raw.stockMovement.findMany({ where: { variantId: v }, orderBy: { createdAt: 'asc' } });
      expect(ledger.map((m) => [m.type, m.quantity, m.balanceAfter])).toEqual([['INITIAL', 5, 5], ['ADJUSTMENT', 3, 8]]);
      await admin.post('/inventory/adjustments', { warehouseId: casa, reason: 'FOUND', lines: [{ variantId: v, quantityDelta: 0 }] }).expect(400);
      await admin.post('/inventory/adjustments', { warehouseId: casa, reason: 'FOUND', lines: [{ variantId: v, quantityDelta: 1 }, { variantId: v, quantityDelta: 1 }] }).expect(400); // duplicate variant
    });

    it('never oversells: 12 parallel single-unit removals against 5 in stock succeed exactly 5 times', async () => {
      const v = (await newProduct({}, 5)).variants[0].id;
      const results = await Promise.all(Array.from({ length: 12 }, () => admin.post('/inventory/adjustments', { warehouseId: casa, reason: 'LOST', lines: [{ variantId: v, quantityDelta: -1 }] })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(results.filter((r) => r.status === 400 && r.body.code === 'INSUFFICIENT_STOCK')).toHaveLength(7);
      expect(await qty(v)).toBe(0);
      const ledger = await prisma.raw.stockMovement.findMany({ where: { variantId: v }, orderBy: { createdAt: 'asc' } });
      expect(ledger.reduce((n, m) => n + m.quantity, 0)).toBe(0); // ledger sums to the level
      expect(new Set(ledger.map((m) => m.balanceAfter)).size).toBe(ledger.length); // no two movements share a balance => no lost update
    });

    it('document numbers are unique under concurrency', async () => {
      const v = (await newProduct({}, 50)).variants[0].id;
      const rs = await Promise.all(Array.from({ length: 10 }, () => admin.post('/inventory/adjustments', { warehouseId: casa, reason: 'FOUND', lines: [{ variantId: v, quantityDelta: 1 }] }).expect(201)));
      const numbers = rs.map((r) => r.body.number);
      expect(new Set(numbers).size).toBe(10);
    });

    it('transfer: draft -> ship (origin decreases) -> receive (destination increases); partial receipt; cancel in transit restores', async () => {
      const v = (await newProduct({}, 10)).variants[0].id;
      const t = (await admin.post('/inventory/transfers', { fromWarehouseId: casa, toWarehouseId: rabat, lines: [{ variantId: v, quantity: 6 }] }).expect(201)).body;
      expect(t).toMatchObject({ status: 'DRAFT' });
      expect(t.number).toMatch(/^CASA-TRF-/);
      expect(await qty(v)).toBe(10); // a draft moves nothing
      await admin.post(`/inventory/transfers/${t.id}/receive`, {}).expect(409); // can't receive before shipping
      const shipped = (await admin.post(`/inventory/transfers/${t.id}/ship`).expect(200)).body;
      expect(shipped.status).toBe('IN_TRANSIT');
      expect([await qty(v), await qty(v, rabat)]).toEqual([4, 0]);
      await admin.post(`/inventory/transfers/${t.id}/ship`).expect(409); // already shipped
      const line = shipped.lines[0];
      await admin.post(`/inventory/transfers/${t.id}/receive`, { lines: [{ lineId: line.id, receivedQty: 7 }] }).expect(400); // more than shipped
      const got = (await admin.post(`/inventory/transfers/${t.id}/receive`, { lines: [{ lineId: line.id, receivedQty: 5 }] }).expect(200)).body;
      expect(got.status).toBe('RECEIVED');
      expect([await qty(v), await qty(v, rabat)]).toEqual([4, 5]); // 1 unit lost in transit
      await admin.post(`/inventory/transfers/${t.id}/cancel`).expect(409);

      const t2 = (await admin.post('/inventory/transfers', { fromWarehouseId: casa, toWarehouseId: rabat, ship: true, lines: [{ variantId: v, quantity: 3 }] }).expect(201)).body;
      expect(t2.status).toBe('IN_TRANSIT');
      expect(await qty(v)).toBe(1);
      await admin.post(`/inventory/transfers/${t2.id}/cancel`).expect(200);
      expect(await qty(v)).toBe(4);
      await admin.post('/inventory/transfers', { fromWarehouseId: casa, toWarehouseId: casa, lines: [{ variantId: v, quantity: 1 }] }).expect(400);
      await admin.post('/inventory/transfers', { fromWarehouseId: casa, toWarehouseId: rabat, ship: true, lines: [{ variantId: v, quantity: 99 }] }).expect(400); // not enough stock; whole transfer rolls back
      expect((await admin.get(`/inventory/transfers?search=${t.number}`)).body.meta.total).toBe(1);
    });

    it('store scoping: a Casablanca-only manager cannot touch or see Rabat stock, but receives into their own store', async () => {
      const v = (await newProduct({}, 5)).variants[0].id;
      const manager = await loginAs(app, 'manager');
      const store = manager.user.stores[0].id;
      expect(manager.user.stores.map((s) => s.code)).toEqual(['CASA']);
      await manager.get(`/inventory/stock?storeId=${(await prisma.raw.warehouse.findUnique({ where: { id: rabat } }))!.storeId}`).expect(403);
      await manager.post('/inventory/adjustments', { warehouseId: rabat, reason: 'FOUND', lines: [{ variantId: v, quantityDelta: 1 }] }).expect(403);
      await manager.post('/inventory/transfers', { fromWarehouseId: rabat, toWarehouseId: casa, lines: [{ variantId: v, quantity: 1 }] }).expect(403);
      const stock = (await manager.get('/inventory/stock?limit=100').expect(200)).body.data;
      expect(stock.every((l: any) => l.warehouse.storeId === store)).toBe(true); // implicit scope = their stores only
      expect((await manager.get('/warehouses')).body.every((w: any) => w.storeId === store)).toBe(true);
      // admin ships Rabat -> Casa; the manager (destination) may receive it, but not ship/cancel it
      await admin.post('/inventory/adjustments', { warehouseId: rabat, reason: 'FOUND', lines: [{ variantId: v, quantityDelta: 4 }] }).expect(201);
      const t = (await admin.post('/inventory/transfers', { fromWarehouseId: rabat, toWarehouseId: casa, ship: true, lines: [{ variantId: v, quantity: 2 }] }).expect(201)).body;
      await manager.post(`/inventory/transfers/${t.id}/cancel`).expect(403);
      await manager.post(`/inventory/transfers/${t.id}/receive`, {}).expect(200);
      expect(await qty(v)).toBe(7);
    });

    it('inventory count: snapshot, record counts, completion posts corrections and preserves sales made meanwhile', async () => {
      const a = (await newProduct({ type: 'ACCESSORY', frameSpec: undefined }, 10)).variants[0].id;
      const b = (await newProduct({ type: 'ACCESSORY', frameSpec: undefined }, 6)).variants[0].id;
      const count = (await admin.post('/inventory/counts', { warehouseId: casa, productType: 'ACCESSORY' }).expect(201)).body;
      expect(count.status).toBe('IN_PROGRESS');
      expect(count.lines.find((l: any) => l.variantId === a).expectedQty).toBe(10);
      await admin.post('/inventory/adjustments', { warehouseId: casa, reason: 'LOST', lines: [{ variantId: a, quantityDelta: -2 }] }).expect(201); // a "sale" during the count
      await admin.put(`/inventory/counts/${count.id}/lines`, { lines: [{ variantId: a, countedQty: 9 }, { variantId: b, countedQty: 6 }] }).expect(200);
      await admin.put(`/inventory/counts/${count.id}/lines`, { lines: [{ variantId: 'stranger', countedQty: 1 }] }).expect(400);
      const done = (await admin.post(`/inventory/counts/${count.id}/complete`).expect(200)).body;
      expect(done.status).toBe('COMPLETED');
      expect(await qty(a)).toBe(7); // 10 - 2 (sale) - 1 (shrinkage found: counted 9 vs snapshot 10)
      expect(await qty(b)).toBe(6); // matched: no movement
      expect(await prisma.raw.stockMovement.count({ where: { variantId: b, type: 'COUNT_CORRECTION' } })).toBe(0);
      await admin.post(`/inventory/counts/${count.id}/complete`).expect(409);
      await admin.put(`/inventory/counts/${count.id}/lines`, { lines: [{ variantId: a, countedQty: 1 }] }).expect(409);
    });

    it('summary, low-stock filter, reorder levels and movement history', async () => {
      const p = await newProduct({}, 2);
      const v = p.variants[0].id;
      const level = await prisma.raw.stockLevel.findUniqueOrThrow({ where: { variantId_warehouseId: { variantId: v, warehouseId: casa } } });
      expect((await admin.get('/inventory/stock?lowStock=true&limit=100')).body.data.map((l: any) => l.id)).not.toContain(level.id);
      await admin.patch(`/inventory/stock/${level.id}`, { reorderPoint: 5, reorderQty: 20 }).expect(200);
      const low = (await admin.get('/inventory/stock?lowStock=true&limit=100').expect(200)).body.data;
      expect(low.find((l: any) => l.id === level.id)).toMatchObject({ isLow: true, available: 2 });
      const s = (await admin.get('/inventory/summary').expect(200)).body;
      expect(s.lowStock).toBeGreaterThanOrEqual(1);
      expect(s.units).toBeGreaterThan(0);
      expect(typeof s.value).toBe('number');
      const mv = (await admin.get(`/inventory/movements?variantId=${v}`).expect(200)).body;
      expect(mv.data[0]).toMatchObject({ type: 'INITIAL', quantity: 2 });
      await admin.get('/inventory/movements?type=NOPE').expect(400);
    });
  });
});
