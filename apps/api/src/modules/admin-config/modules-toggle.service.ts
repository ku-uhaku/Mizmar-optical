import { ForbiddenException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Modules the dashboard may switch off. Everything else (users, stores, catalog, customers, settings…) is the platform itself. */
export const TOGGLEABLE = ['pos', 'inventory', 'purchasing', 'workshop', 'appointments', 'hr', 'finance', 'reports', 'blog', 'storefront'] as const;

/** Which switchable module a permission belongs to (a route needing `suppliers:read` is part of purchasing). */
export const PERMISSION_MODULE: Record<string, string> = { pos: 'pos', inventory: 'inventory', purchasing: 'purchasing', suppliers: 'purchasing', workshop: 'workshop', appointments: 'appointments', hr: 'hr', finance: 'finance', reports: 'reports' };

@Injectable()
export class ModuleToggleService {
  private cache: { at: number; off: Set<string> } | null = null;
  constructor(private readonly prisma: PrismaService) {}

  private async off() {
    if (this.cache && Date.now() - this.cache.at < 10_000) return this.cache.off;
    const rows = await this.prisma.raw.moduleToggle.findMany({ where: { isEnabled: false, deletedAt: null }, select: { moduleKey: true } });
    this.cache = { at: Date.now(), off: new Set(rows.map((r) => r.moduleKey)) };
    return this.cache.off;
  }
  async isEnabled(key: string) { return !(await this.off()).has(key); }
  invalidate() { this.cache = null; }

  async list() {
    const rows = await this.prisma.db.moduleToggle.findMany();
    const byKey = new Map(rows.map((r) => [r.moduleKey, r]));
    return TOGGLEABLE.map((key) => ({ moduleKey: key, isEnabled: byKey.get(key)?.isEnabled ?? true }));
  }

  async set(key: string, isEnabled: boolean) {
    if (!(TOGGLEABLE as readonly string[]).includes(key)) throw new NotFoundException({ code: 'UNKNOWN_MODULE', message: 'That module cannot be switched' });
    await this.prisma.raw.moduleToggle.upsert({ where: { moduleKey: key }, update: { isEnabled, deletedAt: null }, create: { moduleKey: key, isEnabled } });
    this.invalidate();
    return this.list();
  }

  async assertEnabled(key: string, signedIn: boolean) {
    if (await this.isEnabled(key)) return;
    if (!signedIn) throw new NotFoundException({ code: 'MODULE_DISABLED', message: 'Not available' });
    throw new ForbiddenException({ code: 'MODULE_DISABLED', message: `The ${key} module is switched off`, details: { module: key } });
  }
}

@Global()
@Module({ providers: [ModuleToggleService], exports: [ModuleToggleService] })
export class ModuleToggleModule {}
