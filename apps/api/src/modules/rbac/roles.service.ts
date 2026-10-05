import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSION_CATALOG } from '@mizmar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { paginate, searchWhere } from '../../common/utils/paginate';
import { releaseUnique } from '../../common/utils/soft-delete';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

const include = { permissions: { where: { deletedAt: null }, include: { permission: { select: { key: true } } } }, _count: { select: { users: true } } };
const shape = (r: any) => ({ ...r, permissions: undefined, permissionKeys: r.permissions.map((p: any) => p.permission.key).sort() });

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  catalog() {
    return Object.entries(PERMISSION_CATALOG).map(([module, actions]) => ({ module, actions, keys: actions.map((a) => `${module}:${a}`) }));
  }

  async list(dto: PaginationDto) {
    const res = await paginate(this.prisma.db.role, dto, { where: searchWhere(dto.search, ['name', 'code']), include, sortable: ['name', 'code', 'createdAt'], defaultSort: 'name' });
    return { ...res, data: res.data.map(shape) };
  }

  async get(id: string) {
    const role = await this.prisma.db.role.findFirst({ where: { id }, include });
    if (!role) throw new NotFoundException('Role not found');
    return shape(role);
  }

  async create(dto: CreateRoleDto) {
    if (await this.prisma.db.role.findFirst({ where: { code: dto.code } })) throw new ConflictException('Role code already exists');
    const perms = await this.prisma.db.permission.findMany({ where: { key: { in: dto.permissionKeys } } });
    const role = await this.prisma.raw.role.create({
      data: { code: dto.code, name: dto.name, description: dto.description, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
    });
    return this.get(role.id);
  }

  async update(id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.db.role.findFirst({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem && dto.code && dto.code !== role.code) throw new BadRequestException('System role codes cannot be changed');
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: { code: dto.code, name: dto.name, description: dto.description } });
      if (dto.permissionKeys) {
        const perms = await tx.permission.findMany({ where: { key: { in: dto.permissionKeys }, deletedAt: null } });
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) });
      }
    });
    return this.get(id);
  }

  async remove(id: string) {
    const role = await this.prisma.db.role.findFirst({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new BadRequestException('System roles cannot be deleted');
    if (role._count.users > 0) throw new ConflictException('Role is still assigned to users');
    await this.prisma.db.role.delete({ where: { id } });
    await this.prisma.raw.role.update({ where: { id }, data: { code: releaseUnique(role.code, id) } });
  }
}
