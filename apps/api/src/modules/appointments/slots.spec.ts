import { isDate, localDate, overlaps, slotsForDay, weekdayOf, zonedToUtc } from './slots';

const TZ = 'Asia/Karachi'; // fixed UTC+5, no DST: expectations never depend on a government's clock changes
const iso = (d: Date) => d.toISOString();
const rule = { weekday: 1, startTime: '09:00', endTime: '11:00' }; // Monday

describe('slot maths', () => {
  it('converts store wall-clock time to UTC, including across a DST change', () => {
    expect(iso(zonedToUtc('2026-10-05', '09:00', TZ))).toBe('2026-10-05T04:00:00.000Z');
    expect(iso(zonedToUtc('2026-07-01', '15:30', 'UTC'))).toBe('2026-07-01T15:30:00.000Z');
    expect(iso(zonedToUtc('2026-07-01', '15:30', 'Europe/Paris'))).toBe('2026-07-01T13:30:00.000Z'); // summer time
    expect(iso(zonedToUtc('2026-01-15', '15:30', 'Europe/Paris'))).toBe('2026-01-15T14:30:00.000Z'); // winter time
    expect(iso(zonedToUtc('2026-03-29', '09:00', 'Europe/Paris'))).toBe('2026-03-29T07:00:00.000Z'); // the day clocks go forward: 09:00 is already summer time
  });

  it('knows the weekday and validates dates', () => {
    expect(weekdayOf('2026-10-05')).toBe(1);
    expect(weekdayOf('2026-10-04')).toBe(0);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2026-10-05')).toBe(true);
    expect(isDate('05/10/2026')).toBe(false);
    expect(localDate(new Date('2026-10-05T23:30:00Z'), TZ)).toBe('2026-10-06'); // already tomorrow at UTC+5
  });

  it('overlap treats touching ends as free', () => {
    const t = (h: number) => new Date(Date.UTC(2026, 9, 5, h));
    expect(overlaps(t(9), t(10), t(10), t(11))).toBe(false);
    expect(overlaps(t(9), t(10), t(9), t(10))).toBe(true);
    expect(overlaps(t(9), t(11), t(10), t(12))).toBe(true);
  });

  it('lists a 30-minute grid inside the window and respects the day', () => {
    const base = { tz: TZ, rules: [rule], durationMin: 30, bufferMin: 0, busy: [], earliest: new Date(0) };
    const s = slotsForDay({ ...base, date: '2026-10-05' }).map(iso);
    expect(s).toEqual(['2026-10-05T04:00:00.000Z', '2026-10-05T04:30:00.000Z', '2026-10-05T05:00:00.000Z', '2026-10-05T05:30:00.000Z']);
    expect(slotsForDay({ ...base, date: '2026-10-06' })).toEqual([]); // Tuesday: no rule
  });

  it('drops busy times (buffer included), too-early slots, and a last slot that would overrun the window', () => {
    const base = { tz: TZ, rules: [rule], durationMin: 30, bufferMin: 15, earliest: new Date(0), date: '2026-10-05' };
    // 09:00-09:30 local is booked (busy to 09:45 with its buffer). Grid is 45 minutes: 09:00, 09:45, 10:30
    const busy = [{ start: zonedToUtc('2026-10-05', '09:00', TZ), end: zonedToUtc('2026-10-05', '09:45', TZ) }];
    const open = slotsForDay({ ...base, busy }).map(iso);
    expect(open).toEqual(['2026-10-05T04:45:00.000Z', '2026-10-05T05:30:00.000Z']); // 09:45 and 10:30 local
    const late = slotsForDay({ ...base, busy: [], earliest: zonedToUtc('2026-10-05', '09:30', TZ) }).map(iso);
    expect(late).toEqual(['2026-10-05T04:45:00.000Z', '2026-10-05T05:30:00.000Z']); // grid 09:00, 09:45, 10:30 local; from 09:30 on only 09:45 and 10:30 remain
  });

  it('honours validFrom / validTo and split windows', () => {
    const rules = [{ weekday: 1, startTime: '09:00', endTime: '10:00' }, { weekday: 1, startTime: '14:00', endTime: '15:00', validFrom: new Date('2026-10-12') }];
    const base = { tz: TZ, durationMin: 60, bufferMin: 0, busy: [], earliest: new Date(0), rules };
    expect(slotsForDay({ ...base, date: '2026-10-05' })).toHaveLength(1);
    expect(slotsForDay({ ...base, date: '2026-10-12' })).toHaveLength(2);
  });
});
