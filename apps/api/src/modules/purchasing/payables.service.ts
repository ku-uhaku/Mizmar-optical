import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { fromCents, priceOrder, toCents } from '@mizmar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import * as D from './purchasing.dto';

const today = () => new Date(new Date().toDateString());
const INCLUDE = { supplier: { select: { id: true, code: true, name: true } }, purchaseOrder: { select: { id: true, number: true } }, lines: { where: { deletedAt: null }, orderBy: { id: 'asc' as const } } };

@Injectable()
export class PayablesService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService) {}

  // ------------------------------------------------------------------ invoices
  async create(dto: D.CreateSupplierInvoiceDto, user: AuthUser, activeStoreId?: string | null) {
    const supplier = await this.prisma.db.supplier.findFirst({ where: { id: dto.supplierId } });
    if (!supplier || !supplier.isActive) throw new BadRequestException({ code: 'UNKNOWN_SUPPLIER', message: 'Unknown or inactive supplier' });
    let storeId = activeStoreId ?? user.defaultStoreId;
    if (dto.purchaseOrderId) {
      const po = await this.prisma.db.purchaseOrder.findFirst({ where: { id: dto.purchaseOrderId } });
      if (!po) throw new BadRequestException('Unknown purchase order');
      if (po.supplierId !== dto.supplierId) throw new BadRequestException({ code: 'SUPPLIER_MISMATCH', message: 'The purchase order belongs to another supplier' });
      storeId = po.storeId;
    }
    if (!storeId) throw new BadRequestException({ code: 'NO_STORE', message: 'No active store' });
    assertStoreAccess(user, storeId);
    if (await this.prisma.raw.supplierInvoice.findFirst({ where: { supplierId: dto.supplierId, supplierRef: dto.supplierRef, deletedAt: null } })) throw new ConflictException({ code: 'DUPLICATE_INVOICE', message: 'This supplier invoice number is already recorded' });

    const def = await this.prisma.db.taxRate.findFirst({ where: { isDefault: true, isActive: true } });
    const rows = dto.lines.map((l) => ({ ...l, taxRatePct: l.taxRatePct ?? (def ? Number(def.rate) : 0) }));
    let priced: ReturnType<typeof priceOrder>;
    try { priced = priceOrder(rows.map((r) => ({ quantity: r.quantity, unitPrice: r.unitCost, taxRatePct: r.taxRatePct, taxInclusive: false }))); }
    catch (e) { if (e instanceof RangeError) throw new BadRequestException({ code: 'INVALID_PRICING', message: e.message }); throw e; }
    const dueAt = dto.dueAt ?? new Date(dto.issuedAt.getTime() + supplier.paymentTermsDays * 86_400_000);

    try {
      const id = await this.prisma.raw.$transaction(async (tx) => {
        // 3-way match: you can never be invoiced for more than was actually received (and not yet invoiced)
        const wanted = new Map<string, number>();
        for (const r of rows) if (r.goodsReceiptLineId) wanted.set(r.goodsReceiptLineId, (wanted.get(r.goodsReceiptLineId) ?? 0) + r.quantity);
        const lineRefs = new Map<string, { receiptId: string }>();
        for (const [lineId, qty] of wanted) {
          const grl = await tx.goodsReceiptLine.findFirst({ where: { id: lineId, deletedAt: null, receipt: { status: 'POSTED', supplierId: dto.supplierId, deletedAt: null } } });
          if (!grl) throw new BadRequestException({ code: 'UNKNOWN_RECEIPT_LINE', message: 'A matched receipt line is unknown, voided, or from another supplier', details: { goodsReceiptLineId: lineId } });
          const done = await tx.supplierInvoiceLine.aggregate({ where: { goodsReceiptLineId: lineId, invoice: { status: { not: 'VOID' }, deletedAt: null }, deletedAt: null }, _sum: { quantity: true } });
          const left = grl.quantity - (done._sum.quantity ?? 0);
          if (qty > left) throw new ConflictException({ code: 'INVOICE_EXCEEDS_RECEIPT', message: 'Invoiced quantity exceeds what was received', details: { goodsReceiptLineId: lineId, remaining: left } });
          lineRefs.set(lineId, { receiptId: grl.receiptId });
        }
        const number = await this.numbering.next(tx, storeId!, 'SUPPLIER_INVOICE');
        return (await tx.supplierInvoice.create({
          data: {
            storeId: storeId!, supplierId: dto.supplierId, purchaseOrderId: dto.purchaseOrderId, number, supplierRef: dto.supplierRef, status: 'UNPAID', issuedAt: dto.issuedAt, dueAt, attachmentUrl: dto.attachmentUrl, notes: dto.notes,
            subtotal: priced.subtotal, taxTotal: priced.taxTotal, total: priced.total,
            lines: { create: rows.map((r, i) => ({ description: r.description, quantity: r.quantity, unitCost: r.unitCost, taxRatePct: r.taxRatePct, lineTotal: priced.lines[i].net, goodsReceiptLineId: r.goodsReceiptLineId, goodsReceiptId: r.goodsReceiptLineId ? lineRefs.get(r.goodsReceiptLineId)!.receiptId : undefined })) },
          },
        })).id;
      });
      return this.get(id, user);
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') throw new ConflictException({ code: 'DUPLICATE_INVOICE', message: 'This supplier invoice number is already recorded' });
      throw e;
    }
  }

  private async mustGet(id: string, user: AuthUser) {
    const inv = await this.prisma.db.supplierInvoice.findFirst({ where: { id } });
    if (!inv) throw new NotFoundException('Supplier invoice not found');
    assertStoreAccess(user, inv.storeId);
    return inv;
  }

  async get(id: string, user: AuthUser) {
    await this.mustGet(id, user);
    const inv = await this.prisma.db.supplierInvoice.findFirstOrThrow({ where: { id }, include: INCLUDE });
    const payments = await this.prisma.db.supplierPayment.findMany({ where: { invoiceId: id }, orderBy: { paidAt: 'asc' } });
    return { ...inv, balance: fromCents(toCents(Number(inv.total)) - toCents(Number(inv.paidTotal))), payments, isOverdue: this.overdue(inv) };
  }

  private overdue(inv: { status: string; dueAt: Date | null }) {
    return !!inv.dueAt && inv.dueAt < today() && !['PAID', 'VOID'].includes(inv.status);
  }

  async list(dto: D.ListSupplierInvoicesDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const s = dto.search?.trim();
    const where: Record<string, any> = {
      ...(stores && { storeId: { in: stores } }), ...(dto.status && { status: dto.status }), ...(dto.supplierId && { supplierId: dto.supplierId }),
      ...(dto.overdue && { dueAt: { lt: today() }, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } }),
      ...(s && { OR: [{ number: { contains: s, mode: 'insensitive' } }, { supplierRef: { contains: s, mode: 'insensitive' } }, { supplier: { name: { contains: s, mode: 'insensitive' } } }] }),
    };
    const res = await paginate(this.prisma.db.supplierInvoice, dto, { where, include: { supplier: { select: { id: true, name: true } } }, sortable: ['issuedAt', 'dueAt', 'total', 'number'], defaultSort: 'issuedAt' });
    return { ...res, data: res.data.map((i: any) => ({ ...i, balance: fromCents(toCents(Number(i.total)) - toCents(Number(i.paidTotal))), isOverdue: this.overdue(i) })) };
  }

  // ------------------------------------------------------------------ payments
  async pay(id: string, dto: D.SupplierPaymentDto, user: AuthUser) {
    const inv0 = await this.mustGet(id, user);
    const method = await this.prisma.db.paymentMethodConfig.findFirst({ where: { id: dto.methodId, isActive: true } });
    if (!method) throw new BadRequestException({ code: 'INVALID_PAYMENT_METHOD', message: 'Unknown or inactive payment method' });
    if (dto.bankAccountId && !(await this.prisma.db.bankAccount.findFirst({ where: { id: dto.bankAccountId } }))) throw new BadRequestException('Unknown bank account');
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SupplierInvoice" WHERE id = ${id} FOR UPDATE`; // two accountants must not both pay the last dirham
      const inv = await tx.supplierInvoice.findUniqueOrThrow({ where: { id } });
      if (['VOID', 'PAID'].includes(inv.status)) throw new ConflictException({ code: 'NOTHING_DUE', message: `Invoice is ${inv.status}` });
      const balance = toCents(Number(inv.total)) - toCents(Number(inv.paidTotal));
      if (toCents(dto.amount) > balance) throw new BadRequestException({ code: 'OVERPAYMENT', message: 'Amount exceeds the balance due', details: { due: fromCents(balance) } });
      await tx.supplierPayment.create({ data: { storeId: inv.storeId, supplierId: inv.supplierId, invoiceId: id, methodId: dto.methodId, bankAccountId: dto.bankAccountId, amount: dto.amount, status: 'CAPTURED', reference: dto.reference, paidAt: dto.paidAt ?? new Date(), note: dto.note, createdById: user.id } });
      const paid = toCents(Number(inv.paidTotal)) + toCents(dto.amount);
      await tx.supplierInvoice.update({ where: { id }, data: { paidTotal: fromCents(paid), status: paid >= toCents(Number(inv.total)) ? 'PAID' : 'PARTIALLY_PAID' } });
    });
    void inv0;
    return this.get(id, user);
  }

  async void(id: string, user: AuthUser) {
    const inv = await this.mustGet(id, user);
    if (inv.status === 'VOID') throw new ConflictException({ code: 'INVALID_STATE', message: 'Invoice is already void' });
    if (Number(inv.paidTotal) > 0) throw new ConflictException({ code: 'HAS_PAYMENTS', message: 'Payments were recorded against this invoice' });
    await this.prisma.raw.supplierInvoice.update({ where: { id }, data: { status: 'VOID' } });
    return this.get(id, user);
  }

  // ------------------------------------------------------------------ views
  async statement(supplierId: string, user: AuthUser) {
    const supplier = await this.prisma.db.supplier.findFirst({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    const stores = visibleStoreIds(user);
    const scope = stores ? { storeId: { in: stores } } : {};
    const [invoices, payments] = await Promise.all([
      this.prisma.db.supplierInvoice.findMany({ where: { supplierId, status: { not: 'VOID' }, ...scope }, orderBy: { issuedAt: 'desc' }, take: 100 }),
      this.prisma.db.supplierPayment.findMany({ where: { supplierId, ...scope }, orderBy: { paidAt: 'desc' }, take: 100 }),
    ]);
    const sum = (xs: { v: unknown }[]) => xs.reduce((n, x) => n + toCents(Number(x.v)), 0);
    const invoiced = sum(invoices.map((i) => ({ v: i.total }))), paid = sum(invoices.map((i) => ({ v: i.paidTotal })));
    const overdue = invoices.filter((i) => this.overdue(i)).reduce((n, i) => n + toCents(Number(i.total)) - toCents(Number(i.paidTotal)), 0);
    return {
      supplier: { id: supplier.id, code: supplier.code, name: supplier.name, paymentTermsDays: supplier.paymentTermsDays },
      totals: { invoiced: fromCents(invoiced), paid: fromCents(paid), balance: fromCents(invoiced - paid), overdue: fromCents(overdue) },
      invoices: invoices.map((i) => ({ id: i.id, number: i.number, supplierRef: i.supplierRef, issuedAt: i.issuedAt, dueAt: i.dueAt, total: Number(i.total), paidTotal: Number(i.paidTotal), status: i.status, isOverdue: this.overdue(i) })),
      payments: payments.map((p) => ({ id: p.id, invoiceId: p.invoiceId, amount: Number(p.amount), paidAt: p.paidAt, reference: p.reference })),
    };
  }

  /** Headline numbers for the purchasing dashboard. */
  async summary(user: AuthUser, storeId?: string) {
    const stores = storeId ? (assertStoreAccess(user, storeId), [storeId]) : visibleStoreIds(user);
    const scope = stores ? { storeId: { in: stores } } : {};
    const [open, late, invoices] = await Promise.all([
      this.prisma.db.purchaseOrder.count({ where: { ...scope, status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } } }),
      this.prisma.db.purchaseOrder.count({ where: { ...scope, status: { in: ['SENT', 'PARTIALLY_RECEIVED'] }, expectedAt: { lt: today() } } }),
      this.prisma.db.supplierInvoice.findMany({ where: { ...scope, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } }, select: { total: true, paidTotal: true, dueAt: true, status: true } }),
    ]);
    const bal = (i: { total: unknown; paidTotal: unknown }) => toCents(Number(i.total)) - toCents(Number(i.paidTotal));
    return {
      openOrders: open, lateOrders: late, unpaidInvoices: invoices.length,
      payable: fromCents(invoices.reduce((n, i) => n + bal(i), 0)),
      overdue: fromCents(invoices.filter((i) => this.overdue(i)).reduce((n, i) => n + bal(i), 0)),
      overdueInvoices: invoices.filter((i) => this.overdue(i)).length,
    };
  }
}
