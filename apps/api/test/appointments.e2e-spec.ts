import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app';
import { setupSales } from './sales-helpers';
import { loginAs, uid } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppointmentsService } from '../src/modules/appointments/appointments.service';

type F = Awaited<ReturnType<typeof setupSales>>;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 86_400_000);

describe('Appointments (e2e)', () => {
  let app: INestApplication;
  let f: F;
  let prisma: PrismaService;
  let casa: string;
  let examId: string;
  let opticianId: string;
  let opt: Awaited<ReturnType<typeof loginAs>>;
  const srv = () => app.getHttpServer();
  const anon = {
    get: (p: string) => request(srv()).get(`/api/v1${p}`),
    post: (p: string, b?: object) => request(srv()).post(`/api/v1${p}`).send(b),
  };
  const guest = (n = uid()) => ({ name: 'Hamza Visitor', email: `hamza-${n}@example.com`, phone: `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}` });

  beforeAll(async () => {
    app = await createTestApp(); f = await setupSales(app); prisma = app.get(PrismaService);
    opt = await loginAs(app, 'optician');
    casa = f.cashier.user.stores[0].id;
    examId = (await prisma.raw.appointmentType.findFirstOrThrow({ where: { bookableOnline: true, isActive: true } })).id;
    opticianId = (await prisma.raw.user.findUniqueOrThrow({ where: { email: 'optician@mizmar.local' } })).id;
    // a clean, predictable week for the optician: every day 09:00-12:00, no old bookings or time off
    await prisma.raw.appointment.updateMany({ where: { storeId: casa, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] } }, data: { status: 'CANCELLED' } });
    await prisma.raw.practitionerTimeOff.deleteMany({ where: { practitionerId: opticianId } });
    await f.admin.put(`/practitioners/${opticianId}/availability`, { storeId: casa, rules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '09:00', endTime: '12:00' })) }).expect(200);
    await prisma.raw.appointmentType.update({ where: { id: examId }, data: { durationMin: 30, bufferMin: 0, bookableOnline: true } });
  });
  afterAll(async () => { await app.close(); });

  /** First free slot at least `days` days from now. */
  async function firstSlot(days = 3, typeId = examId) {
    const from = iso(addDays(days));
    const r = (await anon.get(`/public/appointments/slots?typeId=${typeId}&storeId=${casa}&from=${from}&to=${iso(addDays(days + 3))}`).expect(200)).body;
    const day = r.days.find((d: { slots: unknown[] }) => d.slots.length);
    return { slots: day.slots as { startsAt: string; practitionerIds: string[] }[], date: day.date as string, tz: r.timezone as string };
  }

  describe('availability', () => {
    it('lists free slots in the store timezone for bookable types only', async () => {
      const { slots } = await firstSlot();
      expect(slots.length).toBeGreaterThanOrEqual(6); // 09:00-12:00 in 30-minute steps
      expect(slots[0].practitionerIds).toContain(opticianId);
      const types = (await anon.get('/public/appointments/types').expect(200)).body;
      expect(types.length).toBeGreaterThan(0);
      expect(types.find((t: { id: string }) => t.id === examId)).toBeTruthy();
      const hidden = await prisma.raw.appointmentType.create({ data: { code: `INT-${uid()}`.toUpperCase(), name: 'Internal', bookableOnline: false } });
      await anon.get(`/public/appointments/slots?typeId=${hidden.id}&storeId=${casa}&from=${iso(addDays(3))}`).expect(400);
      expect((await anon.get('/public/appointments/types')).body.some((t: { id: string }) => t.id === hidden.id)).toBe(false);
      const staff = (await anon.get(`/public/appointments/practitioners?storeId=${casa}`).expect(200)).body;
      expect(staff.map((p: { id: string }) => p.id)).toContain(opticianId);
      expect(JSON.stringify(staff)).not.toMatch(/email|passwordHash/);
    });

    it('rejects bad ranges and never offers the past or the far future', async () => {
      await anon.get(`/public/appointments/slots?typeId=${examId}&storeId=${casa}&from=2026-02-30`).expect(400);
      await anon.get(`/public/appointments/slots?typeId=${examId}&storeId=${casa}&from=${iso(addDays(3))}&to=${iso(addDays(80))}`).expect(400); // > 31 days
      const past = (await anon.get(`/public/appointments/slots?typeId=${examId}&storeId=${casa}&from=${iso(addDays(-5))}&to=${iso(addDays(-4))}`).expect(200)).body;
      expect(past.days.every((d: { slots: unknown[] }) => d.slots.length === 0)).toBe(true);
      const far = (await anon.get(`/public/appointments/slots?typeId=${examId}&storeId=${casa}&from=${iso(addDays(120))}&to=${iso(addDays(122))}`).expect(200)).body;
      expect(far.days.every((d: { slots: unknown[] }) => d.slots.length === 0)).toBe(true);
    });
  });

  describe('online booking', () => {
    it('a guest books a slot, gets a number, and the slot disappears', async () => {
      const { slots } = await firstSlot(4);
      const slot = slots[0];
      const g = guest();
      const a = (await anon.post('/public/appointments', { typeId: examId, storeId: casa, startsAt: slot.startsAt, guest: g, reason: 'Contrôle annuel' }).expect(201)).body;
      expect(a).toMatchObject({ status: 'CONFIRMED', reason: 'Contrôle annuel' });
      expect(a.number).toMatch(/RDV/);
      const again = await firstSlot(4);
      expect(again.slots.some((s) => s.startsAt === slot.startsAt)).toBe(false);
      const taken = await anon.post('/public/appointments', { typeId: examId, storeId: casa, startsAt: slot.startsAt, guest: guest() });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('SLOT_UNAVAILABLE');
      const row = await prisma.raw.appointment.findFirstOrThrow({ where: { number: a.number } });
      expect(row).toMatchObject({ guestEmail: g.email, source: 'ONLINE', practitionerId: opticianId });
    });

    it('refuses a made-up time, a missing contact, and too many bookings by one person', async () => {
      const { slots, date } = await firstSlot(5);
      await anon.post('/public/appointments', { typeId: examId, storeId: casa, startsAt: `${date}T03:00:00Z`, guest: guest() }).expect(409); // not an offered slot
      expect((await anon.post('/public/appointments', { typeId: examId, storeId: casa, startsAt: slots[0].startsAt }).expect(400)).body.code).toBe('CONTACT_REQUIRED');
      const g = guest();
      for (const s of slots.slice(0, 3)) await anon.post('/public/appointments', { typeId: examId, storeId: casa, startsAt: s.startsAt, guest: g }).expect(201);
      expect((await anon.post('/public/appointments', { typeId: examId, storeId: casa, startsAt: slots[3].startsAt, guest: g }).expect(409)).body.code).toBe('TOO_MANY_APPOINTMENTS');
    });

    it('only one of many simultaneous bookings for the same slot succeeds', async () => {
      const { slots } = await firstSlot(6);
      const slot = slots[slots.length - 1];
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => anon.post('/public/appointments', { typeId: examId, storeId: casa, startsAt: slot.startsAt, guest: guest() }).then((r) => r.status)));
      expect(results.filter((s) => s === 201)).toHaveLength(1);
      expect(results.filter((s) => s === 409)).toHaveLength(4);
      expect(await prisma.raw.appointment.count({ where: { startsAt: new Date(slot.startsAt), storeId: casa, status: { not: 'CANCELLED' } } })).toBe(1);
    });

    it('a second practitioner doubles capacity for the same start time', async () => {
      const manager = (await prisma.raw.user.findUniqueOrThrow({ where: { email: 'manager@mizmar.local' } })).id;
      await f.admin.put(`/practitioners/${manager}/availability`, { storeId: casa, rules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '09:00', endTime: '12:00' })) }).expect(200);
      const { slots } = await firstSlot(7);
      expect(slots[0].practitionerIds).toHaveLength(2);
      const slot = slots[0];
      const r = await Promise.all([1, 2, 3].map(() => anon.post('/public/appointments', { typeId: examId, storeId: casa, startsAt: slot.startsAt, guest: guest() }).then((x) => x.status)));
      expect(r.filter((s) => s === 201)).toHaveLength(2);
      await f.admin.put(`/practitioners/${manager}/availability`, { storeId: casa, rules: [] }).expect(200);
    });

    it('lookup and cancel need the number AND the contact; late cancellation is refused', async () => {
      const { slots } = await firstSlot(8);
      const g = guest();
      const a = (await anon.post('/public/appointments', { typeId: examId, storeId: casa, startsAt: slots[0].startsAt, guest: g }).expect(201)).body;
      expect((await anon.post('/public/appointments/lookup', { number: a.number, contact: g.email.toUpperCase() }).expect(200)).body.number).toBe(a.number);
      expect((await anon.post('/public/appointments/lookup', { number: a.number, contact: g.phone }).expect(200)).body.status).toBe('CONFIRMED');
      await anon.post('/public/appointments/lookup', { number: a.number, contact: 'someone@else.com' }).expect(404);
      await anon.post('/public/appointments/cancel', { number: a.number, contact: 'someone@else.com' }).expect(404);
      expect((await anon.post('/public/appointments/cancel', { number: a.number, contact: g.email }).expect(200)).body.status).toBe('CANCELLED');
      expect((await anon.post('/public/appointments/cancel', { number: a.number, contact: g.email }).expect(409)).body.code).toBe('INVALID_STATE');
      // within the cancellation window: staff create one starting in 30 minutes, the customer cannot cancel it online
      const soon = await prisma.raw.appointment.create({ data: { storeId: casa, number: `RDV-SOON-${uid()}`, typeId: examId, practitionerId: opticianId, status: 'CONFIRMED', source: 'ONLINE', startsAt: new Date(Date.now() + 30 * 60_000), endsAt: new Date(Date.now() + 60 * 60_000), guestName: 'X', guestEmail: g.email, guestPhone: g.phone } });
      expect((await anon.post('/public/appointments/cancel', { number: soon.number, contact: g.email }).expect(409)).body.code).toBe('TOO_LATE');
    });

    it('a signed-in customer books without typing contact details and sees their appointments', async () => {
      const email = `acct-${uid()}@example.com`;
      const reg = (await anon.post('/public/auth/register', { email, password: 'Sup3r-secret!', firstName: 'Lina', lastName: 'Test', phone: '+212600112233' }).expect(201)).body;
      const h = { Authorization: `Bearer ${reg.accessToken}` };
      const { slots } = await firstSlot(9);
      const a = (await request(srv()).post('/api/v1/public/appointments').set(h).send({ typeId: examId, storeId: casa, startsAt: slots[1].startsAt }).expect(201)).body;
      const mine = (await request(srv()).get('/api/v1/account/appointments').set(h).expect(200)).body;
      expect(mine.map((x: { number: string }) => x.number)).toContain(a.number);
      const other = (await anon.post('/public/auth/register', { email: `o-${uid()}@example.com`, password: 'Sup3r-secret!', firstName: 'O', lastName: 'T' }).expect(201)).body;
      expect((await request(srv()).get('/api/v1/account/appointments').set({ Authorization: `Bearer ${other.accessToken}` })).body).toHaveLength(0);
      await request(srv()).post(`/api/v1/account/appointments/${a.number}/cancel`).set({ Authorization: `Bearer ${other.accessToken}` }).expect(404);
      expect((await request(srv()).post(`/api/v1/account/appointments/${a.number}/cancel`).set(h).expect(200)).body.status).toBe('CANCELLED');
      expect((await request(srv()).get('/api/v1/appointments').set(h)).body.code).toBe('CUSTOMER_FORBIDDEN');
    });
  });

  describe('staff', () => {
    it('book for a walk-in or a customer, reschedule, move through the visit, link the prescription', async () => {
      const { slots } = await firstSlot(10);
      const customer = (await f.admin.post('/customers', { firstName: 'Zineb', lastName: `Rdv${uid()}`, phone: `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}` }).expect(201)).body;
      const a = (await opt.post('/appointments', { typeId: examId, storeId: casa, startsAt: slots[0].startsAt, customerId: customer.id, source: 'PHONE' }).expect(201)).body;
      expect(a).toMatchObject({ status: 'CONFIRMED', source: 'PHONE', practitionerId: opticianId });
      await f.technician.get('/appointments').expect(403);
      await opt.post('/appointments', { typeId: examId, storeId: casa, startsAt: slots[0].startsAt, guest: guest() }).expect(409); // that practitioner is busy
      const moved = (await opt.patch(`/appointments/${a.id}`, { startsAt: slots[2].startsAt, notes: 'Préfère le matin' }).expect(200)).body;
      expect(new Date(moved.startsAt).toISOString()).toBe(slots[2].startsAt);
      await opt.patch(`/appointments/${a.id}`, { startsAt: slots[0].startsAt }).expect(200); // back to the (now free) first slot
      await opt.post(`/appointments/${a.id}/status`, { to: 'COMPLETED' }).expect(409); // must check in first
      await opt.post(`/appointments/${a.id}/status`, { to: 'CHECKED_IN' }).expect(200);
      const rx = (await f.admin.post(`/customers/${customer.id}/prescriptions`, { issuedAt: '2026-10-05', odSph: -1, osSph: -1.25 }).expect(201)).body;
      const stranger = (await f.admin.post('/customers', { firstName: 'Other', lastName: `Rdv${uid()}`, phone: `+2126${Math.floor(10_000_000 + Math.random() * 89_999_999)}` }).expect(201)).body;
      const strangerRx = (await f.admin.post(`/customers/${stranger.id}/prescriptions`, { issuedAt: '2026-10-05', odSph: -3 }).expect(201)).body;
      expect((await opt.post(`/appointments/${a.id}/status`, { to: 'COMPLETED', resultPrescriptionId: strangerRx.id }).expect(400)).body.code).toBe('PRESCRIPTION_NOT_FOUND');
      const done = (await opt.post(`/appointments/${a.id}/status`, { to: 'COMPLETED', resultPrescriptionId: rx.id }).expect(200)).body;
      expect(done).toMatchObject({ status: 'COMPLETED', resultPrescriptionId: rx.id });
      await opt.patch(`/appointments/${a.id}`, { notes: 'late' }).expect(409); // completed visits are history
      await opt.post(`/appointments/${a.id}/status`, { to: 'CANCELLED' }).expect(409);
    });

    it('calendar view, filters, and time off blocks bookings', async () => {
      const day = firstDate(12);
      const from = new Date(`${day}T00:00:00Z`), to = new Date(from.getTime() + 86_400_000);
      const { slots } = await anonSlots(day);
      const a = (await f.admin.post('/appointments', { typeId: examId, storeId: casa, startsAt: slots[0], guest: guest(), practitionerId: opticianId }).expect(201)).body;
      const cal = (await opt.get(`/appointments/calendar?from=${from.toISOString()}&to=${new Date(to.getTime() + 86_400_000).toISOString()}&storeId=${casa}`).expect(200)).body;
      expect(cal.appointments.map((x: { id: string }) => x.id)).toContain(a.id);
      await opt.get(`/appointments/calendar?from=${from.toISOString()}&to=${new Date(from.getTime() + 60 * 86_400_000).toISOString()}`).expect(400);
      expect((await opt.get(`/appointments?status=CONFIRMED&practitionerId=${opticianId}&storeId=${casa}`).expect(200)).body.data.length).toBeGreaterThan(0);

      const off = (await f.admin.post(`/practitioners/${opticianId}/time-off`, { startsAt: from.toISOString(), endsAt: new Date(from.getTime() + 2 * 86_400_000).toISOString(), reason: 'Congrès' }).expect(201)).body;
      expect(off.conflictingAppointments).toBeGreaterThanOrEqual(1);
      expect((await anonSlots(day)).slots).toHaveLength(0);
      await f.admin.del(`/time-off/${off.id}`).expect(204);
      expect((await anonSlots(day)).slots.length).toBeGreaterThan(0);
      await f.admin.post('/practitioners/' + opticianId + '/time-off', { startsAt: to.toISOString(), endsAt: from.toISOString() }).expect(400);
    });

    it('schedules are validated and replaced as a whole', async () => {
      await f.admin.put(`/practitioners/${opticianId}/availability`, { storeId: casa, rules: [{ weekday: 1, startTime: '12:00', endTime: '09:00' }] }).expect(400);
      expect((await f.admin.put(`/practitioners/${opticianId}/availability`, { storeId: casa, rules: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }, { weekday: 1, startTime: '11:00', endTime: '13:00' }] }).expect(400)).body.code).toBe('OVERLAPPING_HOURS');
      await f.admin.put(`/practitioners/${opticianId}/availability`, { storeId: casa, rules: [{ weekday: 1, startTime: '9:00', endTime: '12:00' }] }).expect(400); // HH:MM
      await opt.put(`/practitioners/${opticianId}/availability`, { storeId: casa, rules: [] }).expect(200); // the optician has appointments:update
      await f.technician.put(`/practitioners/${opticianId}/availability`, { storeId: casa, rules: [] }).expect(403);
      expect((await f.admin.get(`/practitioners/${opticianId}/availability`).expect(200)).body).toHaveLength(0);
      const staff = (await f.admin.get(`/appointments/staff?storeId=${casa}`).expect(200)).body;
      expect(staff.find((s: { id: string }) => s.id === opticianId).hasSchedule).toBe(false);
      await f.admin.put(`/practitioners/${opticianId}/availability`, { storeId: casa, rules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '09:00', endTime: '12:00' })) }).expect(200);
    });

    it('appointment types: unique code, delete blocked when used', async () => {
      const code = `T${uid()}`.toUpperCase().slice(0, 12);
      const t = (await f.admin.post('/appointment-types', { code, name: 'Test type', durationMin: 45, bufferMin: 10, price: 100 }).expect(201)).body;
      await f.admin.post('/appointment-types', { code, name: 'Dup' }).expect(409);
      await f.technician.post('/appointment-types', { code: 'ZZZ1', name: 'x' }).expect(403);
      expect((await f.admin.del(`/appointment-types/${t.id}`)).status).toBe(204);
      expect((await f.admin.del(`/appointment-types/${examId}`)).status).toBe(409);
    });

    it('reminders go out once, for confirmed appointments in the next 24 hours', async () => {
      const svc = app.get(AppointmentsService);
      await prisma.raw.appointment.updateMany({ where: { reminderSentAt: null }, data: { reminderSentAt: new Date() } }); // earlier tests' bookings
      const soon = await prisma.raw.appointment.create({ data: { storeId: casa, number: `RDV-REM-${uid()}`, typeId: examId, practitionerId: opticianId, status: 'CONFIRMED', source: 'ONLINE', startsAt: new Date(Date.now() + 5 * 3_600_000), endsAt: new Date(Date.now() + 6 * 3_600_000), guestName: 'R', guestEmail: 'r@example.com', guestPhone: '+212600000000' } });
      await prisma.raw.appointment.create({ data: { storeId: casa, number: `RDV-FAR-${uid()}`, typeId: examId, practitionerId: opticianId, status: 'CONFIRMED', source: 'ONLINE', startsAt: new Date(Date.now() + 72 * 3_600_000), endsAt: new Date(Date.now() + 73 * 3_600_000), guestName: 'F', guestEmail: 'f@example.com', guestPhone: '+212600000001' } });
      await prisma.raw.appointment.create({ data: { storeId: casa, number: `RDV-CAN-${uid()}`, typeId: examId, practitionerId: opticianId, status: 'CANCELLED', source: 'ONLINE', startsAt: new Date(Date.now() + 4 * 3_600_000), endsAt: new Date(Date.now() + 5 * 3_600_000), guestName: 'C', guestEmail: 'c@example.com', guestPhone: '+212600000002' } });
      expect(await svc.sendReminders()).toEqual({ sent: 1 });
      expect(await svc.sendReminders()).toEqual({ sent: 0 }); // not twice
      expect((await prisma.raw.appointment.findUniqueOrThrow({ where: { id: soon.id } })).reminderSentAt).toBeTruthy();
    });
  });

  // helpers that need the app (declared after use in tests above; hoisted function declarations)
  function firstDate(days: number) { return iso(addDays(days)); }
  async function anonSlots(date: string) {
    const r = (await anon.get(`/public/appointments/slots?typeId=${examId}&storeId=${casa}&from=${date}&to=${date}`).expect(200)).body;
    return { slots: r.days[0].slots.map((s: { startsAt: string }) => s.startsAt) as string[] };
  }
});
