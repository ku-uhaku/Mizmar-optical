import { Injectable } from '@nestjs/common';
import type { DocumentType } from '../../generated/prisma/client';
import type { Tx } from '../../prisma/prisma.service';

/**
 * Gap-free-per-period document numbers (e.g. CASA-ATL-2026-000042).
 *
 * The per-store/per-type "template" row (periodKey = 'all') holds prefix, padding and reset policy and is editable from the
 * dashboard. The actual counter lives on a row keyed by period ("2026", "2026-10" or "all"), incremented atomically with a
 * single INSERT ... ON CONFLICT DO UPDATE so concurrent requests can never receive the same number.
 * Call it INSIDE the transaction that creates the document so a rollback also rolls the number back.
 */
@Injectable()
export class NumberingService {
  async next(tx: Tx, storeId: string, docType: DocumentType, now = new Date()): Promise<string> {
    const cfg = await tx.documentSequence.findUnique({ where: { storeId_docType_periodKey: { storeId, docType, periodKey: 'all' } } });
    const prefix = cfg?.prefix ?? docType.slice(0, 3);
    const padding = cfg?.padding ?? 6;
    const reset = cfg?.reset ?? 'YEARLY';
    const y = now.getFullYear();
    const periodKey = reset === 'NEVER' ? 'all' : reset === 'YEARLY' ? String(y) : `${y}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const rows = await tx.$queryRaw<{ n: number }[]>`
      INSERT INTO "DocumentSequence" (id, "storeId", "docType", prefix, padding, "nextNumber", reset, "periodKey", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${storeId}, ${docType}::"DocumentType", ${prefix}, ${padding}, 2, ${reset}::"SequenceReset", ${periodKey}, now(), now())
      ON CONFLICT ("storeId", "docType", "periodKey")
      DO UPDATE SET "nextNumber" = "DocumentSequence"."nextNumber" + 1, "updatedAt" = now()
      RETURNING "nextNumber" - 1 AS n`;
    const n = Number(rows[0].n);
    const year = reset === 'NEVER' ? '' : reset === 'YEARLY' ? `${y}-` : `${periodKey}-`;
    return `${prefix}-${year}${String(n).padStart(padding, '0')}`;
  }
}
