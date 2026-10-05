import { BadRequestException, Injectable } from '@nestjs/common';
import type { StockMovementType } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../prisma/prisma.service';

export interface MoveInput {
  storeId: string;
  variantId: string;
  warehouseId: string;
  type: StockMovementType;
  /** Signed: positive adds stock, negative removes it. */
  quantity: number;
  unitCost?: number;
  refType?: string;
  refId?: string;
  lotNumber?: string;
  expiryDate?: Date;
  note?: string;
  actorId?: string;
  /** Only for corrections / counts, where reality wins over the ledger. */
  allowNegative?: boolean;
}

/**
 * The ONLY place that changes stock. Every change updates StockLevel and appends an immutable StockMovement with the
 * resulting balance, in the caller's transaction. POS, purchasing, workshop and online orders will all call this.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async move(tx: Tx, m: MoveInput) {
    if (!Number.isInteger(m.quantity) || m.quantity === 0) throw new BadRequestException('Quantity must be a non-zero integer');
    // make sure the level row exists, then change it with ONE atomic statement that also returns the new balance
    await tx.stockLevel.upsert({
      where: { variantId_warehouseId: { variantId: m.variantId, warehouseId: m.warehouseId } },
      create: { variantId: m.variantId, warehouseId: m.warehouseId, quantity: 0 },
      update: {},
    });
    const where = { variantId_warehouseId: { variantId: m.variantId, warehouseId: m.warehouseId } };
    let level;
    if (m.quantity < 0 && !m.allowNegative) {
      // conditional decrement: matches only if enough stock remains (race-safe, no read-then-write)
      const res = await tx.stockLevel.updateMany({
        where: { variantId: m.variantId, warehouseId: m.warehouseId, deletedAt: null, quantity: { gte: -m.quantity } },
        data: { quantity: { decrement: -m.quantity } },
      });
      if (res.count === 0) {
        const cur = await tx.stockLevel.findUnique({ where });
        throw new BadRequestException({ code: 'INSUFFICIENT_STOCK', message: 'Not enough stock for this operation', details: { variantId: m.variantId, available: cur?.quantity ?? 0, requested: -m.quantity } });
      }
      level = await tx.stockLevel.findUniqueOrThrow({ where });
    } else {
      level = await tx.stockLevel.update({ where, data: { quantity: { increment: m.quantity } } });
    }
    return tx.stockMovement.create({
      data: {
        storeId: m.storeId, variantId: m.variantId, warehouseId: m.warehouseId, type: m.type, quantity: m.quantity, balanceAfter: level.quantity,
        unitCost: m.unitCost, refType: m.refType, refId: m.refId, lotNumber: m.lotNumber, expiryDate: m.expiryDate, note: m.note, actorId: m.actorId,
      },
    });
  }
}
