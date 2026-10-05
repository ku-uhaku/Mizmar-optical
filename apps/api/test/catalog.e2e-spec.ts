import { INestApplication } from '@nestjs/common';
import { createTestApp } from './app';
import { loginAs, uid } from './helpers';

describe('Catalog reference data (e2e)', () => {
  let app: INestApplication;
  let admin: Awaited<ReturnType<typeof loginAs>>;
  beforeAll(async () => { app = await createTestApp(); admin = await loginAs(app, 'admin'); });
  afterAll(async () => { await app.close(); });

  it('validates bodies on factory-built controllers (unknown fields and bad types are rejected)', async () => {
    await admin.post('/brands', { name: 'X', evil: true }).expect(400);
    await admin.post('/brands', { name: 123 }).expect(400);
    await admin.post('/lens-types', { code: 'BAD CODE', kind: 'NOPE', name: 'x' }).expect(400);
    await admin.post('/brands', { name: 'X', deletedAt: '2020-01-01' }).expect(400); // no mass-assignment of system columns
  });

  it('a null for a REQUIRED column is a client error (400), never a 500', async () => {
    const b = (await admin.post('/brands', { name: `Nullable ${uid()}` }).expect(201)).body;
    const r = await admin.patch(`/brands/${b.id}`, { name: null });
    expect(r.status).toBe(400);
    await admin.patch(`/brands/${b.id}`, { description: null }).expect(200); // clearing an OPTIONAL field with null is allowed
    await admin.del(`/brands/${b.id}`).expect(204);
  });

  it('brand: auto slug, collision-safe slugs, update, list filter/search, soft delete releases the slug', async () => {
    const name = `Test Brand ${uid()}`;
    const a = (await admin.post('/brands', { name }).expect(201)).body;
    expect(a.slug).toMatch(/^test-brand-/);
    const b = (await admin.post('/brands', { name }).expect(201)).body;
    expect(b.slug).toBe(`${a.slug}-2`);
    await admin.patch(`/brands/${a.id}`, { isFeatured: true }).expect(200);
    const list = (await admin.get(`/brands?search=${encodeURIComponent(name)}&isActive=true`).expect(200)).body;
    expect(list.meta.total).toBe(2);
    await admin.del(`/brands/${a.id}`).expect(204);
    await admin.get(`/brands/${a.id}`).expect(404);
    const c = (await admin.post('/brands', { name, slug: a.slug }).expect(201)).body; // slug is free again
    expect(c.slug).toBe(a.slug);
    await admin.del(`/brands/${b.id}`); await admin.del(`/brands/${c.id}`);
  });

  it('category: tree is cycle-safe and a used category cannot be deleted', async () => {
    const parent = (await admin.post('/categories', { name: `P ${uid()}` }).expect(201)).body;
    const child = (await admin.post('/categories', { name: `C ${uid()}`, parentId: parent.id }).expect(201)).body;
    await admin.patch(`/categories/${parent.id}`, { parentId: child.id }).expect(400); // would create a cycle
    await admin.patch(`/categories/${parent.id}`, { parentId: parent.id }).expect(400);
    const r = await admin.del(`/categories/${parent.id}`).expect(409);
    expect(r.body.code).toBe('IN_USE');
    await admin.del(`/categories/${child.id}`).expect(204);
    await admin.del(`/categories/${parent.id}`).expect(204);
  });

  it('lens type: treatments are replaced as a set and returned', async () => {
    const treatments = (await admin.get('/lens-treatments?limit=3').expect(200)).body.data.map((t: any) => t.id);
    const code = `lt_${uid()}`.replace(/[^a-z0-9_]/g, '');
    const lt = (await admin.post('/lens-types', { code, kind: 'SINGLE_VISION', name: 'LT', basePrice: 100, treatmentIds: treatments }).expect(201)).body;
    expect(lt.treatments.map((t: any) => t.treatmentId).sort()).toEqual([...treatments].sort());
    const upd = (await admin.patch(`/lens-types/${lt.id}`, { treatmentIds: [treatments[0]] }).expect(200)).body;
    expect(upd.treatments).toHaveLength(1);
    await admin.del(`/lens-types/${lt.id}`).expect(204);
  });

  it('enforces permissions: optician may read the catalog but not change it', async () => {
    const optician = await loginAs(app, 'optician');
    await optician.get('/brands').expect(200);
    const denied = await optician.post('/brands', { name: 'Nope' }).expect(403);
    expect(denied.body.details.missing).toEqual(['catalog:create']);
    const cashier = await loginAs(app, 'cashier');
    await cashier.get('/brands').expect(403); // cashier has no catalog access at all
  });
});
