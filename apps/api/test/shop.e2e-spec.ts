import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp } from './app';
import { setupSales } from './sales-helpers';
import { uid } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

type F = Awaited<ReturnType<typeof setupSales>>;
const PW = 'Sup3r-secret!';

describe('Storefront API: accounts, catalog, cart, checkout, tracking, fulfilment (e2e)', () => {
  let app: INestApplication;
  let f: F;
  let prisma: PrismaService;
  const srv = () => app.getHttpServer();
  const anon = {
    get: (p: string) => request(srv()).get(`/api/v1${p}`),
    post: (p: string, b?: object) => request(srv()).post(`/api/v1${p}`).send(b),
  };

  beforeAll(async () => { app = await createTestApp(); f = await setupSales(app); prisma = app.get(PrismaService); });
  afterAll(async () => { await app.close(); });

  /** A published product with stock in BOTH stores (the online order is fulfilled by the default store, whichever it is). */
  async function product(o: { price?: number; stock?: number; name?: string; lens?: boolean; type?: string; published?: boolean } = {}) {
    const k = uid();
    const res = await f.admin.post('/products', {
      type: o.type ?? 'FRAME', name: o.name ?? `Shop Item ${k}`, status: 'ACTIVE', isPublished: o.published ?? true, isLensConfigurable: o.lens ?? false, gender: 'UNISEX',
      variants: [{ sku: `SHOP-${k}`.toUpperCase(), color: 'Noir', colorHex: '#111111', size: '52-18-140', price: o.price ?? 500, cost: 100, initialStock: o.stock === 0 ? [] : [{ warehouseId: f.warehouse.casa, quantity: o.stock ?? 10 }, { warehouseId: f.warehouse.rabat, quantity: o.stock ?? 10 }] }],
    }).expect(201);
    return { id: res.body.id as string, slug: res.body.slug as string, name: res.body.name as string, variantId: res.body.variants[0].id as string };
  }

  async function register(email = `cust-${uid()}@example.com`) {
    const res = await anon.post('/public/auth/register', { email, password: PW, firstName: 'Salma', lastName: 'Alaoui', phone: '+212611223344' }).expect(201);
    const h = { Authorization: `Bearer ${res.body.accessToken}` };
    return {
      email, user: res.body.user, token: res.body.accessToken as string,
      get: (p: string) => request(srv()).get(`/api/v1${p}`).set(h),
      post: (p: string, b?: object) => request(srv()).post(`/api/v1${p}`).set(h).send(b),
      patch: (p: string, b?: object) => request(srv()).patch(`/api/v1${p}`).set(h).send(b),
      put: (p: string, b?: object) => request(srv()).put(`/api/v1${p}`).set(h).send(b),
      del: (p: string) => request(srv()).delete(`/api/v1${p}`).set(h),
    };
  }
  const guest = { firstName: 'Omar', lastName: 'Guest', email: 'omar.guest@example.com', phone: '+212655443322' };
  const checkoutBody = (variantId: string, extra: Record<string, unknown> = {}) => ({ lines: [{ variantId, quantity: 1 }], fulfillment: 'PICKUP', paymentMethod: 'cod', contact: guest, clientRef: randomUUID(), ...extra });
  const address = { recipient: 'Omar Guest', phone: '+212655443322', line1: '12 rue des Orangers', city: 'Casablanca' };

  describe('customer accounts and the staff/customer wall', () => {
    it('registers, signs in with the shared login, and gets a customer profile', async () => {
      const c = await register();
      expect(c.user).toMatchObject({ type: 'CUSTOMER', permissions: [], customerId: expect.any(String) });
      const login = await anon.post('/auth/login', { email: c.email, password: PW }).expect(200);
      expect(login.body.user.type).toBe('CUSTOMER');
      expect((await c.get('/account/profile').expect(200)).body).toMatchObject({ firstName: 'Salma', email: c.email });
      expect((await c.get('/auth/me').expect(200)).body.type).toBe('CUSTOMER');
    });

    it('refuses duplicate emails and weak passwords', async () => {
      const c = await register();
      expect((await anon.post('/public/auth/register', { email: c.email, password: PW, firstName: 'A', lastName: 'B' }).expect(409)).body.code).toBe('EMAIL_TAKEN');
      await anon.post('/public/auth/register', { email: `x-${uid()}@example.com`, password: 'short', firstName: 'A', lastName: 'B' }).expect(400);
      await anon.post('/public/auth/register', { email: 'admin@mizmar.local', password: PW, firstName: 'A', lastName: 'B' }).expect(409); // cannot shadow a staff address
    });

    it('a customer token is refused on EVERY staff route; a staff token is refused on account routes', async () => {
      const c = await register();
      for (const path of ['/users', '/orders', '/customers', '/products', '/inventory/stock', '/pos/config', '/stores', '/roles', '/suppliers', '/jobs']) {
        const r = await c.get(path);
        expect([403]).toContain(r.status);
        expect(r.body.code).toBe('CUSTOMER_FORBIDDEN');
      }
      expect((await f.admin.get('/account/profile')).status).toBe(403);
      expect((await f.admin.get('/account/orders')).body.code).toBe('CUSTOMER_ONLY');
      expect((await request(srv()).get('/api/v1/account/profile')).status).toBe(401);
    });

    it('profile, password change (signs out other sessions), addresses and wishlist', async () => {
      const c = await register();
      expect((await c.patch('/account/profile', { firstName: 'Nora', marketingOptIn: true }).expect(200)).body).toMatchObject({ firstName: 'Nora', marketingOptIn: true });
      const a1 = (await c.post('/account/addresses', address).expect(201)).body;
      const a2 = (await c.post('/account/addresses', { ...address, line1: '3 avenue Hassan II', isDefaultShipping: true }).expect(201)).body;
      expect(a1.isDefaultShipping).toBe(true);
      const list = (await c.get('/account/addresses').expect(200)).body;
      expect(list.find((a: { id: string }) => a.id === a2.id).isDefaultShipping).toBe(true);
      expect(list.find((a: { id: string }) => a.id === a1.id).isDefaultShipping).toBe(false);
      const other = await register();
      await other.patch(`/account/addresses/${a1.id}`, address).expect(404); // someone else's address
      await c.del(`/account/addresses/${a1.id}`).expect(204);

      const p = await product();
      await c.put(`/account/wishlist/${p.id}`).expect(204);
      await c.put(`/account/wishlist/${p.id}`).expect(204); // idempotent
      expect(((await c.get('/account/wishlist').expect(200)).body as { slug: string }[]).map((x) => x.slug)).toContain(p.slug);
      await c.del(`/account/wishlist/${p.id}`).expect(204);
      expect((await c.get('/account/wishlist/ids')).body).not.toContain(p.id);

      await c.post('/account/password', { currentPassword: 'wrong-password', newPassword: 'N3w-secret!!' }).expect(401);
      const login = await anon.post('/auth/login', { email: c.email, password: PW }).expect(200);
      await c.post('/account/password', { currentPassword: PW, newPassword: 'N3w-secret!!' }).expect(204);
      await anon.post('/auth/refresh', { refreshToken: login.body.refreshToken }).expect(401); // old sessions are dead
      await anon.post('/auth/login', { email: c.email, password: 'N3w-secret!!' }).expect(200);
    });
  });

  describe('public catalog', () => {
    it('lists only published, active products and never leaks cost or stock counts', async () => {
      const live = await product({ name: `Visible ${uid()}` });
      const hidden = await product({ name: `Hidden ${uid()}`, published: false });
      const list = (await anon.get(`/public/products?search=${encodeURIComponent(live.name)}`).expect(200)).body;
      expect(list.data.map((p: { slug: string }) => p.slug)).toEqual([live.slug]);
      expect((await anon.get(`/public/products?search=${encodeURIComponent(hidden.name)}`)).body.data).toHaveLength(0);
      await anon.get(`/public/products/${hidden.slug}`).expect(404);
      const detail = (await anon.get(`/public/products/${live.slug}`).expect(200)).body;
      expect(detail.variants[0]).toMatchObject({ stockStatus: 'IN_STOCK', price: 500 });
      const text = JSON.stringify(detail);
      expect(text).not.toContain('"cost"');
      expect(text).not.toMatch(/"quantity"|"reserved"/);
    });

    it('filters (price, color, type, in stock) and sorts by price', async () => {
      const tag = uid();
      const cheap = await product({ name: `Sortme ${tag} A`, price: 210 });
      const dear = await product({ name: `Sortme ${tag} B`, price: 990 });
      const gone = await product({ name: `Sortme ${tag} C`, price: 400, stock: 0 });
      const q = (s: string) => `/public/products?search=Sortme ${tag}&${s}`;
      expect((await anon.get(q('sort=price_desc')).expect(200)).body.data.map((p: { slug: string }) => p.slug)).toEqual([dear.slug, gone.slug, cheap.slug]);
      expect((await anon.get(q('sort=price_asc')).expect(200)).body.data[0].slug).toBe(cheap.slug);
      expect((await anon.get(q('minPrice=300&maxPrice=500')).expect(200)).body.data.map((p: { slug: string }) => p.slug)).toEqual([gone.slug]);
      expect((await anon.get(q('inStock=true&sort=price_asc')).expect(200)).body.data.map((p: { slug: string }) => p.slug)).toEqual([cheap.slug, dear.slug]);
      expect((await anon.get(q('color=noir')).expect(200)).body.meta.total).toBe(3);
      expect((await anon.get(q('color=vert')).expect(200)).body.meta.total).toBe(0);
      expect((await anon.get(q('type=SUNGLASSES')).expect(200)).body.meta.total).toBe(0);
      const out = (await anon.get(q('sort=price_asc')).expect(200)).body.data.find((p: { slug: string }) => p.slug === gone.slug);
      expect(out.stockStatus).toBe('OUT');
    });

    it('facets, lens options and pagination', async () => {
      const facets = (await anon.get('/public/facets').expect(200)).body;
      expect(facets).toHaveProperty('brands');
      expect(facets.price.max).toBeGreaterThanOrEqual(facets.price.min);
      const lens = (await anon.get('/public/lens-options').expect(200)).body;
      expect(lens.length).toBeGreaterThan(0);
      expect(JSON.stringify(lens)).not.toContain('"cost"');
      const page = (await anon.get('/public/products?limit=2&page=1').expect(200)).body;
      expect(page.data.length).toBeLessThanOrEqual(2);
      expect(page.meta.limit).toBe(2);
    });
  });

  describe('cart pricing and coupons', () => {
    it('prices from the catalog (never from the client) and reports availability', async () => {
      const p = await product({ price: 600, stock: 2 });
      const q = (await anon.post('/public/cart/quote', { lines: [{ variantId: p.variantId, quantity: 2 }] }).expect(200)).body;
      expect(q).toMatchObject({ subtotal: 1200, total: 1200, discountTotal: 0, shippingTotal: 0, fulfillment: 'PICKUP' });
      expect(q.lines[0].available).toBe(true);
      expect((await anon.post('/public/cart/quote', { lines: [{ variantId: p.variantId, quantity: 3 }] }).expect(200)).body.lines[0].available).toBe(false);
      await anon.post('/public/cart/quote', { lines: [{ variantId: 'nope', quantity: 1 }] }).expect(400);
      await anon.post('/public/cart/quote', { lines: [{ variantId: p.variantId, quantity: 0 }] }).expect(400);
    });

    it('applies a percent coupon with its minimum, and explains why a coupon is refused', async () => {
      const p = await product({ price: 500 });
      const ok = (await anon.post('/public/cart/quote', { lines: [{ variantId: p.variantId, quantity: 1 }], couponCode: 'bienvenue10' }).expect(200)).body;
      expect(ok.coupon).toMatchObject({ code: 'BIENVENUE10', discount: 50 });
      expect(ok).toMatchObject({ discountTotal: 50, total: 450 });
      const cheap = await product({ price: 100 });
      expect((await anon.post('/public/cart/quote', { lines: [{ variantId: cheap.variantId, quantity: 1 }], couponCode: 'BIENVENUE10' }).expect(200)).body.coupon.error).toBe('COUPON_MIN_SUBTOTAL');
      expect((await anon.post('/public/cart/quote', { lines: [{ variantId: p.variantId, quantity: 1 }], couponCode: 'NOPE' }).expect(200)).body.coupon.error).toBe('COUPON_UNKNOWN');
    });

    it('fixed coupons are spread to the cent; free-shipping coupons waive delivery', async () => {
      const a = await product({ price: 333.33 }), b = await product({ price: 100.01 });
      const code = `FIX${uid()}`.toUpperCase();
      await prisma.raw.coupon.create({ data: { code, type: 'FIXED', value: 50, isActive: true } });
      const q = (await anon.post('/public/cart/quote', { lines: [{ variantId: a.variantId, quantity: 1 }, { variantId: b.variantId, quantity: 1 }], couponCode: code }).expect(200)).body;
      expect(q.discountTotal).toBe(50);
      expect(Math.round((q.lines[0].discount + q.lines[1].discount) * 100)).toBe(5000);
      expect(q.total).toBe(383.34);
      const ship = `SHIP${uid()}`.toUpperCase();
      await prisma.raw.coupon.create({ data: { code: ship, type: 'FREE_SHIPPING', value: 0, isActive: true } });
      const d = (await anon.post('/public/cart/quote', { lines: [{ variantId: b.variantId, quantity: 1 }], fulfillment: 'DELIVERY', city: 'Casablanca', couponCode: ship }).expect(200)).body;
      expect(d.shippingTotal).toBe(0);
      const full = (await anon.post('/public/cart/quote', { lines: [{ variantId: b.variantId, quantity: 1 }], fulfillment: 'DELIVERY', city: 'Casablanca' }).expect(200)).body;
      expect(full.shippingTotal).toBeGreaterThan(0);
      expect(full.total).toBeCloseTo(100.01 + full.shippingTotal, 2);
    });

    it('delivery is free above the threshold and zone-limited', async () => {
      const big = await product({ price: 900 });
      const q = (await anon.post('/public/cart/quote', { lines: [{ variantId: big.variantId, quantity: 1 }], fulfillment: 'DELIVERY', city: 'Casablanca' }).expect(200)).body;
      expect(q.shippingTotal).toBe(0); // standard delivery is free over 800
      const zone = `Zone${uid()}`;
      const m = await prisma.raw.shippingMethod.create({ data: { code: `z-${uid()}`, name: 'Zone only', price: 20, zones: [zone], isActive: true, sortOrder: 99 } });
      const inZone = (await anon.post('/public/cart/quote', { lines: [{ variantId: big.variantId, quantity: 1 }], fulfillment: 'DELIVERY', city: zone, shippingMethodId: m.id }).expect(200)).body;
      expect(inZone.shippingOptions.some((o: { id: string }) => o.id === m.id)).toBe(true);
      const elsewhere = (await anon.post('/public/cart/quote', { lines: [{ variantId: big.variantId, quantity: 1 }], fulfillment: 'DELIVERY', city: 'Casablanca' }).expect(200)).body;
      expect(elsewhere.shippingOptions.some((o: { id: string }) => o.id === m.id)).toBe(false);
      await prisma.raw.shippingMethod.update({ where: { id: m.id }, data: { isActive: false } });
    });
  });

  describe('checkout', () => {
    it('guest pays on pickup: order, stock, invoice, customer record, idempotent retry', async () => {
      const p = await product({ price: 500, stock: 5 });
      const body = checkoutBody(p.variantId);
      const o = (await anon.post('/public/checkout', body).expect(201)).body;
      expect(o).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'UNPAID', fulfillment: 'PICKUP', total: 500, balanceDue: 500 });
      expect(o.number).toMatch(/-/);
      expect(await f.stockOf(p.variantId, f.warehouse.casa) + await f.stockOf(p.variantId, f.warehouse.rabat)).toBe(9); // one pair left a warehouse
      const row = await prisma.raw.order.findUniqueOrThrow({ where: { id: o.id }, include: { invoices: true, customer: true } });
      expect(row).toMatchObject({ channel: 'ONLINE' });
      expect(row.invoices).toHaveLength(1);
      expect(row.customer).toMatchObject({ email: guest.email, source: 'ONLINE', userId: null });
      const again = (await anon.post('/public/checkout', body).expect(201)).body; // same attempt
      expect(again.id).toBe(o.id);
      expect(again.replayed).toBe(true);
      expect(await f.stockOf(p.variantId, f.warehouse.casa) + await f.stockOf(p.variantId, f.warehouse.rabat)).toBe(9);
      expect((await f.admin.get(`/orders?channel=ONLINE&search=${o.number}`).expect(200)).body.data).toHaveLength(1); // visible in the admin order list
    });

    it('refuses what cannot be sold: no stock, missing contact/address, unknown payment method, lenses for guests', async () => {
      const p = await product({ stock: 1 });
      expect((await anon.post('/public/checkout', checkoutBody(p.variantId, { lines: [{ variantId: p.variantId, quantity: 12 }] })).expect(400)).body.code).toBe('INSUFFICIENT_STOCK');
      expect((await anon.post('/public/checkout', { ...checkoutBody(p.variantId), contact: undefined }).expect(400)).body.code).toBe('CONTACT_REQUIRED');
      expect((await anon.post('/public/checkout', checkoutBody(p.variantId, { fulfillment: 'DELIVERY', city: 'Casablanca' })).expect(400)).body.code).toBe('ADDRESS_REQUIRED');
      expect((await anon.post('/public/checkout', checkoutBody(p.variantId, { paymentMethod: 'cash' })).expect(400)).body.code).toBe('INVALID_PAYMENT_METHOD'); // till-only method
      const types = (await anon.get('/public/lens-options')).body;
      const lensy = await product({ lens: true });
      const g = await anon.post('/public/checkout', checkoutBody(lensy.variantId, { lines: [{ variantId: lensy.variantId, quantity: 1, lens: { lensTypeId: types[0].id } }] })).expect(400);
      expect(g.body.code).toBe('ACCOUNT_REQUIRED');
      expect(await f.stockOf(p.variantId, f.warehouse.casa) + await f.stockOf(p.variantId, f.warehouse.rabat)).toBe(2); // nothing was taken
    });

    it('delivery with a card: the demo provider captures, the order is confirmed and paid; transfer waits', async () => {
      const p = await product({ price: 400 });
      const paid = (await anon.post('/public/checkout', checkoutBody(p.variantId, { fulfillment: 'DELIVERY', city: 'Casablanca', address, paymentMethod: 'card_demo' })).expect(201)).body;
      expect(paid).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', balanceDue: 0, fulfillment: 'DELIVERY' });
      expect(paid.shippingTotal).toBeGreaterThan(0);
      expect(paid.total).toBeCloseTo(400 + paid.shippingTotal, 2);
      expect(paid.shipments).toHaveLength(1);
      const pay = await prisma.raw.payment.findFirstOrThrow({ where: { orderId: paid.id } });
      expect(pay.providerTransactionId).toMatch(/^demo_/);
      const wait = (await anon.post('/public/checkout', checkoutBody(p.variantId, { paymentMethod: 'transfer' })).expect(201)).body;
      expect(wait).toMatchObject({ status: 'PENDING', paymentStatus: 'UNPAID' });
      expect(wait.paymentInstructions).toContain('Virement');
    });

    it('coupons are single-use per limit, even when two orders race for the last use', async () => {
      const p = await product({ price: 500, stock: 20 });
      const code = `ONCE${uid()}`.toUpperCase();
      await prisma.raw.coupon.create({ data: { code, type: 'PERCENT', value: 20, usageLimit: 1, isActive: true } });
      const results = await Promise.all([1, 2, 3].map(() => anon.post('/public/checkout', checkoutBody(p.variantId, { couponCode: code })).then((r) => r.status)));
      expect(results.filter((s) => s === 201)).toHaveLength(1);
      expect((await prisma.raw.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(1);
      const next = await anon.post('/public/checkout', checkoutBody(p.variantId, { couponCode: code }));
      expect(next.status).toBe(400);
      expect(next.body.code).toBe('COUPON_EXHAUSTED');
    });

    it('parallel buyers of the last pair: exactly one wins', async () => {
      const p = await product({ stock: 0 });
      for (const warehouseId of [f.warehouse.casa, f.warehouse.rabat]) await prisma.raw.stockLevel.upsert({ where: { variantId_warehouseId: { variantId: p.variantId, warehouseId } }, update: { quantity: 1 }, create: { variantId: p.variantId, warehouseId, quantity: 1 } });
      const statuses = await Promise.all([1, 2, 3, 4].map(() => anon.post('/public/checkout', checkoutBody(p.variantId)).then((r) => r.status)));
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 400)).toHaveLength(3); // INSUFFICIENT_STOCK
    });
  });

  describe('prescription lenses online', () => {
    it('a signed-in customer saves a prescription (typed or scanned) and orders lenses: a workshop job is flagged for checking', async () => {
      const c = await register();
      const frame = await product({ price: 600, lens: true });
      const types = (await anon.get('/public/lens-options')).body as { id: string; requiresAdd: boolean; basePrice: number }[];
      const single = types.find((t) => !t.requiresAdd)!;
      const rx = (await c.post('/account/prescriptions', { issuedAt: '2026-06-15', odSph: -2, odCyl: -0.5, odAxis: 90, osSph: -1.75, pdTotal: 62 }).expect(201)).body;
      expect(rx.source).toBe('SELF');
      await c.post('/account/prescriptions', { issuedAt: '2026-06-15' }).expect(400); // nothing entered
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      const up = (await c.post('/account/prescriptions/upload').attach('file', png, { filename: 'rx.png', contentType: 'image/png' }).expect(201)).body;
      expect(up.url).toBeTruthy();
      await c.post('/account/prescriptions', { issuedAt: '2026-06-15', attachmentUrl: 'https://evil.example/x.png' }).expect(400); // only files we stored for this customer
      const scan = (await c.post('/account/prescriptions', { issuedAt: '2026-06-15', attachmentUrl: up.url }).expect(201)).body;
      expect(scan.source).toBe('UPLOAD');

      const lens = { lensTypeId: single.id, prescriptionId: rx.id };
      const quote = (await c.post('/public/cart/quote', { lines: [{ variantId: frame.variantId, quantity: 1, lens }] }).expect(200)).body;
      expect(quote.hasLens).toBe(true);
      expect(quote.total).toBeGreaterThan(600);
      const order = (await c.post('/public/checkout', { lines: [{ variantId: frame.variantId, quantity: 1, lens }], fulfillment: 'PICKUP', paymentMethod: 'cod', clientRef: randomUUID() }).expect(201)).body;
      expect(order.workshop).toHaveLength(1);
      const job = (await f.admin.get(`/jobs?search=${order.number}`).expect(200)).body.data[0];
      expect((await f.admin.get(`/jobs/${job.id}`)).body.notes).toContain('vérifier');

      const scanOrder = (await c.post('/public/checkout', { lines: [{ variantId: frame.variantId, quantity: 1, lens: { lensTypeId: single.id, prescriptionId: scan.id } }], fulfillment: 'PICKUP', paymentMethod: 'cod', clientRef: randomUUID() }).expect(201)).body;
      expect(scanOrder.workshop).toHaveLength(1); // a scan alone is enough to order; staff transcribe it
      const other = await register();
      const bad = await other.post('/public/cart/quote', { lines: [{ variantId: frame.variantId, quantity: 1, lens }] }).expect(400);
      expect(bad.body.code).toBe('PRESCRIPTION_NOT_FOUND'); // someone else's prescription
      await c.del(`/account/prescriptions/${rx.id}`).expect(204);
    });
  });

  describe('orders, tracking and cancellation', () => {
    it('tracking needs the order number AND the email or phone used', async () => {
      const p = await product();
      const o = (await anon.post('/public/checkout', checkoutBody(p.variantId)).expect(201)).body;
      expect((await anon.post('/public/orders/track', { number: o.number, contact: guest.email.toUpperCase() }).expect(200)).body.number).toBe(o.number);
      expect((await anon.post('/public/orders/track', { number: o.number, contact: '0655-443322'.replace('0', '+212 ') }).expect(200)).body.number).toBe(o.number);
      expect((await anon.post('/public/orders/track', { number: o.number, contact: 'someone@else.com' }).expect(404)).body.code).toBe('ORDER_NOT_FOUND');
      await anon.post('/public/orders/track', { number: 'NOPE-1', contact: guest.email }).expect(404);
      const t = JSON.stringify((await anon.post('/public/orders/track', { number: o.number, contact: guest.email })).body);
      expect(t).not.toMatch(/"cost"|internalNote|cashierId/);
    });

    it('a customer sees their own orders only and can cancel an unpaid, unstarted one (stock returns)', async () => {
      const c = await register();
      const other = await register();
      const p = await product({ price: 300, stock: 3 });
      const before = (await f.stockOf(p.variantId, f.warehouse.casa)) + (await f.stockOf(p.variantId, f.warehouse.rabat));
      const o = (await c.post('/public/checkout', { lines: [{ variantId: p.variantId, quantity: 2 }], fulfillment: 'PICKUP', paymentMethod: 'cod' }).expect(201)).body;
      expect((await c.get('/account/orders').expect(200)).body.map((x: { number: string }) => x.number)).toContain(o.number);
      expect((await other.get('/account/orders')).body).toHaveLength(0);
      await other.get(`/account/orders/${o.number}`).expect(404);
      await other.post(`/account/orders/${o.number}/cancel`, {}).expect(404);
      const cancelled = (await c.post(`/account/orders/${o.number}/cancel`, { reason: 'Changed my mind' }).expect(200)).body;
      expect(cancelled.status).toBe('CANCELLED');
      expect((await f.stockOf(p.variantId, f.warehouse.casa)) + (await f.stockOf(p.variantId, f.warehouse.rabat))).toBe(before);
      expect((await c.post(`/account/orders/${o.number}/cancel`, {}).expect(409)).body.code).toBe('CANNOT_CANCEL');
    });

    it('reviews are held for approval and only once per product', async () => {
      const c = await register();
      const p = await product();
      await c.post('/account/reviews', { productId: p.id, rating: 5, title: 'Top', body: 'Très belles lunettes' }).expect(201);
      await c.post('/account/reviews', { productId: p.id, rating: 4 }).expect(409);
      await c.post('/account/reviews', { productId: p.id, rating: 9 }).expect(400);
      expect((await anon.get(`/public/products/${p.slug}`)).body.reviews).toHaveLength(0); // pending moderation
      await prisma.raw.review.updateMany({ where: { productId: p.id }, data: { status: 'APPROVED' } });
      const d = (await anon.get(`/public/products/${p.slug}`)).body;
      expect(d.reviews).toHaveLength(1);
      expect(d.rating).toEqual({ average: 5, count: 1 });
    });
  });

  describe('staff fulfilment of online orders', () => {
    it('transfer: confirm payment (no register session needed); delivery: ship, courier collects cash', async () => {
      const p = await product({ price: 400 });
      const transfer = (await anon.post('/public/checkout', checkoutBody(p.variantId, { paymentMethod: 'transfer' })).expect(201)).body;
      const methods = (await prisma.raw.paymentMethodConfig.findUniqueOrThrow({ where: { code: 'transfer' } })).id;
      await f.technician.post(`/orders/${transfer.id}/confirm-payment`, { methodId: methods }).expect(403);
      const cash = (await prisma.raw.paymentMethodConfig.findUniqueOrThrow({ where: { code: 'cash' } })).id;
      await f.admin.post(`/orders/${transfer.id}/confirm-payment`, { methodId: cash }).expect(400); // cash belongs in a drawer
      const confirmed = (await f.admin.post(`/orders/${transfer.id}/confirm-payment`, { methodId: methods, reference: 'VIR-123' }).expect(200)).body;
      expect(confirmed).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', balanceDue: 0 });

      const cod = (await anon.post('/public/checkout', checkoutBody(p.variantId, { fulfillment: 'DELIVERY', city: 'Casablanca', address })).expect(201)).body;
      await f.admin.post(`/orders/${cod.id}/shipment-delivered`, {}).expect(409); // not shipped yet
      const shipped = (await f.admin.post(`/orders/${cod.id}/ship`, { carrier: 'Amana', trackingNumber: 'AM123456' }).expect(200)).body;
      expect(shipped.status).toBe('SHIPPED');
      expect(shipped.shipments[0]).toMatchObject({ carrier: 'Amana', trackingNumber: 'AM123456', status: 'IN_TRANSIT' });
      const track = (await anon.post('/public/orders/track', { number: cod.number, contact: guest.email }).expect(200)).body;
      expect(track.shipments[0].trackingNumber).toBe('AM123456');
      const done = (await f.admin.post(`/orders/${cod.id}/shipment-delivered`, { collected: true }).expect(200)).body;
      expect(done).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PAID', balanceDue: 0 });
    });

    it('pickup orders are called ready by staff; lens orders wait for the workshop', async () => {
      const c = await register();
      const frame = await product({ lens: true });
      const types = (await anon.get('/public/lens-options')).body as { id: string; requiresAdd: boolean }[];
      const rx = (await c.post('/account/prescriptions', { issuedAt: '2026-06-15', odSph: -1, osSph: -1 }).expect(201)).body;
      const lens = { lensTypeId: types.find((t) => !t.requiresAdd)!.id, prescriptionId: rx.id };
      const order = (await c.post('/public/checkout', { lines: [{ variantId: frame.variantId, quantity: 1, lens }], fulfillment: 'PICKUP', paymentMethod: 'cod' }).expect(201)).body;
      expect((await f.admin.post(`/orders/${order.id}/ready-for-pickup`).expect(409)).body.code).toBe('JOBS_NOT_READY');
      const plain = (await anon.post('/public/checkout', checkoutBody((await product()).variantId)).expect(201)).body;
      expect((await f.admin.post(`/orders/${plain.id}/ready-for-pickup`).expect(200)).body.status).toBe('READY');
      expect((await f.admin.post(`/orders/${plain.id}/ship`, {}).expect(409)).body.code).toBe('INVALID_STATE'); // pickup order
    });
  });

  describe('content', () => {
    it('contact form stores messages, silently drops bots; newsletter is idempotent', async () => {
      const before = await prisma.raw.contactMessage.count();
      await anon.post('/public/contact', { name: 'Ali', email: 'ali@example.com', message: 'Bonjour, avez-vous des montures pour enfants ?' }).expect(201);
      await anon.post('/public/contact', { name: 'Bot', email: 'bot@example.com', message: 'Buy cheap watches now', website: 'http://spam.example' }).expect(201);
      expect(await prisma.raw.contactMessage.count()).toBe(before + 1);
      await anon.post('/public/contact', { name: '', email: 'bad', message: 'x' }).expect(400);
      const email = `news-${uid()}@example.com`;
      await anon.post('/public/newsletter', { email }).expect(201);
      await anon.post('/public/newsletter', { email }).expect(201);
      expect(await prisma.raw.newsletterSubscriber.count({ where: { email } })).toBe(1);
    });

    it('blog shows published posts only', async () => {
      const slug = `post-${uid()}`;
      await prisma.raw.blogPost.create({ data: { title: 'Choisir ses lunettes', slug, content: '<p>Conseils</p>', status: 'PUBLISHED', publishedAt: new Date(Date.now() - 1000) } });
      const draft = `draft-${uid()}`;
      await prisma.raw.blogPost.create({ data: { title: 'Brouillon', slug: draft, content: 'x', status: 'DRAFT' } });
      expect((await anon.get(`/public/blog/${slug}`).expect(200)).body.title).toBe('Choisir ses lunettes');
      await anon.get(`/public/blog/${draft}`).expect(404);
      expect((await anon.get('/public/blog?limit=50').expect(200)).body.data.map((p: { slug: string }) => p.slug)).toContain(slug);
    });
  });

  describe('admin: coupons, shipping methods, moderation', () => {
    it('coupons: validated, unique, protected once used; an admin-made coupon works at checkout', async () => {
      const code = `ADM${uid()}`.toUpperCase().slice(0, 14);
      await f.admin.post('/coupons', { code: 'bad code', type: 'PERCENT', value: 10 }).expect(400);
      await f.admin.post('/coupons', { code, type: 'NOPE', value: 10 }).expect(400);
      const c = (await f.admin.post('/coupons', { code, type: 'PERCENT', value: 25, minSubtotal: 100, maxDiscount: 60, perCustomerLimit: 1 }).expect(201)).body;
      await f.admin.post('/coupons', { code, type: 'PERCENT', value: 5 }).expect(409);
      await f.technician.post('/coupons', { code: 'ZZZ99', type: 'PERCENT', value: 5 }).expect(403);
      const p = await product({ price: 1000 });
      const q = (await anon.post('/public/cart/quote', { lines: [{ variantId: p.variantId, quantity: 1 }], couponCode: code }).expect(200)).body;
      expect(q.coupon.discount).toBe(60); // 25% of 1000 capped at 60
      await anon.post('/public/checkout', checkoutBody(p.variantId, { couponCode: code })).expect(201);
      expect((await f.admin.del(`/coupons/${c.id}`)).status).toBe(409); // used
      await f.admin.patch(`/coupons/${c.id}`, { isActive: false }).expect(200);
      expect((await anon.post('/public/cart/quote', { lines: [{ variantId: p.variantId, quantity: 1 }], couponCode: code }).expect(200)).body.coupon.error).toBe('COUPON_UNKNOWN');
    });

    it('shipping methods: CRUD with zones, permission checked, used ones protected', async () => {
      const code = `m-${uid()}`.slice(0, 20);
      const m = (await f.admin.post('/shipping-methods', { code, name: 'Test courier', price: 25, zones: ['Fès'], estimatedDaysMin: 1, estimatedDaysMax: 3 }).expect(201)).body;
      await f.admin.post('/shipping-methods', { code, name: 'Dup' }).expect(409);
      await f.admin.post('/shipping-methods', { code: 'Bad Code', name: 'x' }).expect(400);
      await f.cashier.post('/shipping-methods', { code: 'zz-1', name: 'x' }).expect(403);
      const quote = (await anon.post('/public/cart/quote', { lines: [{ variantId: (await product({ price: 200 })).variantId, quantity: 1 }], fulfillment: 'DELIVERY', city: 'fès' }).expect(200)).body;
      expect(quote.shippingOptions.some((o: { id: string }) => o.id === m.id)).toBe(true); // zone match ignores case
      expect((await f.admin.del(`/shipping-methods/${m.id}`)).status).toBe(204);
    });

    it('reviews and contact messages can be moderated by staff only', async () => {
      const c = await register();
      const p = await product();
      await c.post('/account/reviews', { productId: p.id, rating: 3 }).expect(201);
      const list = (await f.admin.get('/reviews?status=PENDING').expect(200)).body.data as { id: string; productId: string }[];
      const mine = list.find((r) => r.productId === p.id)!;
      expect(mine).toBeTruthy();
      await f.technician.post(`/reviews/${mine.id}/approve`).expect(403);
      expect((await f.admin.post(`/reviews/${mine.id}/approve`).expect(200)).body.status).toBe('APPROVED');
      expect((await anon.get(`/public/products/${p.slug}`)).body.reviews).toHaveLength(1);
      await anon.post('/public/contact', { name: 'Zed', email: 'zed@example.com', message: 'Hello there, a question' }).expect(201);
      const msg = (await f.admin.get('/contact-messages?status=NEW').expect(200)).body.data[0];
      expect((await f.admin.post(`/contact-messages/${msg.id}/status`, { status: 'REPLIED' }).expect(200)).body.status).toBe('REPLIED');
      await c.get('/contact-messages').expect(403);
    });
  });
});
