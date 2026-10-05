import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, searchWhere } from '../../common/utils/paginate';
import { releaseUnique } from '../../common/utils/soft-delete';
import type { AuthUser } from '../../common/types';
import { CreateUserDto, ListUsersDto, UpdateUserDto } from './dto/user.dto';

/** Never select passwordHash. */
const select = {
  id: true, email: true, phone: true, firstName: true, lastName: true, avatarUrl: true, type: true, status: true,
  locale: true, isSuperAdmin: true, lastLoginAt: true, createdAt: true, updatedAt: true,
  roles: { where: { deletedAt: null }, select: { role: { select: { id: true, code: true, name: true } } } },
  stores: { where: { deletedAt: null }, select: { isDefault: true, store: { select: { id: true, code: true, name: true } } } },
} as const;

const shape = (u: any) => ({ ...u, roles: u.roles.map((r: any) => r.role), stores: u.stores.map((s: any) => ({ ...s.store, isDefault: s.isDefault })) });

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListUsersDto) {
    const where = {
      type: 'STAFF' as const,
      ...searchWhere(dto.search, ['email', 'firstName', 'lastName', 'phone']),
      ...(dto.status ? { status: dto.status as any } : {}),
      ...(dto.roleId ? { roles: { some: { roleId: dto.roleId, deletedAt: null } } } : {}),
      ...(dto.storeId ? { stores: { some: { storeId: dto.storeId, deletedAt: null } } } : {}),
    };
    const res = await paginate(this.prisma.db.user, dto, { where, select, sortable: ['email', 'firstName', 'lastName', 'lastLoginAt', 'createdAt'] });
    return { ...res, data: res.data.map(shape) };
  }

  async get(id: string) {
    const user = await this.prisma.db.user.findFirst({ where: { id }, select });
    if (!user) throw new NotFoundException('User not found');
    return shape(user);
  }

  async create(dto: CreateUserDto) {
    const email = dto.email.toLowerCase().trim();
    if (await this.prisma.db.user.findFirst({ where: { email } })) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email already in use' });
    const user = await this.prisma.raw.user.create({
      data: {
        email, passwordHash: await bcrypt.hash(dto.password, 12), firstName: dto.firstName, lastName: dto.lastName,
        phone: dto.phone, locale: dto.locale ?? 'fr', status: dto.status ?? 'ACTIVE',
        roles: { create: (dto.roleIds ?? []).map((roleId) => ({ roleId })) },
        stores: { create: (dto.storeIds ?? []).map((storeId, i) => ({ storeId, isDefault: i === 0 })) },
      },
    });
    return this.get(user.id);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser) {
    await this.get(id);
    if (id === actor.id && dto.status && dto.status !== 'ACTIVE') throw new BadRequestException('You cannot deactivate your own account');
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          email: dto.email?.toLowerCase().trim(), firstName: dto.firstName, lastName: dto.lastName, phone: dto.phone, locale: dto.locale, status: dto.status,
          ...(dto.password ? { passwordHash: await bcrypt.hash(dto.password, 12) } : {}),
        },
      });
      if (dto.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: dto.roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      if (dto.storeIds) {
        await tx.userStore.deleteMany({ where: { userId: id } });
        await tx.userStore.createMany({ data: dto.storeIds.map((storeId, i) => ({ userId: id, storeId, isDefault: i === 0 })) });
      }
      if (dto.status === 'SUSPENDED' || dto.password) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return this.get(id);
  }

  async remove(id: string, actor: AuthUser) {
    if (id === actor.id) throw new BadRequestException('You cannot delete your own account');
    const user = await this.prisma.db.user.findFirst({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isSuperAdmin && !actor.isSuperAdmin) throw new BadRequestException('Only a super admin can delete a super admin');
    await this.prisma.raw.$transaction([
      this.prisma.raw.user.update({ where: { id }, data: { deletedAt: new Date(), email: releaseUnique(user.email, id) } }),
      this.prisma.raw.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }
}
