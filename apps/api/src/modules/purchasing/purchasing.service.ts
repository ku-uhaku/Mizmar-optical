import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { priceOrder, roundMoney } from '@mizmar/shared';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import { StockService } from '../inventory/stock.service';
import * as D from './purchasing.dto';

const PO_INCLUDE = {
  supplier: { select: { id: true, code: true, name: true, paymentTermsDays: true } },
  warehouse: { select: { id: true, code: true, name: true, storeId: true } },
  lines: { where: { deletedAt: null }, orderBy: { id: 'asc' as const }, include: { variant: { select: { id: true, sku: true, color: true, size: true, product: { select: { name: true } } } } } },
  receipts: { where: { deletedAt: null }, select: { id: true, number: true, status: true, receivedAt: true, deliveryNoteRef: true }, orderBy: { receivedAt: 'asc' as const } },
} as const;

const label = (v: { product: { name: string }; color: string | null; size: string | null }) => [v.product.name, v.color, v.size].filter(Boolean).join(' — ');

@Injectable()
export class PurchasingService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly stock: StockService) {}

  // ------------------------------------------------------------------ shared
  private async warehouseFor(id: string, user: AuthUser) {
    const w = await this.prisma.db.warehouse.findFirst({ where: { id } });
    if (!w) throw new BadRequestException('Unknown warehouse');
    assertStoreAccess(user, w.storeId);
    return w;
  }
  private async supplier(id: string) {
    const s = await this.prisma.db.supplier.findFirst({ where: { id } });
    if (!s || !s.isActive) throw new BadRequestException({ code: 'UNKNOWN_SUPPLIER', message: 'Unknown or inactive supplier' });
    return s;
  }

  /** Server-side costing. Purchase prices are EXCLUDING tax; tax is added on top (default rate unless given per line). */
  private async cost(lines: D.PoLineDto[]) {
    const ids = [...new Set(lines.map((l) => l.variantId))];
    const variants = await this.prisma.db.productVariant.findMany({ where: { id: { in: ids } }, include: { product: { select: { name: true } } } });
    if (variants.length !== ids.length) throw new BadRequestException({ code: 'UNKNOWN_VARIANT', message: 'Some items are unknown' });
    const vmap = new Map(variants.map((v) => [v.id, v]));
    const def = await this.prisma.db.taxRate.findFirst({ where: { isDefault: true, isActive: true } });
    const rows = lines.map((l) => ({ ...l, taxRatePct: l.taxRatePct ?? (def ? Number(def.rate) : 0), variant: vmap.get(l.variantId)! }));
    const priced = priceOrder(rows.map((r) => ({ quantity: r.quantity, unitPrice: r.unitCost, taxRatePct: r.taxRatePct, taxInclusive: false })));
    return { rows, priced };
  }

  private poLineData(rows: Awaited<ReturnType<PurchasingService['cost']>>['rows'], priced: Awaited<ReturnType<PurchasingService['cost']>>['priced']) {
    return rows.map((r, i) => ({ variantId: r.variantId, description: label(r.variant), qtyOrdered: r.quantity, unitCost: r.unitCost, taxRatePct: r.taxRatePct, lineTotal: priced.lines[i].net }));
  }

  // ------------------------------------------------------------------ purchase orders
  async create(dto: D.CreatePurchaseOrderDto, user: AuthUser) {
    const wh = await this.warehouseFor(dto.warehouseId, user);
    await this.supplier(dto.supplierId);
    const { rows, priced } = await this.cost(dto.lines);
    const id = await this.prisma.raw.$transaction(async (tx) => {
      const number = await this.numbering.next(tx, wh.storeId, 'PURCHASE_ORDER');
      return (await tx.purchaseOrder.create({
        data: { storeId: wh.storeId, warehouseId: wh.id, supplierId: dto.supplierId, number, status: 'DRAFT', expectedAt: dto.expectedAt, notes: dto.notes, createdById: user.id, subtotal: priced.subtotal, taxTotal: priced.taxTotal, total: priced.total, lines: { create: this.poLineData(rows, priced) } },
      })).id;
    });
    return this.get(id, user);
  }

  async update(id: string, dto: D.UpdatePurchaseOrderDto, user: AuthUser) {
    const po = await this.mustGet(id, user);
    if (po.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only a DRAFT purchase order can be edited' });
    if (dto.supplierId) await this.supplier(dto.supplierId);
    const wh = dto.warehouseId ? await this.warehouseFor(dto.warehouseId, user) : null;
    if (wh && wh.storeId !== po.storeId) throw new BadRequestException('The warehouse must belong to the same store');
    const priced = dto.lines ? await this.cost(dto.lines) : null;
    await this.prisma.raw.$transaction(async (tx) => {
      if (priced) { await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } }); await tx.purchaseOrderLine.createMany({ data: this.poLineData(priced.rows, priced.priced).map((l) => ({ ...l, purchaseOrderId: id })) }); }
      await tx.purchaseOrder.update({ where: { id }, data: { supplierId: dto.supplierId, warehouseId: dto.warehouseId, expectedAt: dto.expectedAt, notes: dto.notes, ...(priced && { subtotal: priced.priced.subtotal, taxTotal: priced.priced.taxTotal, total: priced.priced.total }) } });
    });
    return this.get(id, user);
  }

  private async mustGet(id: string, user: AuthUser) {
    const po = await this.prisma.db.purchaseOrder.findFirst({ where: { id } });
    if (!po) throw new NotFoundException('Purchase order not found');
    assertStoreAccess(user, po.storeId);
    return po;
  }

  async get(id: string, user: AuthUser) {
    await this.mustGet(id, user);
    return this.prisma.db.purchaseOrder.findFirstOrThrow({ where: { id }, include: PO_INCLUDE });
  }

  async list(dto: D.ListPurchaseOrdersDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const s = dto.search?.trim();
    const where: Record<string, any> = {
      ...(stores && { storeId: { in: stores } }), ...(dto.status && { status: dto.status }), ...(dto.supplierId && { supplierId: dto.supplierId }),
      ...(dto.overdue && { status: { in: ['SENT', 'PARTIALLY_RECEIVED'] }, expectedAt: { lt: new Date(new Date().toDateString()) } }),
      ...(s && { OR: [{ number: { contains: s, mode: 'insensitive' } }, { supplier: { name: { contains: s, mode: 'insensitive' } } }] }),
    };
    return paginate(this.prisma.db.purchaseOrder, dto, { where, include: { supplier: { select: { id: true, name: true } }, warehouse: { select: { id: true, name: true } }, _count: { select: { lines: true } } }, sortable: ['createdAt', 'number', 'total', 'expectedAt'] });
  }

  async send(id: string, user: AuthUser) {
    const po = await this.mustGet(id, user);
    if (po.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_STATE', message: `Purchase order is ${po.status}` });
    await this.prisma.raw.purchaseOrder.update({ where: { id }, data: { status: 'SENT', orderedAt: new Date() } });
    return this.get(id, user);
  }

  async cancel(id: string, user: AuthUser) {
    const po = await this.mustGet(id, user);
    if (!['DRAFT', 'SENT'].includes(po.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `A ${po.status} purchase order cannot be cancelled` });
    if (await this.prisma.db.goodsReceipt.count({ where: { purchaseOrderId: id, status: 'POSTED' } })) throw new ConflictException({ code: 'HAS_RECEIPTS', message: 'Goods were already received against this order' });
    await this.prisma.raw.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    return this.get(id, user);
  }

  async remove(id: string, user: AuthUser) {
    const po = await this.mustGet(id, user);
    if (po.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only a DRAFT purchase order can be deleted' });
    await this.prisma.db.purchaseOrder.delete({ where: { id } });
  }

  // ------------------------------------------------------------------ goods receipts
  /** Weighted-average cost across ALL warehouses, updated BEFORE the new units are added to stock. */
  private async averageCost(tx: Tx, variantId: string, qty: number, unitCost: number) {
    const agg = await tx.stockLevel.aggregate({ where: { variantId, deletedAt: null }, _sum: { quantity: true } });
    const onHand = Math.max(0, agg._sum.quantity ?? 0);
    const v = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { cost: true } });
    const next = onHand === 0 || v.cost == null ? unitCost : (onHand * Number(v.cost) + qty * unitCost) / (onHand + qty);
    await tx.productVariant.update({ where: { id: variantId }, data: { cost: roundMoney(next) } });
  }

  private async post(tx: Tx, o: { storeId: string; warehouseId: string; supplierId: string; purchaseOrderId?: string; deliveryNoteRef?: string; note?: string; lines: { purchaseOrderLineId?: string; variantId: string; quantity: number; unitCost: number; lotNumber?: string; expiryDate?: Date }[] }, user: AuthUser) {
    const number = await this.numbering.next(tx, o.storeId, 'GOODS_RECEIPT');
    const receipt = await tx.goodsReceipt.create({
      data: {
        storeId: o.storeId, warehouseId: o.warehouseId, purchaseOrderId: o.purchaseOrderId, supplierId: o.supplierId, number, status: 'POSTED', deliveryNoteRef: o.deliveryNoteRef, note: o.note, receivedById: user.id,
        lines: { create: o.lines.map((l) => ({ purchaseOrderLineId: l.purchaseOrderLineId, variantId: l.variantId, quantity: l.quantity, unitCost: l.unitCost, lotNumber: l.lotNumber, expiryDate: l.expiryDate })) },
      },
    });
    for (const l of o.lines) {
      await this.averageCost(tx, l.variantId, l.quantity, l.unitCost);
      await this.stock.move(tx, { storeId: o.storeId, variantId: l.variantId, warehouseId: o.warehouseId, type: 'PURCHASE_RECEIPT', quantity: l.quantity, unitCost: l.unitCost, refType: 'GoodsReceipt', refId: receipt.id, lotNumber: l.lotNumber, expiryDate: l.expiryDate, note: number, actorId: user.id });
    }
    return receipt.id;
  }

  async receive(poId: string, dto: D.ReceiveDto, user: AuthUser) {
    const po0 = await this.mustGet(poId, user);
    const id = await this.prisma.raw.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${poId} FOR UPDATE`; // serialise concurrent receipts on one order
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: { where: { deletedAt: null } } } });
      if (!['SENT', 'PARTIALLY_RECEIVED'].includes(po.status)) throw new ConflictException({ code: 'INVALID_STATE', message: po.status === 'DRAFT' ? 'Send the purchase order before receiving goods' : `Purchase order is ${po.status}` });
      const byId = new Map(po.lines.map((l) => [l.id, l]));
      const seen = new Set<string>();
      const lines = dto.lines.map((r) => {
        const l = byId.get(r.purchaseOrderLineId);
        if (!l) throw new BadRequestException({ code: 'UNKNOWN_LINE', message: 'A line does not belong to this purchase order', details: { purchaseOrderLineId: r.purchaseOrderLineId } });
        if (seen.has(l.id)) throw new BadRequestException('A line can only appear once per receipt');
        seen.add(l.id);
        const outstanding = l.qtyOrdered - l.qtyReceived;
        if (r.quantity > outstanding) throw new BadRequestException({ code: 'OVER_RECEIPT', message: 'More than is outstanding on this line', details: { purchaseOrderLineId: l.id, outstanding } });
        return { purchaseOrderLineId: l.id, variantId: l.variantId!, quantity: r.quantity, unitCost: r.unitCost ?? Number(l.unitCost), lotNumber: r.lotNumber, expiryDate: r.expiryDate };
      });
      const receiptId = await this.post(tx, { storeId: po.storeId, warehouseId: po.warehouseId, supplierId: po.supplierId, purchaseOrderId: po.id, deliveryNoteRef: dto.deliveryNoteRef, note: dto.note, lines }, user);
      for (const l of lines) await tx.purchaseOrderLine.update({ where: { id: l.purchaseOrderLineId }, data: { qtyReceived: { increment: l.quantity } } });
      await this.recomputeStatus(tx, poId);
      return receiptId;
    });
    void po0;
    return this.getReceipt(id, user);
  }

  /** RECEIVED when every line is complete, PARTIALLY_RECEIVED while some goods are in, else back to SENT. */
  private async recomputeStatus(tx: Tx, poId: string) {
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: poId, deletedAt: null } });
    const any = lines.some((l) => l.qtyReceived > 0), all = lines.every((l) => l.qtyReceived >= l.qtyOrdered);
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status: all ? 'RECEIVED' : any ? 'PARTIALLY_RECEIVED' : 'SENT' } });
  }

  /** Goods that arrived without a purchase order (or before it was raised). */
  async directReceipt(dto: D.DirectReceiptDto, user: AuthUser) {
    const wh = await this.warehouseFor(dto.warehouseId, user);
    await this.supplier(dto.supplierId);
    const ids = [...new Set(dto.lines.map((l) => l.variantId))];
    if ((await this.prisma.db.productVariant.count({ where: { id: { in: ids } } })) !== ids.length) throw new BadRequestException({ code: 'UNKNOWN_VARIANT', message: 'Some items are unknown' });
    const id = await this.prisma.raw.$transaction((tx) => this.post(tx, { storeId: wh.storeId, warehouseId: wh.id, supplierId: dto.supplierId, deliveryNoteRef: dto.deliveryNoteRef, note: dto.note, lines: dto.lines }, user));
    return this.getReceipt(id, user);
  }

  /** Reverse a receipt. Refused if it was already invoiced, or if the goods have since been sold (stock would go negative). */
  async voidReceipt(id: string, user: AuthUser) {
    const r = await this.mustGetReceipt(id, user);
    if (r.status !== 'POSTED') throw new ConflictException({ code: 'INVALID_STATE', message: `Receipt is ${r.status}` });
    if (await this.prisma.db.supplierInvoiceLine.count({ where: { goodsReceiptId: id, invoice: { status: { not: 'VOID' }, deletedAt: null } } })) throw new ConflictException({ code: 'RECEIPT_INVOICED', message: 'This receipt is on a supplier invoice: void the invoice first' });
    await this.prisma.raw.$transaction(async (tx) => {
      if (r.purchaseOrderId) await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${r.purchaseOrderId} FOR UPDATE`;
      for (const l of r.lines) {
        await this.stock.move(tx, { storeId: r.storeId, variantId: l.variantId, warehouseId: r.warehouseId, type: 'SUPPLIER_RETURN', quantity: -l.quantity, refType: 'GoodsReceipt', refId: id, note: `${r.number} voided`, actorId: user.id });
        if (l.purchaseOrderLineId) await tx.purchaseOrderLine.update({ where: { id: l.purchaseOrderLineId }, data: { qtyReceived: { decrement: l.quantity } } });
      }
      await tx.goodsReceipt.update({ where: { id }, data: { status: 'VOID' } });
      if (r.purchaseOrderId) await this.recomputeStatus(tx, r.purchaseOrderId);
    });
    return this.getReceipt(id, user);
  }

  private async mustGetReceipt(id: string, user: AuthUser) {
    const r = await this.prisma.db.goodsReceipt.findFirst({ where: { id }, include: { lines: { where: { deletedAt: null } } } });
    if (!r) throw new NotFoundException('Receipt not found');
    assertStoreAccess(user, r.storeId);
    return r;
  }

  async getReceipt(id: string, user: AuthUser) {
    await this.mustGetReceipt(id, user);
    return this.prisma.db.goodsReceipt.findFirstOrThrow({
      where: { id },
      include: { supplier: { select: { id: true, name: true } }, warehouse: { select: { id: true, name: true } }, purchaseOrder: { select: { id: true, number: true } }, lines: { where: { deletedAt: null }, include: { variant: { select: { id: true, sku: true, color: true, size: true, product: { select: { name: true } } } } } } },
    });
  }

  async listReceipts(dto: D.ListReceiptsDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const s = dto.search?.trim();
    const where = { ...(stores && { storeId: { in: stores } }), ...(dto.supplierId && { supplierId: dto.supplierId }), ...(dto.purchaseOrderId && { purchaseOrderId: dto.purchaseOrderId }), ...(s && { OR: [{ number: { contains: s, mode: 'insensitive' as const } }, { deliveryNoteRef: { contains: s, mode: 'insensitive' as const } }] }) };
    return paginate(this.prisma.db.goodsReceipt, dto, { where, include: { supplier: { select: { id: true, name: true } }, purchaseOrder: { select: { id: true, number: true } }, _count: { select: { lines: true } } }, sortable: ['receivedAt', 'number'], defaultSort: 'receivedAt' });
  }

  /** Received-but-not-yet-invoiced lines of an order: what an accountant should invoice next. */
  async uninvoiced(poId: string, user: AuthUser) {
    await this.mustGet(poId, user);
    const lines = await this.prisma.db.goodsReceiptLine.findMany({ where: { receipt: { purchaseOrderId: poId, status: 'POSTED', deletedAt: null } }, include: { variant: { select: { sku: true, color: true, size: true, product: { select: { name: true } } } }, receipt: { select: { id: true, number: true } }, purchaseOrderLine: { select: { taxRatePct: true } } } });
    const inv = await this.prisma.db.supplierInvoiceLine.groupBy({ by: ['goodsReceiptLineId'], where: { goodsReceiptLineId: { in: lines.map((l) => l.id) }, invoice: { status: { not: 'VOID' }, deletedAt: null } }, _sum: { quantity: true } });
    const done = new Map(inv.map((i) => [i.goodsReceiptLineId, i._sum.quantity ?? 0]));
    return lines.map((l) => ({ goodsReceiptLineId: l.id, receipt: l.receipt, description: label(l.variant), quantity: l.quantity - (done.get(l.id) ?? 0), unitCost: Number(l.unitCost), taxRatePct: l.purchaseOrderLine?.taxRatePct == null ? null : Number(l.purchaseOrderLine.taxRatePct) })).filter((l) => l.quantity > 0);
  }
}
