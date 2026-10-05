import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app';
import { setupSales } from './sales-helpers';
import { uid } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

type F = Awaited<ReturnType<typeof setupSales>>;

describe('Settings and content administration (e2e)', () => {
  let app: INestApplication;
  let f: F;
  let prisma: PrismaService;
  const anon = (p: string) => request(app.getHttpServer()).get(`/api/v1${p}`);
  beforeAll(async () => {
    app = await createTestApp(); f = await setupSales(app); prisma = app.get(PrismaService);
    // leftovers from an interrupted earlier run must not leak into these tests (or into other suites)
    await prisma.raw.customFieldDefinition.updateMany({ data: { isActive: false, isRequired: false } });
    const b = await prisma.raw.brandingSetting.findFirst({ where: { key: 'default' } });
    if (b && (b.legal as { ice?: string } | null)?.ice === '001122334455667') await prisma.raw.brandingSetting.update({ where: { id: b.id }, data: { legal: { ...(b.legal as object), ice: '000000000000000' } } });
  });
  afterAll(async () => {
    for (const k of ['blog', 'hr', 'storefront']) await prisma.raw.moduleToggle.upsert({ where: { moduleKey: k }, update: { isEnabled: true }, create: { moduleKey: k, isEnabled: true } });
    await app.close();
  });

  describe('who may configure', () => {
    it('only people with the config permission (the store manager does not)', async () => {
      await f.admin.get('/tax-rates').expect(200);
      for (const p of ['/tax-rates', '/languages', '/currencies', '/email-templates', '/document-templates', '/payment-method-settings', '/custom-field-definitions']) await f.manager.get(p).expect(403);
      await f.manager.put('/modules/blog', { isEnabled: false }).expect(403);
      await f.manager.put('/branding', { storeName: 'Hacked' }).expect(403);
      await f.manager.get('/banners').expect(200); // content is the manager's job
      await f.cashier.get('/banners').expect(403);
    });
  });

  describe('localization', () => {
    it('tax rates: exactly one default, the default stays, used rates are kept', async () => {
      const code = `t${uid()}`.slice(0, 12);
      await f.admin.post('/tax-rates', { code, name: 'Bad', rate: 120 }).expect(400);
      await f.admin.post('/tax-rates', { code: 'Bad Code', name: 'x', rate: 10 }).expect(400);
      const r = (await f.admin.post('/tax-rates', { code, name: 'Réduite', rate: 10, isInclusive: true }).expect(201)).body;
      await f.admin.post('/tax-rates', { code, name: 'Dup', rate: 5 }).expect(409);
      const before = (await prisma.raw.taxRate.findFirstOrThrow({ where: { isDefault: true, deletedAt: null } })).id;
      await f.admin.patch(`/tax-rates/${r.id}`, { isDefault: true }).expect(200);
      expect(await prisma.raw.taxRate.count({ where: { isDefault: true, deletedAt: null } })).toBe(1);
      expect((await prisma.raw.taxRate.findUniqueOrThrow({ where: { id: r.id } })).isDefault).toBe(true);
      expect((await f.admin.patch(`/tax-rates/${r.id}`, { isDefault: false }).expect(400)).body.code).toBe('DEFAULT_REQUIRED');
      expect((await f.admin.del(`/tax-rates/${r.id}`).expect(409)).body.message).toMatch(/default/i);
      await f.admin.patch(`/tax-rates/${before}`, { isDefault: true }).expect(200); // restore the standard 20 %
      expect((await f.admin.del(`/tax-rates/${r.id}`)).status).toBe(204);
      expect(await prisma.raw.taxRate.count({ where: { isDefault: true, deletedAt: null } })).toBe(1);
    });

    it('currencies and languages validate and keep one default', async () => {
      const cur = (await f.admin.post('/currencies', { code: 'EUR', name: 'Euro', symbol: '€', exchangeRate: 0.093 }).expect(201).catch(async () => ({ body: await prisma.raw.currency.findUniqueOrThrow({ where: { code: 'EUR' } }) }))).body;
      await f.admin.post('/currencies', { code: 'eur', name: 'x', symbol: 'x' }).expect(400);
      await f.admin.post('/currencies', { code: 'USD', name: 'x', symbol: 'x', exchangeRate: -1 }).expect(400);
      expect(cur.code).toBe('EUR');
      const def = await prisma.raw.currency.findFirstOrThrow({ where: { isDefault: true, deletedAt: null } });
      expect((await f.admin.patch(`/currencies/${def.id}`, { isActive: false }).expect(400)).body.code).toBe('DEFAULT_REQUIRED');
      const lang = (await f.admin.get('/languages').expect(200)).body.data as { code: string }[];
      expect(lang.map((l) => l.code)).toEqual(expect.arrayContaining(['fr', 'ar', 'en']));
      await f.admin.post('/languages', { code: 'FRA', name: 'x', nativeName: 'x' }).expect(400);
    });
  });

  describe('payments, messages and documents', () => {
    it('payment methods: secrets never stored; the till list follows the dashboard', async () => {
      const code = `pm${uid()}`.slice(0, 14);
      expect((await f.admin.post('/payment-method-settings', { code, name: 'Gateway', type: 'ONLINE_PROVIDER', provider: 'cmi', config: { merchantId: '123', apiSecret: 'abc' } }).expect(400)).body.code).toBe('SECRET_IN_CONFIG');
      const m = (await f.admin.post('/payment-method-settings', { code, name: 'Chèque cadeau', type: 'OTHER', availableInPos: true, availableOnline: false, config: { merchantId: '123' } }).expect(201)).body;
      await f.admin.post('/payment-method-settings', { code, name: 'Dup', type: 'OTHER' }).expect(409);
      expect(((await f.cashier.get('/pos/config').expect(200)).body.paymentMethods as { code: string }[]).some((x) => x.code === code)).toBe(true);
      await f.admin.patch(`/payment-method-settings/${m.id}`, { isActive: false }).expect(200);
      expect(((await f.cashier.get('/pos/config')).body.paymentMethods as { code: string }[]).some((x) => x.code === code)).toBe(false);
      expect((await f.admin.del(`/payment-method-settings/${m.id}`)).status).toBe(204);
    });

    it('email templates refuse scripts and handlers but keep {{variables}} in links', async () => {
      const code = `tpl_${uid()}`.slice(0, 20);
      await f.admin.post('/email-templates', { code, locale: 'fr', subject: 'Salut', body: '<p>Hi</p><script>alert(1)</script>' }).expect(400);
      await f.admin.post('/email-templates', { code, locale: 'fr', subject: 'Salut', body: '<p onclick="x()">Hi</p>' }).expect(400);
      const ok = (await f.admin.post('/email-templates', { code, locale: 'fr', subject: 'Salut <b>{{firstName}}</b>', body: '<p><a href="{{resetUrl}}">Lien</a></p>' }).expect(201)).body;
      expect(ok.body).toContain('{{resetUrl}}');
      expect(ok.subject).toBe('Salut {{firstName}}'); // markup stripped from subjects
    });

    it('document templates: validated, previewable, one default per type, and used when printing', async () => {
      const bad = { type: 'RECEIPT', name: 'Bad', html: '<html><body>{{#if doc.number}}never closed</body></html>' };
      expect((await f.admin.post('/document-templates', bad).expect(400)).body.code).toBe('TEMPLATE_ERROR');
      expect((await f.admin.post('/document-templates', { ...bad, html: '<html><body><script>x</script>{{doc.number}}</body></html>' }).expect(400)).body.code).toBe('UNSAFE_MARKUP');
      const marker = `CUSTOM-${uid()}`;
      const html = `<!doctype html><html><body><h1>${marker}</h1><p>{{doc.number}} · {{customer.name}}</p>{{#each lines}}<i>{{description}}</i>{{/each}}</body></html>`;
      const pv = (await f.admin.post('/document-templates/preview', { type: 'RECEIPT', html, locale: 'fr' }).expect(200)).body.html as string;
      expect(pv).toContain(marker);
      expect(pv).toContain('Ray-Ban Clubmaster'); // sample data
      await f.admin.post('/document-templates/preview', { type: 'RECEIPT', html: '<script>x</script>' }).expect(400);

      const old = await prisma.raw.documentTemplate.findFirst({ where: { type: 'RECEIPT', isDefault: true, storeId: null, deletedAt: null } });
      const t = (await f.admin.post('/document-templates', { type: 'RECEIPT', name: 'Mon ticket', html, isDefault: true }).expect(201)).body;
      expect(await prisma.raw.documentTemplate.count({ where: { type: 'RECEIPT', isDefault: true, storeId: null, deletedAt: null } })).toBe(1);
      const s = await f.openCashier(100);
      const item = await f.newProduct({ price: 50 });
      const order = (await f.cashier.post('/pos/checkout', { lines: [{ variantId: item.variantId, quantity: 1 }], payments: [{ methodId: f.method('cash'), amount: 50 }] }).expect(201)).body;
      expect(((await f.cashier.get(`/orders/${order.id}/receipt`).expect(200)).body as { html: string }).html).toContain(marker);
      await f.closeSession(f.cashier, s.session.id, 150);
      await f.admin.del(`/document-templates/${t.id}`).expect(204);
      if (old) await prisma.raw.documentTemplate.update({ where: { id: old.id }, data: { isDefault: true } });
      const after = (await f.cashier.get(`/orders/${order.id}/receipt`).expect(200)).body as { html: string };
      expect(after.html).not.toContain(marker);
    });

    it('numbering: only the format row can be edited, with validation', async () => {
      const seqs = (await f.admin.get('/document-sequences').expect(200)).body as { id: string; periodKey: string; docType: string }[];
      const all = seqs.find((x) => x.periodKey === 'all')!;
      const counter = seqs.find((x) => x.periodKey !== 'all');
      await f.admin.patch(`/document-sequences/${all.id}`, { padding: 0 }).expect(400);
      await f.admin.patch(`/document-sequences/${all.id}`, { prefix: 'bad prefix!' }).expect(400);
      expect((await f.admin.patch(`/document-sequences/${all.id}`, { reset: 'MONTHLY' }).expect(200)).body.reset).toBe('MONTHLY');
      await f.admin.patch(`/document-sequences/${all.id}`, { reset: 'YEARLY' }).expect(200);
      if (counter) expect((await f.admin.patch(`/document-sequences/${counter.id}`, { padding: 4 }).expect(400)).body.code).toBe('NOT_A_TEMPLATE');
    });
  });

  describe('website content', () => {
    it('branding: colours must be #hex, fonts plain; the website reads the result', async () => {
      const current = (await f.admin.get('/branding').expect(200)).body;
      await f.admin.put('/branding', { storeName: 'X', colors: { light: { primary: 'red; background:url(x)' } } }).expect(400);
      await f.admin.put('/branding', { storeName: 'X', colors: { light: { nope: '#fff' } } }).expect(400);
      await f.admin.put('/branding', { storeName: 'X', fonts: { body: 'Arial;}</style><script>' } }).expect(400);
      const name = `Optique ${uid()}`;
      await f.admin.put('/branding', { storeName: `<b>${name}</b>`, tagline: 'Voir clair', colors: { light: { primary: '#123456' } }, fonts: { heading: 'Poppins', body: 'Inter' }, legal: { ice: '001122334455667', evil: 'x' } }).expect(200);
      const pub = (await anon('/public/branding').expect(200)).body;
      expect(pub.storeName).toBe(name); // tags stripped
      expect(pub.colors.light.primary).toBe('#123456');
      expect(pub.legal).toBeUndefined(); // legal details are never public
      await f.admin.put('/branding', { storeName: current.storeName, tagline: current.tagline, colors: current.colors, fonts: current.fonts, legal: current.legal }).expect(200);
    });

    it('menus: replaced as a whole, two levels, safe links only', async () => {
      const items = [{ label: 'Lunettes', url: '/catalogue', children: [{ label: 'Soleil', url: '/catalogue/lunettes-de-soleil' }] }, { label: 'Contact', url: '/contact' }];
      const m = (await f.admin.put('/menus/header', { items }).expect(200)).body;
      expect(m.items.map((i: { label: string }) => i.label)).toEqual(['Lunettes', 'Contact']);
      expect(m.items[0].children).toHaveLength(1);
      expect((await anon('/public/menus/header').expect(200)).body.items[0].children[0].label).toBe('Soleil');
      await f.admin.put('/menus/header', { items: [{ label: 'X', url: 'javascript:alert(1)' }] }).expect(400);
      await f.admin.put('/menus/header', { items: [{ label: 'A', children: [{ label: 'B', children: [{ label: 'C' }] }] }] }).expect(400);
      await f.admin.put('/menus/Bad Code', { items: [] }).expect(404).catch(() => undefined);
      await f.admin.put('/menus/header', { items: [{ label: 'Lunettes de vue', url: '/catalogue/lunettes-de-vue' }, { label: 'Rendez-vous', url: '/rendez-vous' }] }).expect(200);
    });

    it('pages and posts are cleaned on save; drafts and scheduled posts stay hidden', async () => {
      const slug = `page-${uid()}`;
      const page = (await f.admin.post('/cms-pages', { title: 'À propos', slug, content: '<h2>Hi</h2><script>alert(1)</script><a href="javascript:x">x</a>', status: 'PUBLISHED', translations: { ar: { title: '<i>عنّا</i>', content: '<p>نص</p><img src=x onerror=y>' } } }).expect(201)).body;
      expect(page.content).toBe('<h2>Hi</h2><a>x</a>');
      expect(page.publishedAt).toBeTruthy();
      expect(page.translations.ar).toEqual({ title: 'عنّا', content: '<p>نص</p><img src="x" />' });
      expect((await anon(`/public/pages/${slug}`).expect(200)).body.content).toBe('<h2>Hi</h2><a>x</a>');
      await f.admin.patch(`/cms-pages/${page.id}`, { status: 'DRAFT' }).expect(200);
      await anon(`/public/pages/${slug}`).expect(404);
      await f.cashier.post('/cms-pages', { title: 'x', content: 'y' }).expect(403);

      const post = (await f.admin.post('/blog-posts', { title: `Guide ${uid()}`, content: '<p>ok</p><iframe src="https://evil.example"></iframe>', status: 'PUBLISHED' }).expect(201)).body;
      expect(post.content).toBe('<p>ok</p>');
      expect(post.slug).toMatch(/^guide-/);
      expect((await anon(`/public/blog/${post.slug}`).expect(200)).body.title).toContain('Guide');
      const later = (await f.admin.post('/blog-posts', { title: `Bientôt ${uid()}`, content: 'x', status: 'PUBLISHED', publishedAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)).body;
      await anon(`/public/blog/${later.slug}`).expect(404); // scheduled
      const draft = (await f.admin.post('/blog-posts', { title: `Brouillon ${uid()}`, content: 'x' }).expect(201)).body;
      await anon(`/public/blog/${draft.slug}`).expect(404);
    });

    it('home sections: validated config, drag-and-drop order reaches the website', async () => {
      await f.admin.post('/home-sections', { type: 'NOPE' }).expect(400);
      expect((await f.admin.post('/home-sections', { type: 'FEATURED_PRODUCTS', config: { limit: 99 } }).expect(400)).body.code).toBe('INVALID_CONFIG');
      expect((await f.admin.post('/home-sections', { type: 'PROMO', config: { couponCode: 'bad code' } }).expect(400)).body.code).toBe('INVALID_CONFIG');
      expect((await f.admin.post('/home-sections', { type: 'BRANDS', startsAt: '2026-10-10', endsAt: '2026-10-01' }).expect(400)).body.code).toBe('INVALID_RANGE');
      const a = (await f.admin.post('/home-sections', { type: 'RICH_TEXT', title: `<b>Alpha ${uid()}</b>`, config: { html: '<p>x</p><script>y</script>' } }).expect(201)).body;
      const b = (await f.admin.post('/home-sections', { type: 'RICH_TEXT', title: `Beta ${uid()}` }).expect(201)).body;
      expect(a.title).toMatch(/^Alpha/);
      expect(a.config.html).toBe('<p>x</p>');
      await f.admin.post('/home-sections/reorder', { ids: [b.id, a.id] }).expect(200);
      const home = (await anon('/public/home').expect(200)).body as { id: string }[];
      expect(home.findIndex((s) => s.id === b.id)).toBeLessThan(home.findIndex((s) => s.id === a.id));
      await f.admin.post('/home-sections/reorder', { ids: [a.id, 'nope'] }).expect(400);
      await f.admin.del(`/home-sections/${a.id}`).expect(204);
      await f.admin.del(`/home-sections/${b.id}`).expect(204);
    });

    it('banners and testimonials accept same-site or https links only', async () => {
      await f.admin.post('/banners', { placement: 'HOME_HERO', imageUrl: 'javascript:alert(1)' }).expect(400);
      await f.admin.post('/banners', { placement: 'HOME_HERO', imageUrl: '/img/a.jpg', linkUrl: '//evil.example' }).expect(400);
      const b = (await f.admin.post('/banners', { placement: 'HOME_SECONDARY', title: '<i>Soldes</i>', imageUrl: 'https://cdn.example/a.jpg', linkUrl: '/catalogue' }).expect(201)).body;
      expect(b.title).toBe('Soldes');
      await f.admin.post('/testimonials', { authorName: 'Ali', content: 'Super <script>x</script>service', rating: 6 }).expect(400);
      const t = (await f.admin.post('/testimonials', { authorName: 'Ali', content: 'Super <script>x</script>service', rating: 5 }).expect(201)).body;
      expect(t.content).not.toContain('<script>');
    });
  });

  describe('modules', () => {
    it('switching a module off disables its staff and public routes for everyone, and back on restores them', async () => {
      const mods = (await f.manager.get('/modules').expect(200)).body as { moduleKey: string; isEnabled: boolean }[];
      expect(mods.map((m) => m.moduleKey)).toEqual(expect.arrayContaining(['pos', 'hr', 'blog', 'storefront']));
      await f.admin.put('/modules/users', { isEnabled: false }).expect(404); // the platform itself cannot be switched
      await f.admin.get('/employees').expect(200);
      await f.admin.put('/modules/hr', { isEnabled: false }).expect(200);
      expect((await f.admin.get('/employees').expect(403)).body.code).toBe('MODULE_DISABLED'); // even a super admin
      expect((await f.manager.get('/hr/me')).status).not.toBe(200);
      await f.admin.put('/modules/hr', { isEnabled: true }).expect(200);
      await f.admin.get('/employees').expect(200);

      await anon('/public/blog').expect(200);
      await f.admin.put('/modules/blog', { isEnabled: false }).expect(200);
      expect((await anon('/public/blog').expect(404)).body.code).toBe('MODULE_DISABLED');
      await anon('/public/products').expect(200); // the catalog is a different module
      await f.admin.put('/modules/blog', { isEnabled: true }).expect(200);
      await anon('/public/blog').expect(200);

      await f.admin.put('/modules/storefront', { isEnabled: false }).expect(200);
      await anon('/public/products').expect(404);
      await request(app.getHttpServer()).post('/api/v1/public/checkout').send({}).expect(404);
      await anon('/public/branding').expect(200); // the website shell still loads
      await f.admin.put('/modules/storefront', { isEnabled: true }).expect(200);
      await anon('/public/products').expect(200);
    });
  });

  describe('custom fields', () => {
    it('definitions, typed values, required fields, per-record permissions', async () => {
      const key = `loyalty_${uid()}`.slice(0, 30).replace(/[^a-z0-9_]/g, '');
      await f.admin.post('/custom-field-definitions', { entity: 'CUSTOMER', key: 'Bad Key', label: 'x', type: 'TEXT' }).expect(400);
      expect((await f.admin.post('/custom-field-definitions', { entity: 'CUSTOMER', key, label: 'Palier', type: 'SELECT' }).expect(400)).body.code).toBe('OPTIONS_REQUIRED');
      const sel = (await f.admin.post('/custom-field-definitions', { entity: 'CUSTOMER', key, label: 'Palier', type: 'SELECT', options: ['Bronze', 'Argent', 'Or'], isRequired: true }).expect(201)).body;
      const nk = `${key}_n`.slice(0, 38);
      const num = (await f.admin.post('/custom-field-definitions', { entity: 'CUSTOMER', key: nk, label: 'Enfants', type: 'NUMBER' }).expect(201)).body;
      await f.admin.post('/custom-field-definitions', { entity: 'CUSTOMER', key, label: 'Dup', type: 'TEXT' }).expect(409);
      expect((await f.admin.patch(`/custom-field-definitions/${num.id}`, { type: 'TEXT' }).expect(400)).body.code).toBe('FIELD_LOCKED');

      const customer = (await f.admin.post('/customers', { firstName: 'Cf', lastName: `Test${uid()}`, phone: `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}` }).expect(201)).body;
      expect((await f.admin.put(`/custom-fields/customer/${customer.id}`, { values: { [nk]: 2 } }).expect(400)).body.code).toBe('FIELD_REQUIRED'); // the select is required
      expect((await f.admin.put(`/custom-fields/customer/${customer.id}`, { values: { [key]: 'Platine' } }).expect(400)).body.code).toBe('INVALID_FIELD');
      expect((await f.admin.put(`/custom-fields/customer/${customer.id}`, { values: { [key]: 'Or', [nk]: 1.5 } }).expect(400)).body.code).toBe('INVALID_FIELD');
      expect((await f.admin.put(`/custom-fields/customer/${customer.id}`, { values: { unknown_field: 1 } }).expect(400)).body.code).toBe('UNKNOWN_FIELD');
      const saved = (await f.admin.put(`/custom-fields/customer/${customer.id}`, { values: { [key]: 'Or', [nk]: 3 } }).expect(200)).body as { key: string; value: unknown }[];
      expect(saved.find((v) => v.key === key)!.value).toBe('Or');
      expect(saved.find((v) => v.key === nk)!.value).toBe(3);
      // partial update keeps the rest; clearing an optional field removes it
      const again = (await f.admin.put(`/custom-fields/customer/${customer.id}`, { values: { [nk]: null } }).expect(200)).body as { key: string; value: unknown }[];
      expect(again.find((v) => v.key === key)!.value).toBe('Or');
      expect(again.find((v) => v.key === nk)!.value).toBeNull();
      expect((await f.admin.del(`/custom-field-definitions/${sel.id}`)).status).toBe(409); // values exist: deactivate instead

      expect(((await f.technician.get(`/custom-fields/customer/${customer.id}`).expect(200)).body as unknown[]).length).toBeGreaterThan(0); // customers:read
      await f.technician.put(`/custom-fields/customer/${customer.id}`, { values: { [key]: 'Bronze' } }).expect(403); // but no customers:update
      await f.cashier.get(`/custom-fields/supplier/${customer.id}`).expect(403); // cashiers cannot read suppliers
      await f.admin.get('/custom-fields/nonsense/x').expect(400);
      await f.admin.get('/custom-fields/customer/does-not-exist').expect(404);
      await f.admin.patch(`/custom-field-definitions/${sel.id}`, { isActive: false, isRequired: false }).expect(200);
    });
  });
});
