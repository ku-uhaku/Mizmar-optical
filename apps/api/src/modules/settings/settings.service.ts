import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertSettingDto } from './dto/setting.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  list(opts: { group?: string; storeId?: string | null }) {
    return this.prisma.db.setting.findMany({
      where: {
        ...(opts.group ? { group: opts.group } : {}),
        OR: [{ scope: 'GLOBAL' }, ...(opts.storeId ? [{ scope: 'STORE' as const, scopeId: opts.storeId }] : [])],
      },
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });
  }

  /** Settings flagged `isPublic` that the storefront may read without auth. */
  async publicSettings() {
    const rows = await this.prisma.db.setting.findMany({ where: { isPublic: true, scope: 'GLOBAL' } });
    return Object.fromEntries(rows.map((r) => [`${r.group}.${r.key}`, r.value]));
  }

  async upsertMany(items: UpsertSettingDto[]) {
    for (const i of items) if (i.scope === 'STORE' && !i.storeId) throw new BadRequestException('storeId is required for store-scoped settings');
    return this.prisma.raw.$transaction(
      items.map((i) => {
        const scope = i.scope ?? 'GLOBAL';
        const scopeId = scope === 'STORE' ? i.storeId! : 'global';
        return this.prisma.raw.setting.upsert({
          where: { scope_scopeId_key: { scope, scopeId, key: i.key } },
          create: { scope, scopeId, group: i.group, key: i.key, value: i.value as any, isPublic: i.isPublic ?? false },
          update: { group: i.group, value: i.value as any, deletedAt: null, ...(i.isPublic === undefined ? {} : { isPublic: i.isPublic }) },
        });
      }),
    );
  }
}
