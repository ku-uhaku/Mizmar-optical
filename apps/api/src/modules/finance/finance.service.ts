import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { fromCents, toCents } from '@mizmar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, searchWhere } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import * as D from './finance.dto';

const day = (s: string) => new Date(`${s}T00:00:00Z`);

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService) {}

  private stores(user: AuthUser, storeId?: string) {
    return storeId ? (assertStoreAccess(user, storeId), [storeId]) : visibleStoreIds(user);
  }

  // ------------------------------------------------------------------ expenses
  private async mustGet(id: string, user: AuthUser) {
    const e = await this.prisma.db.expense.findFirst({ where: { id } });
    if (!e) throw new NotFoundException('Expense not found');
    assertStoreAccess(user, e.storeId);
    return e;
  }

  async list(dto: D.ListExpensesDto, user: AuthUser) {
    const stores = this.stores(user, dto.storeId);
    const where = { ...(stores && { storeId: { in: stores } }), ...(dto.categoryId && { categoryId: dto.categoryId }), ...(dto.status && { status: dto.status }), ...((dto.from || dto.to) && { incurredAt: { ...(dto.from && { gte: day(dto.from) }), ...(dto.to && { lte: day(dto.to) }) } }), ...searchWhere(dto.search, ['number', 'description']) } as Record<string, any>;
    return paginate(this.prisma.db.expense, dto, { where, include: { category: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } }, sortable: ['incurredAt', 'amount', 'number', 'createdAt'], defaultSort: 'incurredAt' });
  }

  get(id: string, user: AuthUser) { return this.mustGet(id, user).then(() => this.prisma.db.expense.findFirstOrThrow({ where: { id }, include: { category: true, supplier: { select: { id: true, name: true } }, bankAccount: { select: { id: true, name: true } } } })); }

  async create(dto: D.CreateExpenseDto, user: AuthUser, activeStore?: string | null) {
    const storeId = dto.storeId ?? activeStore ?? user.defaultStoreId;
    if (!storeId) throw new BadRequestException({ code: 'NO_STORE', message: 'No active store' });
    assertStoreAccess(user, storeId);
    if (!(await this.prisma.db.expenseCategory.findFirst({ where: { id: dto.categoryId, isActive: true } }))) throw new BadRequestException({ code: 'UNKNOWN_CATEGORY', message: 'Unknown expense category' });
    if ((dto.taxAmount ?? 0) > dto.amount) throw new BadRequestException({ code: 'INVALID_TAX', message: 'VAT cannot exceed the total' });
    if (dto.supplierId && !(await this.prisma.db.supplier.findFirst({ where: { id: dto.supplierId } }))) throw new BadRequestException('Unknown supplier');
    const id = await this.prisma.raw.$transaction(async (tx) => {
      const number = await this.numbering.next(tx, storeId, 'EXPENSE');
      return (await tx.expense.create({ data: { storeId, categoryId: dto.categoryId, supplierId: dto.supplierId, number, description: dto.description, amount: dto.amount, taxAmount: dto.taxAmount ?? 0, status: 'DRAFT', incurredAt: dto.incurredAt, attachmentUrl: dto.attachmentUrl, createdById: user.id } })).id;
    });
    return this.get(id, user);
  }

  async update(id: string, dto: D.UpdateExpenseDto, user: AuthUser) {
    const e = await this.mustGet(id, user);
    if (e.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only a draft expense can be edited' });
    const amount = dto.amount ?? Number(e.amount);
    if ((dto.taxAmount ?? Number(e.taxAmount)) > amount) throw new BadRequestException({ code: 'INVALID_TAX', message: 'VAT cannot exceed the total' });
    const { storeId: _s, ...data } = dto;
    await this.prisma.raw.expense.update({ where: { id }, data });
    return this.get(id, user);
  }

  async remove(id: string, user: AuthUser) {
    const e = await this.mustGet(id, user);
    if (e.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only a draft expense can be deleted' });
    await this.prisma.raw.expense.update({ where: { id }, data: { deletedAt: new Date(), number: `${e.number}#del-${id.slice(-6)}` } });
  }

  async decide(id: string, approve: boolean, user: AuthUser) {
    const e = await this.mustGet(id, user);
    if (e.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_STATE', message: `The expense is ${e.status}` });
    await this.prisma.raw.expense.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: user.id } });
    return this.get(id, user);
  }

  /** Marks an approved expense paid and records the money leaving (one cash-flow entry, so reports and balances see it once). */
  async pay(id: string, dto: D.PayExpenseDto, user: AuthUser) {
    const e = await this.mustGet(id, user);
    if (e.status !== 'APPROVED') throw new ConflictException({ code: 'INVALID_STATE', message: 'Approve the expense before paying it' });
    if (dto.bankAccountId && !(await this.prisma.db.bankAccount.findFirst({ where: { id: dto.bankAccountId, isActive: true } }))) throw new BadRequestException({ code: 'UNKNOWN_ACCOUNT', message: 'Unknown account' });
    const paidAt = dto.paidAt ?? new Date();
    await this.prisma.raw.$transaction(async (tx) => {
      const claimed = await tx.expense.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'PAID', paidAt, bankAccountId: dto.bankAccountId, methodId: dto.methodId } });
      if (!claimed.count) throw new ConflictException({ code: 'INVALID_STATE', message: 'Already paid' }); // two accountants clicked at once
      await tx.cashFlowEntry.create({ data: { storeId: e.storeId, bankAccountId: dto.bankAccountId, direction: 'OUT', amount: e.amount, source: 'EXPENSE', refType: 'Expense', refId: id, description: `${e.number} — ${e.description}`, occurredAt: paidAt } });
    });
    return this.get(id, user);
  }

  async expenseSummary(dto: D.RangeDto, user: AuthUser) {
    const stores = this.stores(user, dto.storeId);
    const rows = await this.prisma.db.expense.groupBy({ by: ['categoryId', 'status'], where: { ...(stores && { storeId: { in: stores } }), status: { in: ['APPROVED', 'PAID'] }, incurredAt: { gte: day(dto.from), lte: day(dto.to) } }, _sum: { amount: true, taxAmount: true }, _count: { _all: true } });
    const cats = new Map((await this.prisma.db.expenseCategory.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const byCat = new Map<string, { categoryId: string; name: string; count: number; amount: number; tax: number }>();
    for (const r of rows) {
      const x = byCat.get(r.categoryId) ?? { categoryId: r.categoryId, name: cats.get(r.categoryId) ?? '—', count: 0, amount: 0, tax: 0 };
      x.count += r._count._all; x.amount += toCents(Number(r._sum.amount ?? 0)); x.tax += toCents(Number(r._sum.taxAmount ?? 0));
      byCat.set(r.categoryId, x);
    }
    const out = [...byCat.values()].map((x) => ({ ...x, amount: fromCents(x.amount), tax: fromCents(x.tax) })).sort((a, b) => b.amount - a.amount);
    return { categories: out, total: fromCents(out.reduce((n, x) => n + toCents(x.amount), 0)) };
  }

  // ------------------------------------------------------------------ manual cash movements (owner injection, bank deposit…)
  async addCash(dto: D.ManualCashDto, user: AuthUser, activeStore?: string | null) {
    const storeId = dto.storeId ?? activeStore ?? user.defaultStoreId;
    if (!storeId) throw new BadRequestException({ code: 'NO_STORE', message: 'No active store' });
    assertStoreAccess(user, storeId);
    if (dto.bankAccountId && !(await this.prisma.db.bankAccount.findFirst({ where: { id: dto.bankAccountId, isActive: true } }))) throw new BadRequestException({ code: 'UNKNOWN_ACCOUNT', message: 'Unknown account' });
    return this.prisma.raw.cashFlowEntry.create({ data: { storeId, bankAccountId: dto.bankAccountId, direction: dto.direction, amount: dto.amount, source: 'MANUAL', description: dto.description, occurredAt: dto.occurredAt ?? new Date() } });
  }

  async removeCash(id: string, user: AuthUser) {
    const c = await this.prisma.db.cashFlowEntry.findFirst({ where: { id } });
    if (!c) throw new NotFoundException('Entry not found');
    assertStoreAccess(user, c.storeId);
    if (c.source !== 'MANUAL') throw new ConflictException({ code: 'NOT_MANUAL', message: 'Only manual entries can be deleted: the others are produced by expenses and payroll' });
    await this.prisma.raw.cashFlowEntry.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Balance of each account: opening balance + entries assigned to it + supplier payments paid from it. */
  async accountBalances(user: AuthUser) {
    const stores = visibleStoreIds(user);
    const accounts = await this.prisma.db.bankAccount.findMany({ where: { isActive: true, ...(stores && { OR: [{ storeId: { in: stores } }, { storeId: null }] }) }, orderBy: { name: 'asc' } });
    const ids = accounts.map((a) => a.id);
    const [flows, supplier] = await Promise.all([
      this.prisma.db.cashFlowEntry.groupBy({ by: ['bankAccountId', 'direction'], where: { bankAccountId: { in: ids } }, _sum: { amount: true } }),
      this.prisma.db.supplierPayment.groupBy({ by: ['bankAccountId'], where: { bankAccountId: { in: ids }, status: 'CAPTURED' }, _sum: { amount: true } }),
    ]);
    return accounts.map((a) => {
      const sum = (dir: string) => toCents(Number(flows.find((f) => f.bankAccountId === a.id && f.direction === dir)?._sum.amount ?? 0));
      const paidSuppliers = toCents(Number(supplier.find((s) => s.bankAccountId === a.id)?._sum.amount ?? 0));
      return { id: a.id, name: a.name, bankName: a.bankName, isCashAccount: a.isCashAccount, currency: a.currency, openingBalance: Number(a.openingBalance), balance: fromCents(toCents(Number(a.openingBalance)) + sum('IN') - sum('OUT') - paidSuppliers) };
    });
  }
}
