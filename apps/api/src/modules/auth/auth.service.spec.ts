import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { AuthService, ttlToMs } from './auth.service';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

function setup() {
  const raw = {
    user: { update: jest.fn().mockResolvedValue({}) },
    refreshToken: { findUnique: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'new-token-id' }), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const db = { user: { findFirst: jest.fn() } };
  const cfg: Record<string, string> = { JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL: '7d', ADMIN_URL: 'http://admin' };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt') };
  const service = new AuthService({ raw, db } as any, jwt as any, { get: (k: string) => cfg[k] } as any, { add: jest.fn() } as any);
  jest.spyOn(service, 'loadAuthUser').mockResolvedValue({ id: 'u1' } as any);
  return { service, raw, db, jwt };
}

describe('AuthService.login', () => {
  const user = async (over: object = {}) => ({ id: 'u1', email: 'a@b.c', passwordHash: await bcrypt.hash('correct-horse', 4), status: 'ACTIVE', failedLogins: 0, lockedUntil: null, ...over });

  it('issues tokens and resets the failure counter on success', async () => {
    const { service, db, raw } = setup();
    db.user.findFirst.mockResolvedValue(await user({ failedLogins: 3 }));
    const res = await service.login('A@B.C', 'correct-horse', { ip: '1.1.1.1' });
    expect(res.accessToken).toBe('signed.jwt');
    expect(res.refreshToken).toHaveLength(64);
    expect((res as any).tokenId).toBeUndefined();
    expect(raw.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failedLogins: 0, lockedUntil: null }) }));
    // the DB only ever receives the HASH of the refresh token
    expect(raw.refreshToken.create.mock.calls[0][0].data.tokenHash).toBe(sha(res.refreshToken));
  });

  it('gives the same error for unknown user and wrong password', async () => {
    const { service, db } = setup();
    db.user.findFirst.mockResolvedValueOnce(null);
    const a = await service.login('x@y.z', 'whatever123', {}).catch((e) => e);
    db.user.findFirst.mockResolvedValueOnce(await user());
    const b = await service.login('a@b.c', 'wrong-password', {}).catch((e) => e);
    expect(a).toBeInstanceOf(UnauthorizedException);
    expect(a.getResponse()).toEqual(b.getResponse());
  });

  it('locks the account on the 5th consecutive failure', async () => {
    const { service, db, raw } = setup();
    db.user.findFirst.mockResolvedValue(await user({ failedLogins: 4 }));
    await expect(service.login('a@b.c', 'nope-nope', {})).rejects.toBeInstanceOf(UnauthorizedException);
    const data = raw.user.update.mock.calls[0][0].data;
    expect(data.failedLogins).toBe(5);
    expect(data.lockedUntil).toBeInstanceOf(Date);
  });

  it('refuses a locked account even with the right password', async () => {
    const { service, db } = setup();
    db.user.findFirst.mockResolvedValue(await user({ lockedUntil: new Date(Date.now() + 60_000) }));
    await expect(service.login('a@b.c', 'correct-horse', {})).rejects.toMatchObject({ response: { code: 'ACCOUNT_LOCKED' } });
  });

  it('refuses suspended accounts without revealing why', async () => {
    const { service, db } = setup();
    db.user.findFirst.mockResolvedValue(await user({ status: 'SUSPENDED' }));
    await expect(service.login('a@b.c', 'correct-horse', {})).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });
  });
});

describe('AuthService.refresh', () => {
  const stored = (over: object = {}) => ({ id: 't1', userId: 'u1', familyId: 'fam', revokedAt: null, deletedAt: null, expiresAt: new Date(Date.now() + 3600_000), user: { email: 'a@b.c', status: 'ACTIVE', deletedAt: null }, ...over });

  it('rotates: revokes the old token and links it to its replacement', async () => {
    const { service, raw } = setup();
    raw.refreshToken.findUnique.mockResolvedValue(stored());
    const res = await service.refresh('old-token', {});
    expect(res.refreshToken).not.toBe('old-token');
    expect(raw.refreshToken.create.mock.calls[0][0].data.familyId).toBe('fam'); // same family
    expect(raw.refreshToken.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { revokedAt: expect.any(Date), replacedById: 'new-token-id' } });
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const { service, raw } = setup();
    raw.refreshToken.findUnique.mockResolvedValue(stored({ revokedAt: new Date() }));
    await expect(service.refresh('stolen', {})).rejects.toMatchObject({ response: { code: 'REFRESH_TOKEN_REUSED' } });
    expect(raw.refreshToken.updateMany).toHaveBeenCalledWith({ where: { familyId: 'fam', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(raw.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects unknown, expired and suspended-user tokens', async () => {
    const { service, raw } = setup();
    raw.refreshToken.findUnique.mockResolvedValueOnce(null);
    await expect(service.refresh('x', {})).rejects.toBeInstanceOf(UnauthorizedException);
    raw.refreshToken.findUnique.mockResolvedValueOnce(stored({ expiresAt: new Date(Date.now() - 1) }));
    await expect(service.refresh('x', {})).rejects.toBeInstanceOf(UnauthorizedException);
    raw.refreshToken.findUnique.mockResolvedValueOnce(stored({ user: { email: 'a', status: 'SUSPENDED', deletedAt: null } }));
    await expect(service.refresh('x', {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(raw.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('ttlToMs', () => {
  it.each([['15m', 900_000], ['7d', 604_800_000], ['2h', 7_200_000], ['30s', 30_000], ['60', 60_000]])('%s -> %i', (ttl, ms) => expect(ttlToMs(ttl)).toBe(ms));
  it('rejects garbage', () => expect(() => ttlToMs('soon')).toThrow());
});
