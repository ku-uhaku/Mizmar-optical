import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app';

const ADMIN = { email: 'admin@mizmar.local', password: 'ChangeMe!2026' };
const CASHIER = { email: 'cashier@mizmar.local', password: 'Demo!2026pass' };

describe('Auth flow (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  it('login -> /auth/me -> refresh (rotation) -> old token rejected -> logout', async () => {
    const login = await http().post('/api/v1/auth/login').send(ADMIN).expect(200);
    expect(login.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(JSON.stringify(login.body)).not.toContain('passwordHash');

    const me = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ email: ADMIN.email, isSuperAdmin: true });
    expect(me.body.storeIds).toHaveLength(2);

    const rotated = await http().post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(login.body.refreshToken);

    const reuse = await http().post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
    expect(reuse.body.code).toBe('REFRESH_TOKEN_REUSED');
    // reuse killed the whole token family, including the freshly rotated token
    await http().post('/api/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);

    const fresh = await http().post('/api/v1/auth/login').send(ADMIN).expect(200);
    await http().post('/api/v1/auth/logout').send({ refreshToken: fresh.body.refreshToken }).expect(204);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: fresh.body.refreshToken }).expect(401);
  });

  it('rejects bad credentials and unauthenticated access', async () => {
    const bad = await http().post('/api/v1/auth/login').send({ ...ADMIN, password: 'wrong-password' }).expect(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
    await http().get('/api/v1/users').expect(401);
    await http().get('/api/v1/users').set('Authorization', 'Bearer not.a.jwt').expect(401);
  });

  it('enforces RBAC: cashier is forbidden from users:read but may call /auth/me', async () => {
    const { body } = await http().post('/api/v1/auth/login').send(CASHIER).expect(200);
    const auth = { Authorization: `Bearer ${body.accessToken}` };
    const denied = await http().get('/api/v1/users').set(auth).expect(403);
    expect(denied.body).toMatchObject({ code: 'MISSING_PERMISSION', details: { missing: ['users:read'] } });
    const me = await http().get('/api/v1/auth/me').set(auth).expect(200);
    expect(me.body.permissions).toContain('pos:access');
    expect(me.body.isSuperAdmin).toBe(false);
  });
});
