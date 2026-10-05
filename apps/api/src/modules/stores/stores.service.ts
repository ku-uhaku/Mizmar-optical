import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, searchWhere } from '../../common/utils/paginate';
import { releaseUnique } from '../../common/utils/soft-delete';
import type { AuthUser } from '../../common/types';
import { CreateStoreDto, ListStoresDto, UpdateStoreDto } from './dto/store.dto';

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  /** Staff only see their own stores; super admins see all. */
  list(dto: ListStoresDto, actor: AuthUser) {
    const where = { ...searchWhere(dto.search, ['name', 'code', 'city']), ...(actor.isSuperAdmin ? {} : { id: { in: actor.storeIds } }) };
    return paginate(this.prisma.db.store, dto, { where, sortable: ['name', 'code', 'city', 'createdAt'], defaultSort: 'name' });
  }

  async get(id: string) {
    const s = await this.prisma.db.store.findFirst({ where: { id } });
    if (!s) throw new NotFoundException('Store not found');
    return s;
  }

  async create(dto: CreateStoreDto) {
    if (await this.prisma.db.store.findFirst({ where: { OR: [{ code: dto.code }, { slug: dto.slug }] } }))
      throw new ConflictException('Store code or slug already exists');
    return this.prisma.raw.store.create({ data: dto as any });
  }

  async update(id: string, dto: UpdateStoreDto) {
    await this.get(id);
    return this.prisma.raw.store.update({ where: { id }, data: dto as any });
  }

  async remove(id: string) {
    const s = await this.get(id);
    await this.prisma.raw.store.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, code: releaseUnique(s.code, id), slug: releaseUnique(s.slug, id) } });
  }
}
