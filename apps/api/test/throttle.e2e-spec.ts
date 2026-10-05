import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app';
import { loginAs } from './helpers';

const burst = (n: number, fn: () => request.Test) => Promise.all(Array.from({ length: n }, fn)).then((rs) => rs.map((r) => r.status));

describe('Rate limiting: credential endpoints (strict per-IP bucket)', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp({ THROTTLE_LIMIT: '1000', THROTTLE_AUTH_LIMIT: '4' }); });
  afterAll(async () => { await app.close(); });

  it('login is limited per IP: 4 attempts, then 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'nobody@x.io', password: 'whatever123' })).status);
    expect(codes).toEqual([401, 401, 401, 401, 429, 429, 429]);
  });

  it('forgot-password and reset-password are strict too (each endpoint has its own allowance), with the standard error body', async () => {
    const codes: number[] = [];
    let last: request.Response | undefined;
    for (let i = 0; i < 6; i++) { last = await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'a@b.co' }); codes.push(last.status); }
    expect(codes).toEqual([202, 202, 202, 202, 429, 429]); // buckets are per route: the login attempts above did not spend this one
    expect(last!.body).toMatchObject({ statusCode: 429, traceId: expect.any(String) });
  });

  it('refresh is NOT in the strict bucket: tokens are unguessable and every page load calls it (a shop must not be logged out by reloads)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: 'x'.repeat(20) })).status);
    expect(codes.every((c) => c === 401)).toBe(true);
  });

  it('the strict bucket does not touch ordinary routes', async () => {
    const codes = await burst(20, () => request(app.getHttpServer()).get('/api/v1/public/branding'));
    expect(codes.every((c) => c === 200)).toBe(true);
  });
});

describe('Rate limiting: general traffic (per user when signed in, per IP otherwise)', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp({ THROTTLE_LIMIT: '8', THROTTLE_AUTH_LIMIT: '1000' }); });
  afterAll(async () => { await app.close(); });

  it('one busy user cannot lock out a colleague sharing the same IP', async () => {
    const admin = await loginAs(app, 'admin');
    const cashier = await loginAs(app, 'cashier');
    const adminCodes = await burst(14, () => admin.get('/customers?limit=1'));
    expect(adminCodes.filter((c) => c === 200).length).toBeLessThanOrEqual(8); // the admin hit the ceiling…
    expect(adminCodes).toContain(429);
    expect((await cashier.get('/customers?limit=1')).status).toBe(200); // …the cashier (same IP) is unaffected
  });

  it('anonymous traffic is limited per IP; /health is exempt', async () => {
    const codes = await burst(14, () => request(app.getHttpServer()).get('/api/v1/public/branding'));
    expect(codes).toContain(429);
    const health = await burst(14, () => request(app.getHttpServer()).get('/api/v1/health'));
    expect(health.every((c) => c === 200)).toBe(true);
  });

  it('a request with an invalid token is rejected (401) before it can consume anyone\'s quota', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/customers').set('Authorization', 'Bearer not.a.jwt');
    expect(r.status).toBe(401);
  });
});

describe('Rate limiting behind a reverse proxy (TRUST_PROXY)', () => {
  const attempt = (app: INestApplication, ip: string) => request(app.getHttpServer()).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email: 'nobody@x.io', password: 'whatever123' });

  it('with TRUST_PROXY=1 each real client IP gets its own login allowance', async () => {
    const app = await createTestApp({ THROTTLE_LIMIT: '1000', THROTTLE_AUTH_LIMIT: '2', TRUST_PROXY: '1' });
    try {
      expect([(await attempt(app, '10.0.0.1')).status, (await attempt(app, '10.0.0.1')).status, (await attempt(app, '10.0.0.1')).status]).toEqual([401, 401, 429]);
      expect((await attempt(app, '10.0.0.2')).status).toBe(401); // a different client behind the same proxy is NOT throttled
    } finally { await app.close(); }
  });

  it('without TRUST_PROXY a spoofed X-Forwarded-For cannot be used to dodge the limit', async () => {
    const app = await createTestApp({ THROTTLE_LIMIT: '1000', THROTTLE_AUTH_LIMIT: '2', TRUST_PROXY: '' });
    try {
      const codes = [];
      for (let i = 1; i <= 4; i++) codes.push((await attempt(app, `10.9.9.${i}`)).status); // a new fake IP every time
      expect(codes).toEqual([401, 401, 429, 429]);
    } finally { await app.close(); }
  });
});
