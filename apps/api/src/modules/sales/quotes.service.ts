import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, searchWhere } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import { CartPricingService } from './cart-pricing.service';
import type { CreateQuoteDto, ListQuotesDto, SaleLineDto, UpdateQuoteDto } from './sales.dto';

const INCLUDE = { customer: { select: { id: true, code: true, firstName: true, lastName: true, phone: true } }, lines: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' as const } } };

@Injectable()
export class QuotesService {
  constructor(private readonly prisma: PrismaService, private readonly pricing: CartPricingService, private readonly numbering: NumberingService) {}

  private store(user: AuthUser, active?: string | null) {
    const id = active ?? user.defaultStoreId;
    if (!id) throw new BadRequestException({ code: 'NO_STORE', message: 'No active store' });
    assertStoreAccess(user, id);
    return id;
  }

  /** SENT / DRAFT quotes past their date become EXPIRED (lazily, whenever quotes are read). */
  private expireStale() {
    return this.prisma.raw.quote.updateMany({ where: { status: { in: ['DRAFT', 'SENT'] }, validUntil: { lt: new Date(new Date().toDateString()) }, deletedAt: null }, data: { status: 'EXPIRED' } });
  }

  private async lineRows(lines: SaleLineDto[], ctx: Parameters<CartPricingService['price']>[1]) {
    const cart = await this.pricing.price(lines, ctx);
    return { cart, rows: cart.lines.map((l, i) => ({ variantId: l.variantId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRatePct: l.taxRatePct, taxAmount: l.taxAmount, lineTotal: l.lineTotal, sortOrder: i, lensConfig: l.lens ? ({ input: lines[i].lens, resolved: l.lens } as any) : undefined })) };
  }

  async create(dto: CreateQuoteDto, user: AuthUser, activeStoreId?: string | null) {
    const storeId = this.store(user, activeStoreId);
    const { cart, rows } = await this.lineRows(dto.lines, { user, storeId, customerId: dto.customerId });
    const id = await this.prisma.raw.$transaction(async (tx) => {
      const number = await this.numbering.next(tx, storeId, 'QUOTE');
      return (await tx.quote.create({ data: { storeId, number, customerId: dto.customerId, status: 'DRAFT', validUntil: dto.validUntil, subtotal: cart.subtotal, discountTotal: cart.discountTotal, taxTotal: cart.taxTotal, total: cart.total, notes: dto.notes, createdById: user.id, lines: { create: rows } } })).id;
    });
    return this.get(id, user);
  }

  async update(id: string, dto: UpdateQuoteDto, user: AuthUser) {
    const q = await this.mustGet(id, user);
    if (q.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only a DRAFT quote can be edited' });
    const lines = dto.lines;
    const priced = lines ? await this.lineRows(lines, { user, storeId: q.storeId, customerId: dto.customerId ?? q.customerId }) : null;
    await this.prisma.raw.$transaction(async (tx) => {
      if (priced) { await tx.quoteLine.deleteMany({ where: { quoteId: id } }); await tx.quoteLine.createMany({ data: priced.rows.map((r) => ({ ...r, quoteId: id })) }); }
      await tx.quote.update({ where: { id }, data: { customerId: dto.customerId, validUntil: dto.validUntil, notes: dto.notes, ...(priced && { subtotal: priced.cart.subtotal, discountTotal: priced.cart.discountTotal, taxTotal: priced.cart.taxTotal, total: priced.cart.total }) } });
    });
    return this.get(id, user);
  }

  private async mustGet(id: string, user: AuthUser) {
    await this.expireStale();
    const q = await this.prisma.db.quote.findFirst({ where: { id } });
    if (!q) throw new NotFoundException('Quote not found');
    assertStoreAccess(user, q.storeId);
    return q;
  }

  async get(id: string, user: AuthUser) {
    await this.mustGet(id, user);
    return this.prisma.db.quote.findFirstOrThrow({ where: { id }, include: INCLUDE });
  }

  async list(dto: ListQuotesDto, user: AuthUser) {
    await this.expireStale();
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const where = { ...(stores && { storeId: { in: stores } }), ...(dto.status && { status: dto.status as any }), ...(dto.customerId && { customerId: dto.customerId }), ...(dto.search?.trim() && { OR: [...searchWhere(dto.search, ['number', 'notes']).OR!, { customer: { OR: [{ firstName: { contains: dto.search.trim(), mode: 'insensitive' as const } }, { lastName: { contains: dto.search.trim(), mode: 'insensitive' as const } }] } }] }) };
    return paginate(this.prisma.db.quote, dto, { where, include: { customer: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { lines: true } } }, sortable: ['createdAt', 'total', 'number', 'validUntil'] });
  }

  /** draft -> sent -> accepted | rejected. Conversion to an order happens at checkout (quoteId), not here. */
  async transition(id: string, to: 'SENT' | 'ACCEPTED' | 'REJECTED', user: AuthUser) {
    const q = await this.mustGet(id, user);
    const allowed: Record<string, string[]> = { SENT: ['DRAFT'], ACCEPTED: ['DRAFT', 'SENT'], REJECTED: ['DRAFT', 'SENT'] };
    if (!allowed[to].includes(q.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `Cannot move a ${q.status} quote to ${to}` });
    await this.prisma.raw.quote.update({ where: { id }, data: { status: to } });
    return this.get(id, user);
  }

  async remove(id: string, user: AuthUser) {
    const q = await this.mustGet(id, user);
    if (q.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only a DRAFT quote can be deleted' });
    await this.prisma.db.quote.delete({ where: { id } });
  }

  /** The quote as a POS cart, ready to load into the till (prices are re-read from the catalog at checkout). */
  async cart(id: string, user: AuthUser) {
    const q = await this.get(id, user);
    return {
      quoteId: q.id, number: q.number, customerId: q.customerId, status: q.status,
      lines: q.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, ...(Number(l.discount) > 0 && { discount: { type: 'AMOUNT', value: Number(l.discount) } }), ...((l.lensConfig as any)?.input && { lens: (l.lensConfig as any).input }) })),
    };
  }
}
