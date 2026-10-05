import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../config/env';
import type { AuthUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import type { MailJob } from '../queue/processors';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_TTL_MINUTES = 60;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const newToken = () => randomBytes(48).toString('base64url');

/** Parse "15m" / "7d" / "3600" into milliseconds. */
export const ttlToMs = (ttl: string): number => {
  const m = /^(\d+)\s*([smhd]?)$/.exec(ttl.trim());
  if (!m) throw new Error(`Invalid TTL: ${ttl}`);
  const n = Number(m[1]);
  return n * ({ s: 1e3, m: 6e4, h: 36e5, d: 864e5, '': 1e3 }[m[2] as 's' | 'm' | 'h' | 'd' | ''] as number);
};

export interface ClientMeta { ip?: string; userAgent?: string }
export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number; tokenType: 'Bearer' }

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue('mail') private readonly mailQueue: Queue<MailJob>,
  ) {}

  // ---------- login ----------
  async login(email: string, password: string, meta: ClientMeta) {
    const user = await this.prisma.db.user.findFirst({ where: { email: email.toLowerCase().trim() } });
    // Same error for unknown email / wrong password / disabled so accounts can't be enumerated.
    const invalid = new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    if (!user) {
      await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi'); // equalise timing
      throw invalid;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException({ code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts. Try again later.' });
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      const failed = user.failedLogins + 1;
      await this.prisma.raw.user.update({
        where: { id: user.id },
        data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      await this.audit(user.id, 'LOGIN_FAILED', meta);
      throw invalid;
    }
    if (user.status !== 'ACTIVE') throw invalid;

    await this.prisma.raw.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await this.audit(user.id, 'LOGIN', meta);
    const { tokenId: _tokenId, ...tokens } = await this.issueTokens(user.id, user.email, meta);
    return { ...tokens, user: await this.loadAuthUser(user.id) };
  }

  // ---------- refresh (rotation + reuse detection) ----------
  async refresh(refreshToken: string, meta: ClientMeta) {
    const stored = await this.prisma.raw.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!stored) throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Invalid refresh token' });

    if (stored.revokedAt) {
      // A rotated/revoked token was presented again: assume theft, kill the whole family.
      await this.prisma.raw.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      this.logger.warn(`Refresh token reuse detected for user ${stored.userId}; family revoked`);
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_REUSED', message: 'Refresh token already used' });
    }
    if (stored.expiresAt < new Date() || stored.deletedAt || stored.user.deletedAt || stored.user.status !== 'ACTIVE') {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token expired' });
    }

    const { tokenId, ...next } = await this.issueTokens(stored.userId, stored.user.email, meta, stored.familyId);
    await this.prisma.raw.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date(), replacedById: tokenId } });
    return next;
  }

  async logout(refreshToken: string) {
    const stored = await this.prisma.raw.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (stored) {
      await this.prisma.raw.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
  }

  // ---------- password reset ----------
  async forgotPassword(email: string) {
    const user = await this.prisma.db.user.findFirst({ where: { email: email.toLowerCase().trim(), status: 'ACTIVE' } });
    if (!user) return; // never reveal whether the account exists
    const token = newToken();
    await this.prisma.raw.passwordReset.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000) },
    });
    // staff reset in the dashboard, storefront customers on the website (in their own language)
    const resetUrl = user.type === 'CUSTOMER' ? `${this.config.get('WEB_URL', { infer: true })}/${user.locale}/compte/reinitialiser?token=${token}` : `${this.config.get('ADMIN_URL', { infer: true })}/reset-password?token=${token}`;
    await this.mailQueue.add('password_reset', { to: user.email, template: 'password_reset', locale: user.locale, data: { firstName: user.firstName, resetUrl } });
  }

  async resetPassword(token: string, password: string) {
    const reset = await this.prisma.raw.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw new BadRequestException({ code: 'INVALID_RESET_TOKEN', message: 'Reset link is invalid or has expired' });
    }
    await this.prisma.raw.$transaction([
      this.prisma.raw.user.update({ where: { id: reset.userId }, data: { passwordHash: await bcrypt.hash(password, 12), failedLogins: 0, lockedUntil: null } }),
      this.prisma.raw.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      this.prisma.raw.refreshToken.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  // ---------- helpers ----------
  /** Tokens for a freshly created account (storefront registration). */
  async startSession(userId: string, meta: ClientMeta) {
    const user = await this.prisma.raw.user.findUniqueOrThrow({ where: { id: userId } });
    const { tokenId: _t, ...tokens } = await this.issueTokens(user.id, user.email, meta);
    return { ...tokens, user: await this.loadAuthUser(user.id) };
  }

  private async issueTokens(userId: string, email: string, meta: ClientMeta, familyId = newToken().slice(0, 24)): Promise<TokenPair & { tokenId: string }> {
    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const accessToken = await this.jwt.signAsync({ sub: userId, email }, { secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }), expiresIn: Math.floor(ttlToMs(accessTtl) / 1000) });
    const refreshToken = newToken();
    const record = await this.prisma.raw.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + ttlToMs(this.config.get('JWT_REFRESH_TTL', { infer: true }))),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255),
      },
    });
    return { accessToken, refreshToken, expiresIn: Math.floor(ttlToMs(accessTtl) / 1000), tokenType: 'Bearer', tokenId: record.id };
  }

  async loadAuthUser(id: string): Promise<AuthUser | null> {
    const user = await this.prisma.db.user.findFirst({
      where: { id, status: 'ACTIVE' },
      include: {
        roles: { where: { deletedAt: null, role: { deletedAt: null } }, include: { role: { include: { permissions: { where: { deletedAt: null }, include: { permission: true } } } } } },
        stores: { where: { deletedAt: null, store: { deletedAt: null, isActive: true } }, include: { store: { select: { id: true, code: true, name: true } } } },
      },
    });
    if (!user) return null;
    const permissions = new Set<string>();
    user.roles.forEach((ur) => ur.role.permissions.forEach((rp) => permissions.add(rp.permission.key)));
    const defaultStore = user.stores.find((s) => s.isDefault) ?? user.stores[0];
    const customer = user.type === 'CUSTOMER' ? await this.prisma.db.customer.findFirst({ where: { userId: user.id }, select: { id: true } }) : null;
    return {
      id: user.id,
      type: user.type,
      customerId: customer?.id ?? null,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      isSuperAdmin: user.isSuperAdmin,
      roles: user.roles.map((r) => r.role.code),
      permissions: [...permissions].sort(),
      storeIds: user.stores.map((s) => s.storeId),
      stores: user.stores.map((s) => s.store),
      defaultStoreId: defaultStore?.storeId ?? null,
    };
  }

  private audit(actorId: string, action: string, meta: ClientMeta) {
    return this.prisma.raw.auditLog.create({ data: { actorId, entity: 'auth', entityId: actorId, action, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 255) } }).catch(() => undefined);
  }
}
