import { INestApplication } from '@nestjs/common';
import request from 'supertest';

export const CREDS = {
  // the SAME values the seed used (global-setup seeds with this environment), so tests pass whatever .env says
  admin: { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@mizmar.local', password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026' },
  cashier: { email: 'cashier@mizmar.local', password: 'Demo!2026pass' },
  optician: { email: 'optician@mizmar.local', password: 'Demo!2026pass' },
  technician: { email: 'technician@mizmar.local', password: 'Demo!2026pass' },
  manager: { email: 'manager@mizmar.local', password: 'Demo!2026pass' },
};

/** Logs in and returns a tiny client with the bearer token (and optional store) pre-applied. */
export async function loginAs(app: INestApplication, who: keyof typeof CREDS, storeId?: string) {
  const { body } = await request(app.getHttpServer()).post('/api/v1/auth/login').send(CREDS[who]).expect(200);
  const h = { Authorization: `Bearer ${body.accessToken}`, ...(storeId ? { 'x-store-id': storeId } : {}) };
  const srv = () => app.getHttpServer();
  return {
    user: body.user as { id: string; storeIds: string[]; stores: { id: string; code: string }[] },
    get: (p: string) => request(srv()).get(`/api/v1${p}`).set(h),
    post: (p: string, b?: object) => request(srv()).post(`/api/v1${p}`).set(h).send(b),
    patch: (p: string, b?: object) => request(srv()).patch(`/api/v1${p}`).set(h).send(b),
    put: (p: string, b?: object) => request(srv()).put(`/api/v1${p}`).set(h).send(b),
    del: (p: string) => request(srv()).delete(`/api/v1${p}`).set(h),
  };
}
export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
