import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app';
import { loginAs, uid } from './helpers';

type Client = Awaited<ReturnType<typeof loginAs>>;
const phone = () => `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe('Customers & prescriptions (e2e)', () => {
  let app: INestApplication;
  let admin: Client;
  beforeAll(async () => { app = await createTestApp(); admin = await loginAs(app, 'admin'); });
  afterAll(async () => { await app.close(); });

  const newCustomer = async (over: Record<string, any> = {}) =>
    (await admin.post('/customers', { firstName: 'Test', lastName: `Cust${uid()}`, phone: phone(), email: `c.${uid()}@example.com`, ...over }).expect(201)).body;

  describe('customers', () => {
    it('creates with an auto code, normalises email, validates input', async () => {
      const c = await newCustomer({ email: `UPPER.${uid()}@Example.COM` });
      expect(c.code).toMatch(/^[A-Z]+-CLI-\d{4}-\d{6}$/);
      expect(c.email).toBe(c.email.toLowerCase());
      expect(c.preferredStoreId).toBeTruthy();
      await admin.post('/customers', { firstName: 'X' }).expect(400);
      await admin.post('/customers', { firstName: 'X', lastName: 'Y', phone: 'abc' }).expect(400);
      await admin.post('/customers', { firstName: 'X', lastName: 'Y', email: 'nope' }).expect(400);
      await admin.post('/customers', { firstName: 'X', lastName: 'Y', loyaltyPoints: 9999 }).expect(400); // not client-settable
      await admin.post('/customers', { firstName: 'X', lastName: 'Y', code: 'HACK-1' }).expect(400);
    });

    it('customer codes are unique under concurrency', async () => {
      const rs = await Promise.all(Array.from({ length: 8 }, () => admin.post('/customers', { firstName: 'Par', lastName: uid(), phone: phone() }).expect(201)));
      expect(new Set(rs.map((r) => r.body.code)).size).toBe(8);
    });

    it('blocks duplicates by phone/email (409 with the matches) unless explicitly allowed', async () => {
      const a = await newCustomer();
      const dup = await admin.post('/customers', { firstName: 'Other', lastName: 'Person', phone: a.phone }).expect(409);
      expect(dup.body.code).toBe('DUPLICATE_CUSTOMER');
      expect(dup.body.details.matches[0].id).toBe(a.id);
      await admin.post('/customers', { firstName: 'Other', lastName: 'Person', email: a.email.toUpperCase() }).expect(409); // case-insensitive
      const forced = await admin.post('/customers', { firstName: 'Twin', lastName: 'Person', phone: a.phone, allowDuplicate: true }).expect(201);
      expect(forced.body.id).not.toBe(a.id);
      const b = await newCustomer();
      await admin.patch(`/customers/${b.id}`, { phone: a.phone }).expect(409);
      await admin.patch(`/customers/${a.id}`, { phone: a.phone, firstName: 'Same' }).expect(409); // the forced twin ALSO has this number
      const solo = await newCustomer();
      await admin.patch(`/customers/${solo.id}`, { phone: solo.phone, firstName: 'Same' }).expect(200); // keeping your own number is fine
      await admin.patch(`/customers/${solo.id}`, { phone: phone() }).expect(200); // moving to a free number is fine
    });

    it('searches (name / phone / code), filters, paginates, updates and soft-deletes', async () => {
      const c = await newCustomer({ firstName: 'Zéphyrine', gender: 'WOMEN' });
      for (const q of [c.lastName, c.phone, c.code, 'zéphy']) {
        const r = (await admin.get(`/customers?search=${encodeURIComponent(q)}`).expect(200)).body;
        expect(r.data.map((x: any) => x.id)).toContain(c.id);
      }
      expect((await admin.get(`/customers?search=${c.lastName}&gender=MEN`)).body.data).toHaveLength(0);
      expect((await admin.get('/customers?limit=2&page=2')).body.meta).toMatchObject({ page: 2, limit: 2 });
      await admin.get('/customers?limit=1000').expect(400);
      const upd = (await admin.patch(`/customers/${c.id}`, { marketingOptIn: true, dateOfBirth: '1985-03-21' }).expect(200)).body;
      expect(upd.marketingOptIn).toBe(true);
      expect(upd.dateOfBirth).toMatch(/^1985-03-21/);
      await admin.del(`/customers/${c.id}`).expect(204);
      await admin.get(`/customers/${c.id}`).expect(404);
      expect((await admin.get(`/customers?search=${c.lastName}`)).body.data).toHaveLength(0);
    });

    it('addresses: one default shipping address at a time', async () => {
      const c = await newCustomer();
      const a1 = (await admin.post(`/customers/${c.id}/addresses`, { line1: '1 Rue A', city: 'Casablanca', isDefaultShipping: true }).expect(201)).body;
      const a2 = (await admin.post(`/customers/${c.id}/addresses`, { line1: '2 Rue B', city: 'Rabat', isDefaultShipping: true }).expect(201)).body;
      let got = (await admin.get(`/customers/${c.id}`)).body.addresses;
      expect(got.find((a: any) => a.id === a1.id).isDefaultShipping).toBe(false);
      expect(got.find((a: any) => a.id === a2.id).isDefaultShipping).toBe(true);
      await admin.patch(`/customers/addresses/${a1.id}`, { isDefaultShipping: true }).expect(200);
      got = (await admin.get(`/customers/${c.id}`)).body.addresses;
      expect(got.filter((a: any) => a.isDefaultShipping)).toHaveLength(1);
      await admin.del(`/customers/addresses/${a2.id}`).expect(204);
      expect((await admin.get(`/customers/${c.id}`)).body.addresses).toHaveLength(1);
      await admin.post(`/customers/${c.id}/addresses`, { line1: 'x', city: 'y', country: 'maroc' }).expect(400);
    });

    it('notes record the author and pinned notes come first; insurance validates provider and dates', async () => {
      const c = await newCustomer();
      await admin.post(`/customers/${c.id}/notes`, { body: 'Prefers thin frames' }).expect(201);
      await admin.post(`/customers/${c.id}/notes`, { body: 'Allergic to nickel', isPinned: true }).expect(201);
      const notes = (await admin.get(`/customers/${c.id}`)).body.notes;
      expect(notes.map((n: any) => n.body)).toEqual(['Allergic to nickel', 'Prefers thin frames']);
      expect(notes[0].author).toMatchObject({ firstName: 'Super' });
      const prov = (await admin.post('/insurance-providers', { name: `Mutuelle ${uid()}`, defaultCoveragePct: 80 }).expect(201)).body;
      await admin.post(`/customers/${c.id}/insurances`, { providerId: 'nope' }).expect(400);
      await admin.post(`/customers/${c.id}/insurances`, { providerId: prov.id, coveragePct: 120 }).expect(400);
      await admin.post(`/customers/${c.id}/insurances`, { providerId: prov.id, validFrom: '2026-06-01', validTo: '2026-01-01' }).expect(400);
      const ins = (await admin.post(`/customers/${c.id}/insurances`, { providerId: prov.id, memberId: 'M-1', coveragePct: 70 }).expect(201)).body;
      expect(ins.provider.id).toBe(prov.id);
      expect((await admin.del(`/insurance-providers/${prov.id}`).expect(409)).body.code).toBe('IN_USE');
      await admin.del(`/customers/insurances/${ins.id}`).expect(204);
      await admin.del(`/insurance-providers/${prov.id}`).expect(204);
    });

    it('CSV export neutralises spreadsheet formulas and quotes properly', async () => {
      const c = await newCustomer({ firstName: '=HYPERLINK("http://evil")', lastName: 'Comma, "Quote"' });
      const res = await admin.get('/customers/export.csv').expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const line = res.text.split('\r\n').find((l) => l.includes(c.code))!;
      expect(line).toContain(`"'=HYPERLINK(""http://evil"")"`); // prefixed with ' and quotes doubled
      expect(line).toContain('"Comma, ""Quote"""');
      const cashier = await loginAs(app, 'cashier');
      await cashier.get('/customers/export.csv').expect(403); // export is its own permission
    });

    it('permissions: technician may read customers but not create; cashier cannot delete', async () => {
      const tech = await loginAs(app, 'technician');
      await tech.get('/customers?limit=1').expect(200);
      await tech.post('/customers', { firstName: 'a', lastName: 'b' }).expect(403);
      const cashier = await loginAs(app, 'cashier');
      const c = await newCustomer();
      await cashier.del(`/customers/${c.id}`).expect(403);
      await cashier.post('/customers', { firstName: 'Walk', lastName: `In${uid()}`, phone: phone() }).expect(201);
    });
  });

  describe('prescriptions', () => {
    const rx = (o: Record<string, any> = {}) => ({ issuedAt: '2026-06-15', prescriberName: 'Dr. Bennani', odSph: -2, odCyl: -0.75, odAxis: 90, osSph: -1.75, osCyl: -0.5, osAxis: 85, odPd: 31.5, osPd: 31, pdTotal: 62.5, ...o });

    it('creates, returns numbers + derived fields, and the newest becomes current (others deactivated)', async () => {
      const c = await newCustomer();
      const a = (await admin.post(`/customers/${c.id}/prescriptions`, rx()).expect(201)).body;
      expect(a).toMatchObject({ odSph: -2, odCyl: -0.75, odAxis: 90, pdTotal: 62.5, isActive: true, source: 'STORE', odSphericalEquivalent: -2.38 });
      const b = (await admin.post(`/customers/${c.id}/prescriptions`, rx({ issuedAt: '2026-09-01', odSph: -2.25 })).expect(201)).body;
      const list = (await admin.get(`/customers/${c.id}/prescriptions`).expect(200)).body;
      expect(list.map((r: any) => [r.id, r.isActive])).toEqual([[b.id, true], [a.id, false]]); // newest first
      const detail = (await admin.get(`/customers/${c.id}`)).body;
      expect(detail.prescriptionCount).toBe(2);
      expect(detail.currentPrescription.id).toBe(b.id);
      const keep = (await admin.post(`/customers/${c.id}/prescriptions`, rx({ makeCurrent: false })).expect(201)).body;
      expect(keep.isActive).toBe(false);
      expect((await admin.get(`/customers/${c.id}`)).body.currentPrescription.id).toBe(b.id);
    });

    it('rejects clinically invalid prescriptions with every problem listed', async () => {
      const c = await newCustomer();
      const bad = await admin.post(`/customers/${c.id}/prescriptions`, { issuedAt: '2026-06-15', odSph: -1.3, odCyl: -0.5, osPrism: 1 }).expect(400);
      expect(bad.body.code).toBe('INVALID_PRESCRIPTION');
      expect(bad.body.details).toEqual(expect.arrayContaining(['OD sphere must be in 0.25 steps', 'OD axis is required when a cylinder is given', 'OS prism requires a base direction']));
      await admin.post(`/customers/${c.id}/prescriptions`, rx({ odSph: -25 })).expect(400); // out of range
      await admin.post(`/customers/${c.id}/prescriptions`, rx({ odAxis: 181 })).expect(400);
      await admin.post(`/customers/${c.id}/prescriptions`, rx({ odPd: 90 })).expect(400);
      await admin.post(`/customers/${c.id}/prescriptions`, rx({ issuedAt: '2031-01-01' })).expect(400);
      await admin.post(`/customers/${c.id}/prescriptions`, rx({ attachmentUrl: 'javascript:alert(1)' })).expect(400);
      await admin.post(`/customers/${c.id}/prescriptions`, { issuedAt: '2026-06-15' }).expect(400); // no measurement at all
      await admin.post(`/customers/nope/prescriptions`, rx()).expect(404);
    });

    it('validates the MERGED record on update, resets verification when measurements change', async () => {
      const c = await newCustomer();
      const r = (await admin.post(`/customers/${c.id}/prescriptions`, rx({ odCyl: undefined, odAxis: undefined, osCyl: undefined, osAxis: undefined })).expect(201)).body;
      await admin.patch(`/prescriptions/${r.id}`, { odCyl: -1 }).expect(400); // axis never given
      const ok = (await admin.patch(`/prescriptions/${r.id}`, { odCyl: -1, odAxis: 45 }).expect(200)).body;
      expect(ok).toMatchObject({ odCyl: -1, odAxis: 45 });
      const v = (await admin.post(`/prescriptions/${r.id}/verify`).expect(200)).body;
      expect(v.verifiedAt).toBeTruthy();
      expect(v.verifiedById).toBeTruthy();
      expect((await admin.patch(`/prescriptions/${r.id}`, { notes: 'typo fix' }).expect(200)).body.verifiedAt).toBeTruthy(); // non-clinical edit keeps it
      expect((await admin.patch(`/prescriptions/${r.id}`, { odSph: -2.5 }).expect(200)).body.verifiedAt).toBeNull(); // clinical edit clears it
    });

    it('flags expired prescriptions and supports delete', async () => {
      const c = await newCustomer();
      const r = (await admin.post(`/customers/${c.id}/prescriptions`, rx({ issuedAt: '2020-01-01', expiresAt: '2022-01-01' })).expect(201)).body;
      expect(r.isExpired).toBe(true);
      expect((await admin.post(`/customers/${c.id}/prescriptions`, rx({ expiresAt: '2099-01-01' })).expect(201)).body.isExpired).toBe(false);
      await admin.del(`/prescriptions/${r.id}`).expect(204);
      await admin.get(`/prescriptions/${r.id}`).expect(404);
    });

    it('permissions: optician writes prescriptions; cashier reads but cannot write; technician reads', async () => {
      const c = await newCustomer();
      const optician = await loginAs(app, 'optician');
      const r = (await optician.post(`/customers/${c.id}/prescriptions`, rx()).expect(201)).body;
      expect(r.createdById).toBe(optician.user.id);
      const cashier = await loginAs(app, 'cashier');
      await cashier.get(`/customers/${c.id}/prescriptions`).expect(200);
      expect((await cashier.post(`/customers/${c.id}/prescriptions`, rx()).expect(403)).body.details.missing).toEqual(['prescriptions:create']);
      const tech = await loginAs(app, 'technician');
      await tech.get(`/prescriptions/${r.id}`).expect(200);
      await tech.del(`/prescriptions/${r.id}`).expect(403);
    });
  });

  describe('media upload', () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const upload = (client: Client, buf: Buffer, name: string, mime: string, folder = 'products') =>
      request(app.getHttpServer()).post(`/api/v1/media?folder=${folder}`).set('Authorization', `Bearer ${(client as any)._token ?? ''}`);

    it('stores a real image, ignoring the client file name and claimed type; rejects spoofed, oversized and misplaced files', async () => {
      const { body } = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'admin@mizmar.local', password: 'ChangeMe!2026' });
      const auth = { Authorization: `Bearer ${body.accessToken}` };
      const post = (buf: Buffer, name: string, mime: string, folder = 'products') => request(app.getHttpServer()).post(`/api/v1/media?folder=${folder}`).set(auth).attach('file', buf, { filename: name, contentType: mime });

      const ok = await post(PNG, '../../etc/passwd.exe', 'text/plain').expect(201); // lies about name AND type
      expect(ok.body).toMatchObject({ mimeType: 'image/png', folder: 'products' });
      expect(ok.body.key).toMatch(/^products\/[0-9a-f-]{36}\.png$/); // original name is not part of the key
      const fetched = await fetch(ok.body.url);
      expect(fetched.status).toBe(200); // public-read bucket
      expect((await fetched.arrayBuffer()).byteLength).toBe(PNG.length);

      await post(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png', 'image/png').expect(400); // SVG/HTML disguised as PNG
      await post(Buffer.from('MZ\x90\x00 not an image'), 'x.jpg', 'image/jpeg').expect(400);
      await post(Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'big.png', 'image/png').expect(413);
      await post(Buffer.from('%PDF-1.4 fake'), 'rx.pdf', 'application/pdf', 'products').expect(400); // pdf only for prescriptions
      await post(Buffer.from('%PDF-1.4 fake'), 'rx.pdf', 'application/pdf', 'prescriptions').expect(201);
      await post(PNG, 'a.png', 'image/png', '../secrets').expect(400);
      await request(app.getHttpServer()).post('/api/v1/media').set(auth).expect(400); // no file
      const cashier = await loginAs(app, 'cashier');
      void upload; void cashier;
      const cashierLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'cashier@mizmar.local', password: 'Demo!2026pass' });
      await request(app.getHttpServer()).post('/api/v1/media').set('Authorization', `Bearer ${cashierLogin.body.accessToken}`).attach('file', PNG, 'a.png').expect(403);
    });
  });
});
