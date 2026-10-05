import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, searchWhere } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import type { ListInvoicesDto } from './sales.dto';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  list(dto: ListInvoicesDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const s = dto.search?.trim();
    const where = {
      ...(stores && { storeId: { in: stores } }), ...(dto.status && { status: dto.status as any }), ...(dto.customerId && { customerId: dto.customerId }),
      ...((dto.from || dto.to) && { issuedAt: { ...(dto.from && { gte: dto.from }), ...(dto.to && { lte: dto.to }) } }),
      ...(s && { OR: [...searchWhere(s, ['number']).OR!, { order: { number: { contains: s, mode: 'insensitive' as const } } }, { customer: { OR: [{ firstName: { contains: s, mode: 'insensitive' as const } }, { lastName: { contains: s, mode: 'insensitive' as const } }] } }] }),
    };
    return paginate(this.prisma.db.invoice, dto, { where, include: { customer: { select: { id: true, firstName: true, lastName: true } }, order: { select: { id: true, number: true, balanceDue: true } } }, sortable: ['issuedAt', 'total', 'number'], defaultSort: 'issuedAt' });
  }

  async get(id: string, user: AuthUser) {
    const inv = await this.prisma.db.invoice.findFirst({ where: { id }, include: { customer: { select: { id: true, firstName: true, lastName: true, phone: true } }, order: { select: { id: true, number: true, balanceDue: true, status: true } }, lines: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }, creditNotes: { where: { deletedAt: null }, select: { id: true, number: true, total: true, issuedAt: true } } } });
    if (!inv) throw new NotFoundException('Invoice not found');
    assertStoreAccess(user, inv.storeId);
    return inv;
  }
}
