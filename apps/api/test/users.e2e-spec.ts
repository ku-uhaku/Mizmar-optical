import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Users CRUD, soft delete & audit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: { Authorization: string };
  const http = () => request(app.getHttpServer());
  const email = `e2e.${Date.now()}@mizmar.local`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const { body } = await http().post('/api/v1/auth/login').send({ email: 'admin@mizmar.local', password: 'ChangeMe!2026' }).expect(200);
    auth = { Authorization: `Bearer ${body.accessToken}` };
  });
  afterAll(async () => { await app.close(); });

  it('validates input and refuses unknown fields (no mass assignment)', async () => {
    await http().post('/api/v1/users').set(auth).send({ email: 'nope' }).expect(400);
    await http().post('/api/v1/users').set(auth).send({ email, password: 'longenough1', firstName: 'E', lastName: 'Two', isSuperAdmin: true }).expect(400);
  });

  it('creates, lists with search/pagination, audits (redacted), soft-deletes and releases the email', async () => {
    const created = await http().post('/api/v1/users').set(auth).send({ email, password: 'longenough1', firstName: 'E2E', lastName: 'User' }).expect(201);
    expect(created.body).not.toHaveProperty('passwordHash');
    await http().post('/api/v1/users').set(auth).send({ email, password: 'longenough1', firstName: 'Dup', lastName: 'User' }).expect(409);

    const list = await http().get('/api/v1/users').query({ search: 'e2e.', limit: 5 }).set(auth).expect(200);
    expect(list.body.meta).toMatchObject({ page: 1, limit: 5 });
    expect(list.body.data.map((u: any) => u.id)).toContain(created.body.id);

    const audit = await prisma.raw.auditLog.findFirst({ where: { entity: 'users', entityId: created.body.id, action: 'CREATE' } });
    expect(audit).not.toBeNull();
    expect((audit!.after as any).password).toBe('[REDACTED]');

    await http().delete(`/api/v1/users/${created.body.id}`).set(auth).expect(204);
    await http().get(`/api/v1/users/${created.body.id}`).set(auth).expect(404);
    const row = await prisma.raw.user.findUnique({ where: { id: created.body.id } });
    expect(row?.deletedAt).toBeInstanceOf(Date); // row persists
    expect(row?.email).toContain('#del-'); // unique value released
    await http().post('/api/v1/users').set(auth).send({ email, password: 'longenough1', firstName: 'Again', lastName: 'User' }).expect(201);
  });

  it('soft-delete extension hides deleted rows from db reads but not raw reads', async () => {
    const slug = `e2e-brand-${Date.now()}`;
    const brand = await prisma.raw.brand.create({ data: { name: 'E2E', slug } });
    await prisma.db.brand.delete({ where: { id: brand.id } });
    expect(await prisma.db.brand.findFirst({ where: { slug } })).toBeNull();
    expect(await prisma.db.brand.count({ where: { slug } })).toBe(0);
    expect((await prisma.raw.brand.findUnique({ where: { id: brand.id } }))?.deletedAt).toBeInstanceOf(Date);
    await prisma.raw.brand.delete({ where: { id: brand.id } });
  });
});
