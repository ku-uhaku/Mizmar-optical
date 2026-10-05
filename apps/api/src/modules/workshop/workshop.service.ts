import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { toCents } from '@mizmar/shared';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import * as D from './workshop.dto';
import { DEFAULT_TASKS, moveJob, TRANSITIONS, type JobStatus } from './workshop.jobs';

const INCLUDE = {
  customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
  technician: { select: { id: true, firstName: true, lastName: true } },
  order: { select: { id: true, number: true, balanceDue: true, status: true } },
  frameVariant: { select: { id: true, sku: true, color: true, size: true, product: { select: { name: true } } } },
  prescription: true,
} as const;

const can = (u: AuthUser, perm: string) => u.isSuperAdmin || u.permissions.includes(perm);
const lock = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM "JobOrder" WHERE id = ${id} FOR UPDATE`;

@Injectable()
export class WorkshopService {
  private readonly logger = new Logger('Workshop');
  constructor(
    private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly settings: SettingsService,
    @InjectQueue('mail') private readonly mail: Queue, @InjectQueue('sms') private readonly sms: Queue,
  ) {}

  // ------------------------------------------------------------------ reads
  private async mustGet(id: string, user: AuthUser) {
    const j = await this.prisma.db.jobOrder.findFirst({ where: { id } });
    if (!j) throw new NotFoundException('Job not found');
    assertStoreAccess(user, j.storeId);
    return j;
  }

  async get(id: string, user: AuthUser) {
    await this.mustGet(id, user);
    const j = await this.prisma.db.jobOrder.findFirstOrThrow({
      where: { id },
      include: {
        ...INCLUDE,
        tasks: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        history: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        labLensOrders: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { supplier: { select: { id: true, name: true } } } },
      },
    });
    const lensType = j.lensTypeId ? await this.prisma.db.lensType.findFirst({ where: { id: j.lensTypeId }, select: { id: true, name: true, kind: true } }) : null;
    const lensEntry = j.lensEntryId ? await this.prisma.db.lensCatalogEntry.findFirst({ where: { id: j.lensEntryId }, select: { id: true, name: true, supplierId: true } }) : null;
    const notifications = await this.prisma.db.notification.findMany({ where: { customerId: j.customerId, type: 'job_ready', data: { path: ['jobId'], equals: id } }, orderBy: { createdAt: 'desc' }, take: 10 });
    const userIds = [...new Set(j.history.map((h) => h.changedById).filter(Boolean) as string[])];
    const users = userIds.length ? await this.prisma.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
    const names = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    return {
      ...j, lensType, lensEntry, notifications, isOverdue: this.overdue(j),
      history: j.history.map((h) => ({ ...h, changedBy: h.changedById ? (names.get(h.changedById) ?? null) : null })),
      allowedNext: TRANSITIONS[j.status as JobStatus] ?? [],
    };
  }

  private overdue(j: { status: string; promisedAt: Date | null }) {
    return !!j.promisedAt && j.promisedAt < new Date() && !['READY', 'DELIVERED', 'CANCELLED'].includes(j.status);
  }

  async list(dto: D.ListJobsDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const s = dto.search?.trim();
    const where: Record<string, any> = {
      ...(stores && { storeId: { in: stores } }), ...(dto.status && { status: dto.status }), ...(dto.customerId && { customerId: dto.customerId }),
      ...(dto.technicianId && { technicianId: dto.technicianId }), ...(dto.mine && { technicianId: user.id }),
      ...(dto.active && { status: { notIn: ['READY', 'DELIVERED', 'CANCELLED'] } }),
      ...(dto.overdue && { promisedAt: { lt: new Date() }, status: { notIn: ['READY', 'DELIVERED', 'CANCELLED'] } }),
      ...(s && { OR: [{ number: { contains: s, mode: 'insensitive' } }, { customer: { OR: [{ firstName: { contains: s, mode: 'insensitive' } }, { lastName: { contains: s, mode: 'insensitive' } }, { phone: { contains: s } }] } }, { order: { number: { contains: s, mode: 'insensitive' } } }] }),
    };
    const res = await paginate(this.prisma.db.jobOrder, dto, { where, include: { ...INCLUDE, prescription: false, _count: { select: { tasks: true } } }, sortable: ['createdAt', 'promisedAt', 'number', 'priority'], defaultSort: 'promisedAt' });
    return { ...res, data: res.data.map((j: any) => ({ ...j, isOverdue: this.overdue(j) })) };
  }

  async summary(user: AuthUser, storeId?: string) {
    const stores = storeId ? (assertStoreAccess(user, storeId), [storeId]) : visibleStoreIds(user);
    const scope = stores ? { storeId: { in: stores } } : {};
    const rows = await this.prisma.db.jobOrder.groupBy({ by: ['status'], where: scope, _count: { _all: true } });
    const counts = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    const overdue = await this.prisma.db.jobOrder.count({ where: { ...scope, promisedAt: { lt: new Date() }, status: { notIn: ['READY', 'DELIVERED', 'CANCELLED'] } } });
    const mine = await this.prisma.db.jobOrder.count({ where: { ...scope, technicianId: user.id, status: { notIn: ['READY', 'DELIVERED', 'CANCELLED'] } } });
    return { counts, overdue, mine };
  }

  // ------------------------------------------------------------------ writes
  /** A job for a frame the customer brought (or any bench work not tied to a till sale). */
  async create(dto: D.CreateJobDto, user: AuthUser, activeStoreId?: string | null) {
    const storeId = activeStoreId ?? user.defaultStoreId;
    if (!storeId) throw new BadRequestException({ code: 'NO_STORE', message: 'No active store' });
    assertStoreAccess(user, storeId);
    if (!(await this.prisma.db.customer.findFirst({ where: { id: dto.customerId } }))) throw new BadRequestException('Unknown customer');
    if (!dto.frameDescription && !dto.frameVariantId) throw new BadRequestException({ code: 'FRAME_REQUIRED', message: 'Describe the frame (or pick one from stock)' });
    if (dto.prescriptionId && !(await this.prisma.db.prescription.findFirst({ where: { id: dto.prescriptionId, customerId: dto.customerId } }))) throw new BadRequestException('That prescription does not belong to this customer');
    if (dto.lensTypeId && !(await this.prisma.db.lensType.findFirst({ where: { id: dto.lensTypeId } }))) throw new BadRequestException('Unknown lens type');
    const entry = dto.lensEntryId ? await this.prisma.db.lensCatalogEntry.findFirst({ where: { id: dto.lensEntryId } }) : null;
    if (dto.lensEntryId && !entry) throw new BadRequestException('Unknown lens');
    const treatments = dto.treatmentIds?.length ? await this.prisma.db.lensTreatment.findMany({ where: { id: { in: dto.treatmentIds } }, select: { id: true, name: true } }) : [];
    if (treatments.length !== (dto.treatmentIds?.length ?? 0)) throw new BadRequestException('Unknown treatment');
    const days = entry?.leadTimeDays ?? (await this.settings.value<number>('workshop_default_days', 5, storeId));
    const id = await this.prisma.raw.$transaction(async (tx) => {
      const number = await this.numbering.next(tx, storeId, 'JOB_ORDER');
      const job = await tx.jobOrder.create({
        data: {
          storeId, number, customerId: dto.customerId, prescriptionId: dto.prescriptionId, frameSource: dto.frameVariantId ? 'STORE_STOCK' : 'CUSTOMER_OWN', frameVariantId: dto.frameVariantId, frameDescription: dto.frameDescription,
          lensTypeId: dto.lensTypeId, lensEntryId: dto.lensEntryId, treatments, fitting: dto.fitting as object, priority: (dto.priority as 'NORMAL') ?? 'NORMAL', notes: dto.notes, status: 'PENDING',
          promisedAt: dto.promisedAt ?? new Date(Date.now() + days * 86_400_000), createdById: user.id, tasks: { create: DEFAULT_TASKS.map((name, i) => ({ name, sortOrder: i })) },
        },
      });
      await tx.jobOrderStatusHistory.create({ data: { jobOrderId: job.id, toStatus: 'PENDING', changedById: user.id, note: 'Created manually' } });
      return job.id;
    });
    return this.get(id, user);
  }

  async update(id: string, dto: D.UpdateJobDto, user: AuthUser) {
    const j = await this.mustGet(id, user);
    if (['DELIVERED', 'CANCELLED'].includes(j.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `Job is ${j.status}` });
    await this.prisma.raw.jobOrder.update({ where: { id }, data: { fitting: dto.fitting as object, priority: dto.priority as 'NORMAL', promisedAt: dto.promisedAt, notes: dto.notes, frameDescription: dto.frameDescription } });
    return this.get(id, user);
  }

  async assign(id: string, dto: D.AssignDto, user: AuthUser) {
    const j = await this.mustGet(id, user);
    if (['DELIVERED', 'CANCELLED'].includes(j.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `Job is ${j.status}` });
    // anyone working the bench may take a job; handing one to somebody else is a manager's call
    if (dto.technicianId !== user.id && !can(user, 'workshop:assign')) throw new ForbiddenException('You can only assign jobs to yourself');
    if (dto.technicianId) {
      const t = await this.prisma.db.user.findFirst({ where: { id: dto.technicianId, status: 'ACTIVE', type: 'STAFF' }, include: { stores: true } });
      if (!t || (!t.stores.some((s) => s.storeId === j.storeId) && !t.isSuperAdmin)) throw new BadRequestException({ code: 'INVALID_TECHNICIAN', message: 'That user cannot work in this store' });
    }
    await this.prisma.raw.jobOrder.update({ where: { id }, data: { technicianId: dto.technicianId } });
    return this.get(id, user);
  }

  async status(id: string, dto: D.JobStatusDto, user: AuthUser) {
    const to = dto.to as JobStatus;
    await this.prisma.raw.$transaction(async (tx) => {
      await lock(tx, id);
      const j = await tx.jobOrder.findUniqueOrThrow({ where: { id } });
      assertStoreAccess(user, j.storeId);
      if (!TRANSITIONS[j.status as JobStatus]?.includes(to)) throw new ConflictException({ code: 'INVALID_TRANSITION', message: `A job cannot go from ${j.status} to ${to}`, details: { allowed: TRANSITIONS[j.status as JobStatus] } });
      if (to === 'CUTTING_MOUNTING' && !j.technicianId) throw new ConflictException({ code: 'TECHNICIAN_REQUIRED', message: 'Assign a technician before cutting and mounting' });
      if (to === 'QUALITY_CHECK') {
        const open = await tx.jobOrderTask.count({ where: { jobOrderId: id, deletedAt: null, status: { not: 'DONE' } } });
        if (open) throw new ConflictException({ code: 'TASKS_OPEN', message: 'Finish every task before the quality check', details: { open } });
      }
      await moveJob(tx, j, to, user.id, dto.note);
    });
    return this.get(id, user);
  }

  async resume(id: string, dto: D.NoteDto, user: AuthUser) {
    await this.prisma.raw.$transaction(async (tx) => {
      await lock(tx, id);
      const j = await tx.jobOrder.findUniqueOrThrow({ where: { id } });
      assertStoreAccess(user, j.storeId);
      if (j.status !== 'ON_HOLD') throw new ConflictException({ code: 'INVALID_STATE', message: 'The job is not on hold' });
      const held = await tx.jobOrderStatusHistory.findFirst({ where: { jobOrderId: id, toStatus: 'ON_HOLD' }, orderBy: { createdAt: 'desc' } });
      await moveJob(tx, j, (held?.fromStatus as JobStatus) ?? 'PENDING', user.id, dto.note ?? 'Resumed');
    });
    return this.get(id, user);
  }

  async qualityCheck(id: string, dto: D.QualityCheckDto, user: AuthUser) {
    if (!dto.passed && !dto.notes?.trim()) throw new BadRequestException({ code: 'NOTES_REQUIRED', message: 'Say what failed so the bench can fix it' });
    let ready = false;
    await this.prisma.raw.$transaction(async (tx) => {
      await lock(tx, id);
      const j = await tx.jobOrder.findUniqueOrThrow({ where: { id } });
      assertStoreAccess(user, j.storeId);
      if (j.status !== 'QUALITY_CHECK') throw new ConflictException({ code: 'INVALID_STATE', message: 'The job is not awaiting quality check' });
      if (dto.passed) { await moveJob(tx, j, 'READY', user.id, dto.notes, { qcPassed: true, qcNotes: dto.notes, readyAt: new Date() }); ready = true; }
      else {
        await moveJob(tx, j, 'CUTTING_MOUNTING', user.id, `QC failed: ${dto.notes}`, { qcPassed: false, qcNotes: dto.notes });
        await tx.jobOrderTask.updateMany({ where: { jobOrderId: id, deletedAt: null }, data: { status: 'TODO', completedAt: null } }); // the bench redoes them
      }
    });
    if (ready) await this.notifyReady(id).catch((e) => this.logger.error(`ready notification failed: ${e}`));
    return this.get(id, user);
  }

  async deliver(id: string, user: AuthUser) {
    await this.prisma.raw.$transaction(async (tx) => {
      await lock(tx, id);
      const j = await tx.jobOrder.findUniqueOrThrow({ where: { id }, include: { order: true } });
      assertStoreAccess(user, j.storeId);
      if (j.status !== 'READY') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only a ready job can be handed over' });
      if (j.order && toCents(Number(j.order.balanceDue)) > 0) throw new ConflictException({ code: 'BALANCE_DUE', message: 'The remaining balance must be paid first', details: { due: Number(j.order.balanceDue) } });
      await moveJob(tx, j, 'DELIVERED', user.id, 'Handed over', { deliveredAt: new Date() });
    });
    return this.get(id, user);
  }

  // ------------------------------------------------------------------ tasks
  async addTask(id: string, dto: D.TaskDto, user: AuthUser) {
    const j = await this.mustGet(id, user);
    if (['READY', 'DELIVERED', 'CANCELLED'].includes(j.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `Job is ${j.status}` });
    const last = await this.prisma.db.jobOrderTask.aggregate({ where: { jobOrderId: id }, _max: { sortOrder: true } });
    await this.prisma.raw.jobOrderTask.create({ data: { jobOrderId: id, name: dto.name, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
    return this.get(id, user);
  }

  private async mustTask(id: string, taskId: string, user: AuthUser) {
    await this.mustGet(id, user);
    const t = await this.prisma.db.jobOrderTask.findFirst({ where: { id: taskId, jobOrderId: id } });
    if (!t) throw new NotFoundException('Task not found');
    return t;
  }

  async setTask(id: string, taskId: string, dto: D.TaskStatusDto, user: AuthUser) {
    await this.mustTask(id, taskId, user);
    const st = dto.status as 'TODO';
    await this.prisma.raw.jobOrderTask.update({ where: { id: taskId }, data: { status: st, assignedToId: user.id, startedAt: st === 'TODO' ? null : new Date(), completedAt: (dto.status as string) === 'DONE' ? new Date() : null } });
    return this.get(id, user);
  }

  async removeTask(id: string, taskId: string, user: AuthUser) {
    await this.mustTask(id, taskId, user);
    await this.prisma.raw.jobOrderTask.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
    return this.get(id, user);
  }

  // ------------------------------------------------------------------ lab lens orders
  async addLabOrder(id: string, dto: D.CreateLabOrderDto, user: AuthUser) {
    const j = await this.mustGet(id, user);
    if (['READY', 'DELIVERED', 'CANCELLED'].includes(j.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `Job is ${j.status}` });
    const sup = await this.prisma.db.supplier.findFirst({ where: { id: dto.supplierId, isActive: true } });
    if (!sup) throw new BadRequestException({ code: 'UNKNOWN_SUPPLIER', message: 'Unknown or inactive supplier' });
    await this.prisma.raw.labLensOrder.create({ data: { jobOrderId: id, supplierId: dto.supplierId, lensEntryId: dto.lensEntryId ?? j.lensEntryId, status: 'TO_ORDER', reference: dto.reference, cost: dto.cost, expectedAt: dto.expectedAt, notes: dto.notes } });
    return this.get(id, user);
  }

  /** The lab order drives the job: ordering lenses, receiving them, or sending a faulty pair back moves the job along. */
  async setLabOrder(id: string, labId: string, dto: D.LabOrderStatusDto, user: AuthUser) {
    await this.prisma.raw.$transaction(async (tx) => {
      await lock(tx, id);
      const j = await tx.jobOrder.findUniqueOrThrow({ where: { id } });
      assertStoreAccess(user, j.storeId);
      const lab = await tx.labLensOrder.findFirst({ where: { id: labId, jobOrderId: id, deletedAt: null } });
      if (!lab) throw new NotFoundException('Lens order not found');
      if (['READY', 'DELIVERED', 'CANCELLED'].includes(j.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `Job is ${j.status}` });
      const ok: Record<string, string[]> = { TO_ORDER: ['ORDERED', 'CANCELLED'], ORDERED: ['RECEIVED', 'DEFECTIVE', 'CANCELLED'], RECEIVED: ['DEFECTIVE'], DEFECTIVE: [], CANCELLED: [] };
      if (!ok[lab.status].includes(dto.status)) throw new ConflictException({ code: 'INVALID_TRANSITION', message: `A lens order cannot go from ${lab.status} to ${dto.status}` });
      const now = new Date();
      await tx.labLensOrder.update({ where: { id: labId }, data: { status: dto.status as 'ORDERED', notes: dto.notes ?? lab.notes, reference: dto.reference ?? lab.reference, ...(dto.status === 'ORDERED' && { orderedAt: now }), ...(dto.status === 'RECEIVED' && { receivedAt: now }) } });
      const s = j.status as JobStatus;
      if (dto.status === 'ORDERED' && s === 'PENDING') await moveJob(tx, j, 'LENSES_ORDERED', user.id, 'Lenses ordered from the lab');
      if (dto.status === 'RECEIVED' && ['PENDING', 'LENSES_ORDERED'].includes(s)) await moveJob(tx, j, 'LENSES_RECEIVED', user.id, 'Lenses received from the lab');
      if (dto.status === 'DEFECTIVE' && ['LENSES_RECEIVED', 'CUTTING_MOUNTING', 'QUALITY_CHECK'].includes(s)) await moveJob(tx, j, 'PENDING', user.id, `Defective lenses: ${dto.notes ?? 'sent back'}`);
    });
    return this.get(id, user);
  }

  // ------------------------------------------------------------------ customer notification
  async notify(id: string, user: AuthUser) {
    const j = await this.mustGet(id, user);
    if (j.status !== 'READY') throw new ConflictException({ code: 'INVALID_STATE', message: 'Only a ready job can be announced' });
    const sent = await this.notifyReady(id);
    if (!sent) throw new ConflictException({ code: 'NO_CONTACT', message: 'The customer has no email or phone number on file' });
    return this.get(id, user);
  }

  /** Queues one message per channel the customer can be reached on. Returns how many were queued. */
  async notifyReady(id: string) {
    const j = await this.prisma.raw.jobOrder.findUniqueOrThrow({ where: { id }, include: { customer: true } });
    const store = await this.prisma.raw.store.findUniqueOrThrow({ where: { id: j.storeId } });
    const enabled = await this.settings.value<string[]>('workshop_notify_channels', ['EMAIL', 'SMS'], j.storeId);
    const data = { jobId: j.id, jobNumber: j.number, firstName: j.customer.firstName, storeName: store.name };
    const targets: { channel: 'EMAIL' | 'SMS' | 'WHATSAPP'; to: string }[] = [];
    if (enabled.includes('EMAIL') && j.customer.email) targets.push({ channel: 'EMAIL', to: j.customer.email });
    if (enabled.includes('SMS') && j.customer.phone) targets.push({ channel: 'SMS', to: j.customer.phone });
    if (enabled.includes('WHATSAPP') && (j.customer.whatsapp ?? j.customer.phone)) targets.push({ channel: 'WHATSAPP', to: (j.customer.whatsapp ?? j.customer.phone)! });
    for (const t of targets) {
      const row = await this.prisma.raw.notification.create({ data: { customerId: j.customerId, channel: t.channel, type: 'job_ready', title: `${j.number}`, body: `${j.number} → ${t.to}`, data: data as object, status: 'PENDING' } });
      try {
        if (t.channel === 'EMAIL') await this.mail.add('job_ready', { to: t.to, template: 'job_ready', data, notificationId: row.id });
        else await this.sms.add('job_ready', { to: t.to, template: 'job_ready', channel: t.channel, data, notificationId: row.id });
      } catch (e) {
        await this.prisma.raw.notification.update({ where: { id: row.id }, data: { status: 'FAILED', error: String(e).slice(0, 500) } });
      }
    }
    if (targets.length) {
      await this.prisma.raw.jobOrder.update({ where: { id }, data: { customerNotifiedAt: new Date() } });
      await this.prisma.raw.jobOrderStatusHistory.updateMany({ where: { jobOrderId: id, toStatus: 'READY' }, data: { notified: true } });
    }
    return targets.length;
  }
}
