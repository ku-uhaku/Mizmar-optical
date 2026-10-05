import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import { assertStoreAccess, visibleStoreIds } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import { isDate, localDate, minutes, slotsForDay, type Busy, type Rule } from './slots';
import * as D from './appointments.dto';

const ACTIVE = ['PENDING', 'CONFIRMED', 'CHECKED_IN'] as const; // statuses that occupy the practitioner's time
const NEXT: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'], CHECKED_IN: ['COMPLETED', 'CANCELLED', 'NO_SHOW'], COMPLETED: [], CANCELLED: [], NO_SHOW: [],
};
const MAX_UPCOMING_PER_CONTACT = 3;

const INCLUDE = {
  type: { select: { id: true, code: true, name: true, durationMin: true, color: true, price: true } },
  practitioner: { select: { id: true, firstName: true, lastName: true } },
  customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
} as const;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly settings: SettingsService,
    @InjectQueue('mail') private readonly mail: Queue,
  ) {}

  // ------------------------------------------------------------------ availability
  private async store(id: string, publicOnly = false) {
    const s = await this.prisma.db.store.findFirst({ where: { id, isActive: true, ...(publicOnly ? { showOnLocator: true } : {}) } });
    if (!s) throw new BadRequestException({ code: 'UNKNOWN_STORE', message: 'Unknown store' });
    return s;
  }

  private async type(id: string, online: boolean) {
    const t = await this.prisma.db.appointmentType.findFirst({ where: { id, isActive: true, ...(online ? { bookableOnline: true } : {}) } });
    if (!t) throw new BadRequestException({ code: 'UNKNOWN_TYPE', message: 'Unknown or unavailable appointment type' });
    return t;
  }

  /** Practitioners who work at a store (they have a weekly schedule there). */
  async practitioners(storeId: string) {
    const rows = await this.prisma.db.practitionerAvailability.findMany({ where: { storeId, isActive: true, practitioner: { status: 'ACTIVE', type: 'STAFF', deletedAt: null } }, include: { practitioner: { select: { id: true, firstName: true, lastName: true } } } });
    return [...new Map(rows.map((r) => [r.practitionerId, r.practitioner])).values()];
  }

  /** Staff of a store with whether they take appointments there (the admin uses this to set up schedules). */
  async staffForStore(storeId: string, user: AuthUser) {
    assertStoreAccess(user, storeId);
    const [staff, scheduled] = await Promise.all([
      this.prisma.db.user.findMany({ where: { type: 'STAFF', status: 'ACTIVE', OR: [{ isSuperAdmin: true }, { stores: { some: { storeId, deletedAt: null } } }] }, select: { id: true, firstName: true, lastName: true, roles: { where: { deletedAt: null }, select: { role: { select: { code: true } } } } }, orderBy: { firstName: 'asc' } }),
      this.prisma.db.practitionerAvailability.findMany({ where: { storeId, isActive: true }, select: { practitionerId: true }, distinct: ['practitionerId'] }),
    ]);
    const has = new Set(scheduled.map((r) => r.practitionerId));
    return staff.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, roles: u.roles.map((r) => r.role.code), hasSchedule: has.has(u.id) }));
  }

  /** Free start times per day. Several practitioners may offer the same start; the customer sees one slot and the store assigns whoever is free. */
  async slots(dto: D.SlotsQueryDto, opts: { publicOnly: boolean }) {
    const store = await this.store(dto.storeId, opts.publicOnly);
    const type = await this.type(dto.typeId, opts.publicOnly);
    if (!isDate(dto.from) || (dto.to && !isDate(dto.to))) throw new BadRequestException('Dates must be YYYY-MM-DD');
    const tz = store.timezone;
    const noticeH = await this.settings.value<number>('min_notice_hours', 2, store.id);
    const horizon = await this.settings.value<number>('max_days_ahead', 60, store.id);
    const now = new Date();
    const earliest = new Date(now.getTime() + noticeH * 3_600_000);
    const days = this.days(dto.from, dto.to ?? undefined);
    const last = localDate(new Date(now.getTime() + horizon * 86_400_000), tz);
    const todayLocal = localDate(now, tz);

    const people = (await this.practitioners(store.id)).filter((p) => !dto.practitionerId || p.id === dto.practitionerId);
    if (!people.length) return { storeId: store.id, timezone: tz, durationMin: type.durationMin, days: days.map((date) => ({ date, slots: [] })) };
    const rules = await this.prisma.db.practitionerAvailability.findMany({ where: { storeId: store.id, isActive: true, practitionerId: { in: people.map((p) => p.id) } } });
    const wideFrom = new Date(`${days[0]}T00:00:00Z`).getTime() - 86_400_000, wideTo = new Date(`${days[days.length - 1]}T00:00:00Z`).getTime() + 2 * 86_400_000;
    const [booked, off] = await Promise.all([
      this.prisma.db.appointment.findMany({ where: { practitionerId: { in: people.map((p) => p.id) }, status: { in: [...ACTIVE] }, startsAt: { lt: new Date(wideTo) }, endsAt: { gt: new Date(wideFrom) } }, include: { type: { select: { bufferMin: true } } } }),
      this.prisma.db.practitionerTimeOff.findMany({ where: { practitionerId: { in: people.map((p) => p.id) }, startsAt: { lt: new Date(wideTo) }, endsAt: { gt: new Date(wideFrom) } } }),
    ]);
    const busyOf = (pid: string): Busy[] => [
      ...booked.filter((a) => a.practitionerId === pid).map((a) => ({ start: a.startsAt, end: new Date(a.endsAt.getTime() + a.type.bufferMin * 60_000) })),
      ...off.filter((t) => t.practitionerId === pid).map((t) => ({ start: t.startsAt, end: t.endsAt })),
    ];

    const out = days.map((date) => {
      if (date < todayLocal || date > last) return { date, slots: [] };
      const byStart = new Map<number, string[]>();
      for (const p of people) {
        const mine = rules.filter((r) => r.practitionerId === p.id) as Rule[];
        for (const s of slotsForDay({ date, tz, rules: mine, durationMin: type.durationMin, bufferMin: type.bufferMin, busy: busyOf(p.id), earliest })) {
          byStart.set(s.getTime(), [...(byStart.get(s.getTime()) ?? []), p.id]);
        }
      }
      return { date, slots: [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([t, ids]) => ({ startsAt: new Date(t).toISOString(), endsAt: new Date(t + type.durationMin * 60_000).toISOString(), practitionerIds: ids })) };
    });
    return { storeId: store.id, timezone: tz, durationMin: type.durationMin, days: out };
  }

  private days(from: string, to?: string) {
    const start = new Date(`${from}T00:00:00Z`).getTime();
    const end = to ? new Date(`${to}T00:00:00Z`).getTime() : start + 6 * 86_400_000;
    if (end < start) throw new BadRequestException('`to` must not be before `from`');
    if ((end - start) / 86_400_000 > 30) throw new BadRequestException({ code: 'RANGE_TOO_LARGE', message: 'Ask for at most 31 days at a time' });
    const out: string[] = [];
    for (let t = start; t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  }

  // ------------------------------------------------------------------ booking
  private async assertFree(tx: Tx, practitionerId: string, start: Date, end: Date, bufferMin: number, excludeId?: string) {
    // serialise bookings per practitioner: two people picking the same slot at the same instant cannot both win
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'appt:' + practitionerId}))`;
    const occupyEnd = new Date(end.getTime() + bufferMin * 60_000);
    const around = await tx.appointment.findMany({ where: { practitionerId, deletedAt: null, status: { in: [...ACTIVE] }, ...(excludeId ? { id: { not: excludeId } } : {}), startsAt: { lt: new Date(occupyEnd.getTime() + 24 * 3_600_000) }, endsAt: { gt: new Date(start.getTime() - 24 * 3_600_000) } }, include: { type: { select: { bufferMin: true } } } });
    const clash = around.some((a) => start < new Date(a.endsAt.getTime() + a.type.bufferMin * 60_000) && occupyEnd > a.startsAt);
    if (clash) throw new ConflictException({ code: 'SLOT_TAKEN', message: 'That time was just taken: please pick another' });
  }

  /** Public/account booking: the start must be one of the offered slots (so availability, notice and horizon all apply). */
  async book(dto: D.BookDto, user: AuthUser | null) {
    const store = await this.store(dto.storeId, true);
    const type = await this.type(dto.typeId, true);
    if (!user?.customerId && !dto.guest) throw new BadRequestException({ code: 'CONTACT_REQUIRED', message: 'Your name, email and phone are required' });
    const date = localDate(dto.startsAt, store.timezone);
    const offered = await this.slots({ typeId: type.id, storeId: store.id, from: date, to: date, practitionerId: dto.practitionerId }, { publicOnly: true });
    const slot = offered.days[0]?.slots.find((s) => new Date(s.startsAt).getTime() === dto.startsAt.getTime());
    if (!slot) throw new ConflictException({ code: 'SLOT_UNAVAILABLE', message: 'That time is not available: please pick another' });
    const customer = user?.customerId ? await this.prisma.db.customer.findFirst({ where: { id: user.customerId } }) : null;
    const contactEmail = (customer?.email ?? dto.guest?.email ?? '').toLowerCase();
    const contactPhone = customer?.phone ?? dto.guest?.phone ?? '';
    await this.assertNotSpamming(customer?.id ?? null, contactEmail, contactPhone);
    const auto = await this.settings.value<boolean>('auto_confirm', true, store.id);

    // try the offered practitioners in turn (the first may be taken by a racing request)
    let lastErr: unknown;
    for (const pid of slot.practitionerIds) {
      try {
        const id = await this.prisma.raw.$transaction(async (tx) => {
          const end = new Date(dto.startsAt.getTime() + type.durationMin * 60_000);
          await this.assertFree(tx, pid, dto.startsAt, end, type.bufferMin);
          const number = await this.numbering.next(tx, store.id, 'APPOINTMENT');
          return (await tx.appointment.create({
            data: {
              storeId: store.id, number, typeId: type.id, practitionerId: pid, customerId: customer?.id ?? null, status: auto ? 'CONFIRMED' : 'PENDING', source: 'ONLINE', startsAt: dto.startsAt, endsAt: end,
              guestName: customer ? null : dto.guest!.name, guestEmail: customer ? null : contactEmail, guestPhone: customer ? null : contactPhone, reason: dto.reason, confirmedAt: auto ? new Date() : null,
            },
          })).id;
        });
        const a = await this.prisma.raw.appointment.findUniqueOrThrow({ where: { id }, include: INCLUDE });
        await this.confirmationEmail(a, store, customer?.firstName ?? dto.guest?.name.split(' ')[0] ?? '', contactEmail, dto.locale).catch(() => undefined);
        return this.publicView(a, store);
      } catch (e) { lastErr = e; if ((e as { response?: { code?: string } })?.response?.code !== 'SLOT_TAKEN') throw e; }
    }
    throw lastErr;
  }

  private async assertNotSpamming(customerId: string | null, email: string, phone: string) {
    const now = new Date();
    const mine = await this.prisma.db.appointment.count({
      where: { status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gt: now }, OR: [...(customerId ? [{ customerId }] : []), ...(email ? [{ guestEmail: { equals: email, mode: 'insensitive' as const } }] : []), ...(phone ? [{ guestPhone: phone }] : [])] },
    });
    if (mine >= MAX_UPCOMING_PER_CONTACT) throw new ConflictException({ code: 'TOO_MANY_APPOINTMENTS', message: `You already have ${MAX_UPCOMING_PER_CONTACT} upcoming appointments: cancel one or call the store` });
  }

  private publicView(a: any, store?: { name: string; address?: string | null; city?: string | null; phone?: string | null; timezone?: string }) {
    return {
      id: a.id, number: a.number, status: a.status, startsAt: a.startsAt, endsAt: a.endsAt, reason: a.reason, type: { name: a.type.name, durationMin: a.type.durationMin },
      practitioner: a.practitioner ? `${a.practitioner.firstName} ${a.practitioner.lastName}` : null, store: store ? { name: store.name, address: store.address, city: store.city, phone: store.phone, timezone: store.timezone } : undefined,
    };
  }

  private async confirmationEmail(a: { startsAt: Date; storeId: string }, store: { name: string; timezone: string }, firstName: string, email: string, locale = 'fr') {
    if (!email) return;
    const tz = store.timezone;
    const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-MA' : locale, { timeZone: tz, dateStyle: 'full' }).format(a.startsAt);
    const time = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-MA' : locale, { timeZone: tz, timeStyle: 'short' }).format(a.startsAt);
    await this.mail.add('appointment_confirmation', { to: email, template: 'appointment_confirmation', locale, data: { firstName, date, time, storeName: store.name } });
  }

  // ------------------------------------------------------------------ customer self-service
  private matches(a: { customer: { email: string | null; phone: string | null } | null; guestEmail: string | null; guestPhone: string | null }, contact: string) {
    const c = contact.trim().toLowerCase(), digits = c.replace(/\D/g, '');
    const emails = [a.guestEmail, a.customer?.email].filter(Boolean).map((x) => x!.toLowerCase());
    const phones = [a.guestPhone, a.customer?.phone].filter(Boolean).map((x) => x!.replace(/\D/g, ''));
    return emails.includes(c) || (digits.length >= 6 && phones.includes(digits));
  }

  private async byNumber(number: string, contact: string) {
    const a = await this.prisma.raw.appointment.findFirst({ where: { number: { equals: number.trim(), mode: 'insensitive' }, deletedAt: null }, include: INCLUDE });
    if (!a || !this.matches(a, contact)) throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'No appointment matches these details' });
    return a;
  }

  async lookup(dto: D.LookupDto) {
    const a = await this.byNumber(dto.number, dto.contact);
    return this.publicView(a, (await this.prisma.raw.store.findUnique({ where: { id: a.storeId } })) ?? undefined);
  }

  async cancelByContact(dto: D.LookupDto) {
    const a = await this.byNumber(dto.number, dto.contact);
    return this.customerCancel(a.id);
  }

  async mine(user: AuthUser) {
    const rows = await this.prisma.db.appointment.findMany({ where: { customerId: user.customerId! }, orderBy: { startsAt: 'desc' }, take: 50, include: INCLUDE });
    const stores = new Map((await this.prisma.raw.store.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.storeId))] } } })).map((s) => [s.id, s]));
    return rows.map((a) => this.publicView(a, stores.get(a.storeId)));
  }

  async cancelMine(user: AuthUser, number: string) {
    const a = await this.prisma.db.appointment.findFirst({ where: { number, customerId: user.customerId! } });
    if (!a) throw new NotFoundException('Appointment not found');
    return this.customerCancel(a.id);
  }

  private async customerCancel(id: string) {
    const a = await this.prisma.raw.appointment.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    if (!['PENDING', 'CONFIRMED'].includes(a.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `This appointment is ${a.status}` });
    const hours = await this.settings.value<number>('cancel_hours', 2, a.storeId);
    if (a.startsAt.getTime() - Date.now() < hours * 3_600_000) throw new ConflictException({ code: 'TOO_LATE', message: `Appointments can be cancelled online up to ${hours} h before: please call the store`, details: { hours } });
    const u = await this.prisma.raw.appointment.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Cancelled by the customer' }, include: INCLUDE });
    return this.publicView(u);
  }

  // ------------------------------------------------------------------ staff
  private async mustGet(id: string, user: AuthUser) {
    const a = await this.prisma.db.appointment.findFirst({ where: { id } });
    if (!a) throw new NotFoundException('Appointment not found');
    assertStoreAccess(user, a.storeId);
    return a;
  }

  async get(id: string, user: AuthUser) {
    await this.mustGet(id, user);
    return this.prisma.db.appointment.findFirstOrThrow({ where: { id }, include: INCLUDE });
  }

  async list(dto: D.ListAppointmentsDto, user: AuthUser) {
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const s = dto.search?.trim();
    const where: Record<string, any> = {
      ...(stores && { storeId: { in: stores } }), ...(dto.practitionerId && { practitionerId: dto.practitionerId }), ...(dto.customerId && { customerId: dto.customerId }), ...(dto.status && { status: dto.status }),
      ...((dto.from || dto.to) && { startsAt: { ...(dto.from && { gte: dto.from }), ...(dto.to && { lte: dto.to }) } }),
      ...(s && { OR: [{ number: { contains: s, mode: 'insensitive' } }, { guestName: { contains: s, mode: 'insensitive' } }, { guestPhone: { contains: s } }, { customer: { OR: [{ firstName: { contains: s, mode: 'insensitive' } }, { lastName: { contains: s, mode: 'insensitive' } }, { phone: { contains: s } }] } }] }),
    };
    return paginate(this.prisma.db.appointment, dto, { where, include: INCLUDE, sortable: ['startsAt', 'createdAt', 'number'], defaultSort: 'startsAt' });
  }

  /** Everything in a date range for the calendar (no pagination, capped at 35 days). */
  async calendar(dto: D.CalendarQueryDto, user: AuthUser) {
    if (dto.to.getTime() - dto.from.getTime() > 35 * 86_400_000) throw new BadRequestException({ code: 'RANGE_TOO_LARGE', message: 'At most 35 days' });
    const stores = dto.storeId ? (assertStoreAccess(user, dto.storeId), [dto.storeId]) : visibleStoreIds(user);
    const where = { ...(stores && { storeId: { in: stores } }), ...(dto.practitionerId && { practitionerId: dto.practitionerId }), startsAt: { gte: dto.from, lt: dto.to }, status: { not: 'CANCELLED' as const } };
    const [appointments, timeOff] = await Promise.all([
      this.prisma.db.appointment.findMany({ where, include: INCLUDE, orderBy: { startsAt: 'asc' }, take: 1000 }),
      this.prisma.db.practitionerTimeOff.findMany({ where: { ...(dto.practitionerId && { practitionerId: dto.practitionerId }), startsAt: { lt: dto.to }, endsAt: { gt: dto.from } }, take: 200 }),
    ]);
    return { appointments, timeOff };
  }

  async staffBook(dto: D.StaffBookDto, user: AuthUser) {
    assertStoreAccess(user, dto.storeId);
    const store = await this.store(dto.storeId);
    const type = await this.type(dto.typeId, false);
    if (!dto.customerId && !dto.guest) throw new BadRequestException({ code: 'CONTACT_REQUIRED', message: 'Pick a customer or enter the visitor’s details' });
    if (dto.customerId && !(await this.prisma.db.customer.findFirst({ where: { id: dto.customerId } }))) throw new BadRequestException('Unknown customer');
    const people = await this.practitioners(store.id);
    if (dto.practitionerId && !people.some((p) => p.id === dto.practitionerId)) throw new BadRequestException({ code: 'UNKNOWN_PRACTITIONER', message: 'That person does not take appointments in this store' });
    const end = new Date(dto.startsAt.getTime() + type.durationMin * 60_000);
    const candidates = dto.practitionerId ? [dto.practitionerId] : people.map((p) => p.id);
    if (!candidates.length) throw new ConflictException({ code: 'NO_PRACTITIONER', message: 'Nobody has a schedule in this store yet' });
    let lastErr: unknown;
    for (const pid of candidates) {
      try {
        const id = await this.prisma.raw.$transaction(async (tx) => {
          await this.assertFree(tx, pid, dto.startsAt, end, type.bufferMin);
          const number = await this.numbering.next(tx, store.id, 'APPOINTMENT');
          return (await tx.appointment.create({ data: { storeId: store.id, number, typeId: type.id, practitionerId: pid, customerId: dto.customerId ?? null, status: 'CONFIRMED', source: dto.source ?? 'STAFF', startsAt: dto.startsAt, endsAt: end, guestName: dto.guest?.name, guestEmail: dto.guest?.email.toLowerCase(), guestPhone: dto.guest?.phone, reason: dto.reason, notes: dto.notes, confirmedAt: new Date() } })).id;
        });
        const a = await this.get(id, user);
        const email = a.customer?.email ?? a.guestEmail ?? '';
        await this.confirmationEmail(a, store, a.customer?.firstName ?? a.guestName?.split(' ')[0] ?? '', email).catch(() => undefined);
        return a;
      } catch (e) { lastErr = e; if ((e as { response?: { code?: string } })?.response?.code !== 'SLOT_TAKEN') throw e; }
    }
    throw lastErr;
  }

  async update(id: string, dto: D.UpdateAppointmentDto, user: AuthUser) {
    const a = await this.mustGet(id, user);
    if (!['PENDING', 'CONFIRMED'].includes(a.status)) throw new ConflictException({ code: 'INVALID_STATE', message: `A ${a.status} appointment cannot be changed` });
    const type = await this.prisma.db.appointmentType.findFirstOrThrow({ where: { id: a.typeId } });
    const start = dto.startsAt ?? a.startsAt;
    const end = new Date(start.getTime() + type.durationMin * 60_000);
    const pid = dto.practitionerId ?? a.practitionerId;
    if (dto.practitionerId && !(await this.practitioners(a.storeId)).some((p) => p.id === dto.practitionerId)) throw new BadRequestException({ code: 'UNKNOWN_PRACTITIONER', message: 'That person does not take appointments in this store' });
    await this.prisma.raw.$transaction(async (tx) => {
      if (pid && (dto.startsAt || dto.practitionerId)) await this.assertFree(tx, pid, start, end, type.bufferMin, id);
      await tx.appointment.update({ where: { id }, data: { startsAt: start, endsAt: end, practitionerId: pid, reason: dto.reason, notes: dto.notes } });
    });
    return this.get(id, user);
  }

  async status(id: string, dto: D.AppointmentStatusDto, user: AuthUser) {
    const a = await this.mustGet(id, user);
    if (!NEXT[a.status].includes(dto.to)) throw new ConflictException({ code: 'INVALID_TRANSITION', message: `An appointment cannot go from ${a.status} to ${dto.to}`, details: { allowed: NEXT[a.status] } });
    if (dto.resultPrescriptionId) {
      if (dto.to !== 'COMPLETED') throw new BadRequestException('A prescription can only be linked when completing');
      if (!a.customerId || !(await this.prisma.db.prescription.findFirst({ where: { id: dto.resultPrescriptionId, customerId: a.customerId } }))) throw new BadRequestException({ code: 'PRESCRIPTION_NOT_FOUND', message: "That prescription does not belong to this appointment's customer" });
    }
    await this.prisma.raw.appointment.update({
      where: { id },
      data: { status: dto.to as 'CONFIRMED', ...(dto.to === 'CONFIRMED' && { confirmedAt: new Date() }), ...(dto.to === 'CANCELLED' && { cancelledAt: new Date(), cancelReason: dto.reason ?? 'Cancelled by the store' }), ...(dto.resultPrescriptionId && { resultPrescriptionId: dto.resultPrescriptionId }) },
    });
    return this.get(id, user);
  }

  // ------------------------------------------------------------------ schedules
  async availability(practitionerId: string, user: AuthUser) {
    const stores = visibleStoreIds(user);
    return this.prisma.db.practitionerAvailability.findMany({ where: { practitionerId, ...(stores && { storeId: { in: stores } }) }, orderBy: [{ storeId: 'asc' }, { weekday: 'asc' }, { startTime: 'asc' }] });
  }

  async setAvailability(practitionerId: string, dto: D.SetAvailabilityDto, user: AuthUser) {
    assertStoreAccess(user, dto.storeId);
    await this.store(dto.storeId);
    const who = await this.prisma.db.user.findFirst({ where: { id: practitionerId, type: 'STAFF', status: 'ACTIVE' }, include: { stores: true } });
    if (!who || (!who.isSuperAdmin && !who.stores.some((s) => s.storeId === dto.storeId))) throw new BadRequestException({ code: 'INVALID_PRACTITIONER', message: 'That person does not work in this store' });
    for (const r of dto.rules) if (minutes(r.startTime) >= minutes(r.endTime)) throw new BadRequestException({ code: 'INVALID_HOURS', message: 'A window must end after it starts', details: { weekday: r.weekday } });
    for (const [i, a] of dto.rules.entries()) for (const b of dto.rules.slice(i + 1)) if (a.weekday === b.weekday && minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime)) throw new BadRequestException({ code: 'OVERLAPPING_HOURS', message: 'Two windows on the same day overlap', details: { weekday: a.weekday } });
    await this.prisma.raw.$transaction([
      this.prisma.raw.practitionerAvailability.updateMany({ where: { practitionerId, storeId: dto.storeId, deletedAt: null }, data: { deletedAt: new Date(), isActive: false } }),
      this.prisma.raw.practitionerAvailability.createMany({ data: dto.rules.map((r) => ({ practitionerId, storeId: dto.storeId, weekday: r.weekday, startTime: r.startTime, endTime: r.endTime })) }),
    ]);
    return this.availability(practitionerId, user);
  }

  timeOff(practitionerId: string) { return this.prisma.db.practitionerTimeOff.findMany({ where: { practitionerId, endsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } }); }

  async addTimeOff(practitionerId: string, dto: D.TimeOffDto) {
    if (dto.endsAt <= dto.startsAt) throw new BadRequestException({ code: 'INVALID_RANGE', message: 'The end must be after the start' });
    if (!(await this.prisma.db.user.findFirst({ where: { id: practitionerId, type: 'STAFF' } }))) throw new NotFoundException('Practitioner not found');
    const conflicts = await this.prisma.db.appointment.count({ where: { practitionerId, status: { in: [...ACTIVE] }, startsAt: { lt: dto.endsAt }, endsAt: { gt: dto.startsAt } } });
    const row = await this.prisma.raw.practitionerTimeOff.create({ data: { practitionerId, startsAt: dto.startsAt, endsAt: dto.endsAt, reason: dto.reason } });
    return { ...row, conflictingAppointments: conflicts }; // existing bookings are not cancelled automatically: the store decides
  }

  async removeTimeOff(id: string) {
    const t = await this.prisma.db.practitionerTimeOff.findFirst({ where: { id } });
    if (!t) throw new NotFoundException('Time off not found');
    await this.prisma.raw.practitionerTimeOff.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ------------------------------------------------------------------ reminders
  /** Emails customers whose confirmed appointment starts in the next ~24 h (run hourly; each appointment is reminded once). */
  async sendReminders(now = new Date()) {
    const due = await this.prisma.raw.appointment.findMany({
      where: { deletedAt: null, status: 'CONFIRMED', reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + 24 * 3_600_000) } },
      include: { customer: true },
    });
    let sent = 0;
    for (const a of due) {
      const email = a.customer?.email ?? a.guestEmail;
      const store = await this.prisma.raw.store.findUnique({ where: { id: a.storeId } });
      // claim first, so an overlapping run cannot send the same reminder twice
      const claimed = await this.prisma.raw.appointment.updateMany({ where: { id: a.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (!claimed.count || !email || !store) continue;
      const locale = 'fr';
      const date = new Intl.DateTimeFormat(locale, { timeZone: store.timezone, dateStyle: 'full' }).format(a.startsAt);
      const time = new Intl.DateTimeFormat(locale, { timeZone: store.timezone, timeStyle: 'short' }).format(a.startsAt);
      await this.mail.add('appointment_reminder', { to: email, template: 'appointment_reminder', locale, data: { firstName: a.customer?.firstName ?? a.guestName?.split(' ')[0] ?? '', date, time, storeName: store.name } });
      sent++;
    }
    return { sent };
  }
}
