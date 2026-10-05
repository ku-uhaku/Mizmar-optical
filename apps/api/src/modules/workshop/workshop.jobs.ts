import type { Tx } from '../../prisma/prisma.service';
import type { NumberingService } from '../numbering/numbering.service';

export const DEFAULT_TASKS = ['Taillage', 'Montage', 'Nettoyage'];
export type JobStatus = 'PENDING' | 'LENSES_ORDERED' | 'LENSES_RECEIVED' | 'CUTTING_MOUNTING' | 'QUALITY_CHECK' | 'READY' | 'DELIVERED' | 'ON_HOLD' | 'CANCELLED';

/** Statuses a person may move a job to by hand. READY comes only from a passed quality check, DELIVERED only from hand-over. */
export const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  PENDING: ['LENSES_ORDERED', 'LENSES_RECEIVED', 'ON_HOLD', 'CANCELLED'],
  LENSES_ORDERED: ['LENSES_RECEIVED', 'ON_HOLD', 'CANCELLED'],
  LENSES_RECEIVED: ['CUTTING_MOUNTING', 'ON_HOLD', 'CANCELLED'],
  CUTTING_MOUNTING: ['QUALITY_CHECK', 'ON_HOLD', 'CANCELLED'],
  QUALITY_CHECK: ['ON_HOLD', 'CANCELLED'],
  READY: [],
  DELIVERED: [],
  ON_HOLD: ['CANCELLED'],
  CANCELLED: [],
};

/** Writes the new status and its history row. Callers validate the move. */
export async function moveJob(tx: Tx, job: { id: string; status: string }, to: JobStatus, userId: string | null, note?: string | null, extra: Record<string, unknown> = {}) {
  await tx.jobOrder.update({ where: { id: job.id }, data: { status: to, ...extra } });
  await tx.jobOrderStatusHistory.create({ data: { jobOrderId: job.id, fromStatus: job.status as JobStatus, toStatus: to, changedById: userId, note: note ?? undefined } });
}

interface LensLine { lineId: string; variantId: string | null; description: string; lens: { lensTypeId: string; lensEntryId: string | null; prescriptionId: string | null; treatments: { treatmentId: string; name: string }[]; notes?: string } }

/** One job per prescription line, created inside the checkout transaction so a sale and its workshop ticket can never disagree. */
export async function createJobsForOrder(tx: Tx, numbering: NumberingService, o: { orderId: string; storeId: string; customerId: string; userId: string | null; defaultDays: number; lines: LensLine[] }) {
  for (const l of o.lines) {
    const entry = l.lens.lensEntryId ? await tx.lensCatalogEntry.findUnique({ where: { id: l.lens.lensEntryId } }) : null;
    const days = entry?.leadTimeDays ?? o.defaultDays;
    // a prescription the customer typed or scanned online has not been checked by staff: flag it on the ticket so nobody cuts blind
    const rx = l.lens.prescriptionId ? await tx.prescription.findUnique({ where: { id: l.lens.prescriptionId }, select: { source: true, verifiedAt: true } }) : null;
    const notes = [rx && rx.source !== 'STORE' && !rx.verifiedAt ? 'Ordonnance à vérifier avant taillage (saisie / scan client)' : null, l.lens.notes].filter(Boolean).join(' — ') || undefined;
    const number = await numbering.next(tx, o.storeId, 'JOB_ORDER');
    const job = await tx.jobOrder.create({
      data: {
        storeId: o.storeId, number, orderId: o.orderId, orderLineId: l.lineId, customerId: o.customerId, prescriptionId: l.lens.prescriptionId, frameSource: 'STORE_STOCK', frameVariantId: l.variantId,
        lensTypeId: l.lens.lensTypeId, lensEntryId: l.lens.lensEntryId, treatments: l.lens.treatments.map((t) => ({ id: t.treatmentId, name: t.name })), notes,
        status: 'PENDING', promisedAt: new Date(Date.now() + days * 86_400_000), createdById: o.userId,
        tasks: { create: DEFAULT_TASKS.map((name, i) => ({ name, sortOrder: i })) },
      },
    });
    await tx.jobOrderStatusHistory.create({ data: { jobOrderId: job.id, toStatus: 'PENDING', changedById: o.userId, note: 'Created from order' } });
  }
}

/** Open jobs of an order; a job is "open" until delivered or cancelled. */
export const openJobs = (tx: Tx, orderId: string) => tx.jobOrder.findMany({ where: { orderId, deletedAt: null, status: { notIn: ['DELIVERED', 'CANCELLED'] } } });

export async function cancelJobsForOrder(tx: Tx, orderId: string, userId: string, note: string) {
  for (const j of await openJobs(tx, orderId)) await moveJob(tx, j, 'CANCELLED', userId, note);
}

/** Handing an order over: every prescription job must be ready; they are then delivered with it. Returns the blocking job numbers. */
export async function notReadyJobs(tx: Tx, orderId: string) {
  return (await openJobs(tx, orderId)).filter((j) => j.status !== 'READY').map((j) => j.number);
}
export async function deliverJobsForOrder(tx: Tx, orderId: string, userId: string) {
  for (const j of await openJobs(tx, orderId)) await moveJob(tx, j, 'DELIVERED', userId, 'Order handed over', { deliveredAt: new Date() });
}
