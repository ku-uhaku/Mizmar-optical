import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, searchWhere } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import { StockService } from './stock.service';
import * as D from './inventory.dto';

const VARIANT_INFO = { select: { id: true, sku: true, barcode: true, color: true, size: true, price: true, cost: true, product: { select: { id: true, name: true, type: true, brand: { select: { name: true } } } } } };
const WAREHOUSE_INFO = { select: { id: true, code: true, name: true, storeId: true } };

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService, private readonly stock: StockService, private readonly numbering: NumberingService) {}

  // ------------------------------------------------------------------ scoping helpers
  /** Stores the request may read: an explicit (authorised) store, else everything the user can see. */
  private scope(user: AuthUser, storeId?: string): string[] | undefined {
    if (storeId) { assertStoreAccess(user, storeId); return [storeId]; }
    return visibleStoreIds(user);
  }
  private async warehouseFor(id: string, user: AuthUser) {
    const w = await this.prisma.db.warehouse.findFirst({ where: { id } });
    if (!w) throw new BadRequestException('Unknown warehouse');
    assertStoreAccess(user, w.storeId);
    return w;
  }
  private async assertVariants(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) throw new BadRequestException('A variant can only appear once per document');
    if ((await this.prisma.db.productVariant.count({ where: { id: { in: unique } } })) !== unique.length) throw new BadRequestException('Unknown variant');
  }

  // ------------------------------------------------------------------ warehouses
  listWarehouses(user: AuthUser) {
    const stores = visibleStoreIds(user);
    return this.prisma.db.warehouse.findMany({ where: stores ? { storeId: { in: stores } } : {}, orderBy: [{ storeId: 'asc' }, { code: 'asc' }], include: { store: { select: { id: true, name: true, code: true } } } });
  }
  async createWarehouse(dto: D.CreateWarehouseDto) {
    if (!(await this.prisma.db.store.findFirst({ where: { id: dto.storeId } }))) throw new BadRequestException('Unknown store');
    if (await this.prisma.raw.warehouse.findFirst({ where: { storeId: dto.storeId, code: dto.code } })) throw new ConflictException('Warehouse code already exists in this store');
    return this.prisma.raw.warehouse.create({ data: dto });
  }
  async updateWarehouse(id: string, dto: D.UpdateWarehouseDto) {
    if (!(await this.prisma.db.warehouse.findFirst({ where: { id } }))) throw new NotFoundException('Warehouse not found');
    return this.prisma.raw.warehouse.update({ where: { id }, data: dto });
  }
  async removeWarehouse(id: string) {
    if (!(await this.prisma.db.warehouse.findFirst({ where: { id } }))) throw new NotFoundException('Warehouse not found');
    const agg = await this.prisma.db.stockLevel.aggregate({ where: { warehouseId: id }, _sum: { quantity: true } });
    if ((agg._sum.quantity ?? 0) > 0) throw new ConflictException({ code: 'HAS_STOCK', message: 'Warehouse still holds stock' });
    await this.prisma.db.warehouse.delete({ where: { id } });
  }

  // ------------------------------------------------------------------ stock views
  async stockList(dto: D.StockQueryDto, user: AuthUser) {
    const stores = this.scope(user, dto.storeId);
    const ids = dto.lowStock ? (await this.prisma.raw.$queryRaw<{ id: string }[]>`SELECT id FROM "StockLevel" WHERE "deletedAt" IS NULL AND "reorderPoint" > 0 AND quantity <= "reorderPoint"`).map((r) => r.id) : undefined;
    const s = dto.search?.trim();
    const where: Record<string, any> = {
      ...(ids && { id: { in: ids } }),
      ...(dto.warehouseId && { warehouseId: dto.warehouseId }),
      warehouse: { ...(stores && { storeId: { in: stores } }) },
      variant: {
        ...(dto.brandId || dto.productType ? { product: { ...(dto.brandId && { brandId: dto.brandId }), ...(dto.productType && { type: dto.productType }) } } : {}),
        ...(s && { OR: [{ sku: { contains: s, mode: 'insensitive' } }, { barcode: { contains: s } }, { color: { contains: s, mode: 'insensitive' } }, { product: { name: { contains: s, mode: 'insensitive' } } }] }),
      },
    };
    const res = await paginate(this.prisma.db.stockLevel, dto, { where, include: { variant: VARIANT_INFO, warehouse: WAREHOUSE_INFO }, sortable: ['quantity', 'updatedAt'], defaultSort: 'updatedAt' });
    return { ...res, data: res.data.map((l: any) => ({ ...l, available: l.quantity - l.reserved, isLow: l.reorderPoint > 0 && l.quantity <= l.reorderPoint })) };
  }

  /** Headline numbers for the inventory dashboard. */
  async summary(user: AuthUser, storeId?: string) {
    const stores = this.scope(user, storeId);
    if (stores && stores.length === 0) return { units: 0, value: 0, lowStock: 0, outOfStock: 0, skus: 0 };
    const filter = stores ? Prisma.sql`AND w."storeId" IN (${Prisma.join(stores)})` : Prisma.empty;
    const [r] = await this.prisma.raw.$queryRaw<{ units: number; value: number; low: number; out: number; skus: number }[]>`
      SELECT COALESCE(SUM(sl.quantity),0)::int AS units,
             COALESCE(SUM(sl.quantity * COALESCE(v.cost,0)),0)::float AS value,
             COUNT(*) FILTER (WHERE sl."reorderPoint" > 0 AND sl.quantity <= sl."reorderPoint")::int AS low,
             COUNT(*) FILTER (WHERE sl.quantity <= 0)::int AS out,
             COUNT(DISTINCT sl."variantId")::int AS skus
      FROM "StockLevel" sl
      JOIN "Warehouse" w ON w.id = sl."warehouseId" AND w."deletedAt" IS NULL
      JOIN "ProductVariant" v ON v.id = sl."variantId" AND v."deletedAt" IS NULL
      WHERE sl."deletedAt" IS NULL ${filter}`;
    return { units: r.units, value: r.value, lowStock: r.low, outOfStock: r.out, skus: r.skus };
  }

  async updateLevel(id: string, dto: D.UpdateStockLevelDto, user: AuthUser) {
    const level = await this.prisma.db.stockLevel.findFirst({ where: { id }, include: { warehouse: true } });
    if (!level) throw new NotFoundException('Stock level not found');
    assertStoreAccess(user, level.warehouse.storeId);
    return this.prisma.raw.stockLevel.update({ where: { id }, data: dto });
  }

  async movements(dto: D.MovementQueryDto, user: AuthUser) {
    const stores = this.scope(user, dto.storeId);
    const where = {
      ...(stores && { storeId: { in: stores } }), ...(dto.variantId && { variantId: dto.variantId }), ...(dto.warehouseId && { warehouseId: dto.warehouseId }), ...(dto.type && { type: dto.type as any }),
      ...((dto.from || dto.to) && { createdAt: { ...(dto.from && { gte: dto.from }), ...(dto.to && { lte: dto.to }) } }),
      ...(dto.search?.trim() && { OR: [{ note: { contains: dto.search.trim(), mode: 'insensitive' as const } }, { variant: { sku: { contains: dto.search.trim(), mode: 'insensitive' as const } } }, { variant: { product: { name: { contains: dto.search.trim(), mode: 'insensitive' as const } } } }] }),
    };
    return paginate(this.prisma.db.stockMovement, dto, { where, include: { variant: VARIANT_INFO, warehouse: WAREHOUSE_INFO }, sortable: ['createdAt', 'quantity'], defaultSort: 'createdAt' });
  }

  // ------------------------------------------------------------------ adjustments
  async createAdjustment(dto: D.CreateAdjustmentDto, user: AuthUser) {
    const wh = await this.warehouseFor(dto.warehouseId, user);
    await this.assertVariants(dto.lines.map((l) => l.variantId));
    if (dto.lines.some((l) => l.quantityDelta === 0)) throw new BadRequestException('quantityDelta must not be 0');
    const id = await this.prisma.raw.$transaction(async (tx) => {
      const number = await this.numbering.next(tx, wh.storeId, 'STOCK_ADJUSTMENT');
      const adj = await tx.stockAdjustment.create({
        data: { storeId: wh.storeId, warehouseId: wh.id, number, reason: dto.reason as any, note: dto.note, createdById: user.id, lines: { create: dto.lines.map((l) => ({ variantId: l.variantId, quantityDelta: l.quantityDelta, note: l.note })) } },
      });
      for (const l of dto.lines) await this.stock.move(tx, { storeId: wh.storeId, variantId: l.variantId, warehouseId: wh.id, type: 'ADJUSTMENT', quantity: l.quantityDelta, refType: 'StockAdjustment', refId: adj.id, note: l.note ?? dto.note ?? dto.reason, actorId: user.id });
      return adj.id;
    });
    return this.getAdjustment(id, user);
  }
  async listAdjustments(dto: D.ListDocsDto, user: AuthUser) {
    const stores = this.scope(user, dto.storeId);
    return paginate(this.prisma.db.stockAdjustment, dto, { where: { ...(stores && { storeId: { in: stores } }), ...(dto.warehouseId && { warehouseId: dto.warehouseId }), ...searchWhere(dto.search, ['number', 'note']) }, include: { warehouse: WAREHOUSE_INFO, _count: { select: { lines: true } } }, sortable: ['createdAt', 'number'] });
  }
  async getAdjustment(id: string, user: AuthUser) {
    const a = await this.prisma.db.stockAdjustment.findFirst({ where: { id }, include: { warehouse: WAREHOUSE_INFO, lines: { include: { variant: VARIANT_INFO } } } });
    if (!a) throw new NotFoundException('Adjustment not found');
    assertStoreAccess(user, a.storeId);
    return a;
  }

  // ------------------------------------------------------------------ transfers
  async createTransfer(dto: D.CreateTransferDto, user: AuthUser) {
    if (dto.fromWarehouseId === dto.toWarehouseId) throw new BadRequestException('Origin and destination must differ');
    const from = await this.warehouseFor(dto.fromWarehouseId, user);
    if (!(await this.prisma.db.warehouse.findFirst({ where: { id: dto.toWarehouseId } }))) throw new BadRequestException('Unknown destination warehouse');
    await this.assertVariants(dto.lines.map((l) => l.variantId));
    const id = await this.prisma.raw.$transaction(async (tx) => {
      const number = await this.numbering.next(tx, from.storeId, 'STOCK_TRANSFER');
      const t = await tx.stockTransfer.create({
        data: { storeId: from.storeId, number, fromWarehouseId: dto.fromWarehouseId, toWarehouseId: dto.toWarehouseId, note: dto.note, createdById: user.id, lines: { create: dto.lines } },
      });
      if (dto.ship) await this.doShip(tx, t.id, from.storeId, user);
      return t.id;
    });
    return this.getTransfer(id, user);
  }

  private async doShip(tx: any, id: string, storeId: string, user: AuthUser) {
    const t = await tx.stockTransfer.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
    if (t.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_STATE', message: `Transfer is ${t.status}, only DRAFT transfers can be shipped` });
    for (const l of t.lines) await this.stock.move(tx, { storeId, variantId: l.variantId, warehouseId: t.fromWarehouseId, type: 'TRANSFER_OUT', quantity: -l.quantity, refType: 'StockTransfer', refId: id, note: t.number, actorId: user.id });
    await tx.stockTransfer.update({ where: { id }, data: { status: 'IN_TRANSIT', shippedAt: new Date() } });
  }

  async shipTransfer(id: string, user: AuthUser) {
    const t = await this.getTransfer(id, user);
    assertStoreAccess(user, t.storeId);
    await this.prisma.raw.$transaction((tx) => this.doShip(tx, id, t.storeId, user));
    return this.getTransfer(id, user);
  }

  async receiveTransfer(id: string, dto: D.ReceiveTransferDto, user: AuthUser) {
    const t = await this.getTransfer(id, user);
    const dest = await this.prisma.db.warehouse.findFirstOrThrow({ where: { id: t.toWarehouseId } });
    assertStoreAccess(user, dest.storeId); // the RECEIVING store confirms arrival
    if (t.status !== 'IN_TRANSIT') throw new ConflictException({ code: 'INVALID_STATE', message: `Transfer is ${t.status}, only IN_TRANSIT transfers can be received` });
    const given = new Map((dto.lines ?? []).map((l) => [l.lineId, l.receivedQty]));
    for (const [lineId, qty] of given) {
      const line = t.lines.find((l) => l.id === lineId);
      if (!line) throw new BadRequestException(`Unknown line ${lineId}`);
      if (qty > line.quantity) throw new BadRequestException(`Cannot receive more than was shipped (${line.quantity})`);
    }
    await this.prisma.raw.$transaction(async (tx) => {
      for (const l of t.lines) {
        const qty = given.get(l.id) ?? l.quantity;
        if (qty > 0) await this.stock.move(tx, { storeId: dest.storeId, variantId: l.variantId, warehouseId: t.toWarehouseId, type: 'TRANSFER_IN', quantity: qty, refType: 'StockTransfer', refId: id, note: t.number, actorId: user.id });
        await tx.stockTransferLine.update({ where: { id: l.id }, data: { receivedQty: qty } });
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: 'RECEIVED', receivedAt: new Date(), receivedById: user.id } });
    });
    return this.getTransfer(id, user);
  }

  async cancelTransfer(id: string, user: AuthUser) {
    const t = await this.getTransfer(id, user);
    assertStoreAccess(user, t.storeId);
    if (t.status === 'RECEIVED' || t.status === 'CANCELLED') throw new ConflictException({ code: 'INVALID_STATE', message: `Transfer is already ${t.status}` });
    await this.prisma.raw.$transaction(async (tx) => {
      if (t.status === 'IN_TRANSIT') for (const l of t.lines) await this.stock.move(tx, { storeId: t.storeId, variantId: l.variantId, warehouseId: t.fromWarehouseId, type: 'TRANSFER_IN', quantity: l.quantity, refType: 'StockTransfer', refId: id, note: `${t.number} cancelled`, actorId: user.id });
      await tx.stockTransfer.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    return this.getTransfer(id, user);
  }

  async listTransfers(dto: D.ListDocsDto, user: AuthUser) {
    const stores = this.scope(user, dto.storeId);
    const where = {
      ...(dto.status && { status: dto.status as any }), ...searchWhere(dto.search, ['number', 'note']),
      // either end of the transfer may see it
      ...(stores && { OR: [{ fromWarehouse: { storeId: { in: stores } } }, { toWarehouse: { storeId: { in: stores } } }] }),
    };
    return paginate(this.prisma.db.stockTransfer, dto, { where, include: { fromWarehouse: WAREHOUSE_INFO, toWarehouse: WAREHOUSE_INFO, _count: { select: { lines: true } } }, sortable: ['createdAt', 'number', 'status'] });
  }

  async getTransfer(id: string, user: AuthUser) {
    const t = await this.prisma.db.stockTransfer.findFirst({ where: { id }, include: { fromWarehouse: WAREHOUSE_INFO, toWarehouse: WAREHOUSE_INFO, lines: { include: { variant: VARIANT_INFO } } } });
    if (!t) throw new NotFoundException('Transfer not found');
    if (!user.isSuperAdmin && !user.storeIds.includes(t.fromWarehouse.storeId) && !user.storeIds.includes(t.toWarehouse.storeId)) throw new NotFoundException('Transfer not found');
    return t;
  }

  // ------------------------------------------------------------------ counts
  async createCount(dto: D.CreateCountDto, user: AuthUser) {
    const wh = await this.warehouseFor(dto.warehouseId, user);
    const levels = await this.prisma.db.stockLevel.findMany({ where: { warehouseId: wh.id, ...(dto.productType && { variant: { product: { type: dto.productType as any } } }) } });
    if (levels.length === 0) throw new BadRequestException('Nothing to count: this warehouse has no stock records for the selection');
    const id = await this.prisma.raw.$transaction(async (tx) => {
      const number = await this.numbering.next(tx, wh.storeId, 'INVENTORY_COUNT');
      const c = await tx.inventoryCount.create({
        data: { storeId: wh.storeId, warehouseId: wh.id, number, status: 'IN_PROGRESS', startedAt: new Date(), note: dto.note, createdById: user.id, lines: { create: levels.map((l) => ({ variantId: l.variantId, expectedQty: l.quantity })) } },
      });
      return c.id;
    });
    return this.getCount(id, user);
  }

  async saveCountLines(id: string, dto: D.SaveCountLinesDto, user: AuthUser) {
    const c = await this.getCount(id, user);
    if (c.status !== 'IN_PROGRESS') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only an IN_PROGRESS count can be edited' });
    const known = new Map(c.lines.map((l) => [l.variantId, l.id]));
    for (const l of dto.lines) if (!known.has(l.variantId)) throw new BadRequestException(`Variant ${l.variantId} is not part of this count`);
    await this.prisma.raw.$transaction(dto.lines.map((l) => this.prisma.raw.inventoryCountLine.update({ where: { id: known.get(l.variantId)! }, data: { countedQty: l.countedQty, note: l.note } })));
    return this.getCount(id, user);
  }

  /** Posts COUNT_CORRECTION movements for every counted line whose result differs from the snapshot taken at the start. */
  async completeCount(id: string, user: AuthUser) {
    const c = await this.getCount(id, user);
    if (c.status !== 'IN_PROGRESS') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only an IN_PROGRESS count can be completed' });
    await this.prisma.raw.$transaction(async (tx) => {
      for (const l of c.lines) {
        if (l.countedQty === null) continue;
        // delta against the snapshot (not the live level) so sales made DURING the count are preserved
        const delta = l.countedQty - l.expectedQty;
        if (delta !== 0) await this.stock.move(tx, { storeId: c.storeId, variantId: l.variantId, warehouseId: c.warehouseId, type: 'COUNT_CORRECTION', quantity: delta, refType: 'InventoryCount', refId: id, note: c.number, actorId: user.id, allowNegative: true });
      }
      await tx.inventoryCount.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    });
    return this.getCount(id, user);
  }

  async cancelCount(id: string, user: AuthUser) {
    const c = await this.getCount(id, user);
    if (c.status !== 'IN_PROGRESS') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only an IN_PROGRESS count can be cancelled' });
    await this.prisma.raw.inventoryCount.update({ where: { id }, data: { status: 'CANCELLED' } });
    return this.getCount(id, user);
  }

  async listCounts(dto: D.ListDocsDto, user: AuthUser) {
    const stores = this.scope(user, dto.storeId);
    return paginate(this.prisma.db.inventoryCount, dto, { where: { ...(stores && { storeId: { in: stores } }), ...(dto.status && { status: dto.status as any }), ...(dto.warehouseId && { warehouseId: dto.warehouseId }), ...searchWhere(dto.search, ['number', 'note']) }, include: { warehouse: WAREHOUSE_INFO, _count: { select: { lines: true } } }, sortable: ['createdAt', 'number'] });
  }

  async getCount(id: string, user: AuthUser) {
    const c = await this.prisma.db.inventoryCount.findFirst({ where: { id }, include: { warehouse: WAREHOUSE_INFO, lines: { include: { variant: VARIANT_INFO }, orderBy: { variant: { sku: 'asc' } } } } });
    if (!c) throw new NotFoundException('Count not found');
    assertStoreAccess(user, c.storeId);
    return c;
  }
}
