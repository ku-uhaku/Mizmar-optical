/**
 * Pure scheduling maths (no database): opening windows in the store's timezone -> bookable instants.
 * Kept separate so DST edges, buffers and overlaps are unit-tested without a database.
 */

export interface Rule { weekday: number; startTime: string; endTime: string; validFrom?: Date | null; validTo?: Date | null }
export interface Busy { start: Date; end: Date }

/** Offset (ms) of `tz` from UTC at the given instant. */
function offsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const v = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - Math.floor(at.getTime() / 1000) * 1000;
}

/** Wall-clock time in `tz` -> the UTC instant. Resolves twice so a time just after a DST change still lands correctly. */
export function zonedToUtc(date: string, hhmm: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(new Date(guess), tz);
  return new Date(guess - offsetMs(new Date(first), tz));
}

export const weekdayOf = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }; // 0 = Sunday
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s); // round-trip rejects 2026-02-30
export const localDate = (at: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at); // YYYY-MM-DD
export const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Do [aStart,aEnd) and [bStart,bEnd) overlap? Touching ends do not. */
export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

/**
 * Start times a practitioner can be booked on `date`. An appointment occupies `durationMin + bufferMin`; candidate starts sit on a grid
 * of that length from each opening window's start. Anything that overlaps a busy interval, starts before `earliest` or does not fit
 * inside its window is dropped.
 */
export function slotsForDay(o: { date: string; tz: string; rules: Rule[]; durationMin: number; bufferMin: number; busy: Busy[]; earliest: Date }): Date[] {
  const wd = weekdayOf(o.date);
  const day = new Date(`${o.date}T00:00:00Z`);
  const occupy = (o.durationMin + o.bufferMin) * 60_000;
  const step = Math.max(15, Math.ceil((o.durationMin + o.bufferMin) / 15) * 15) * 60_000;
  const out: Date[] = [];
  for (const r of o.rules) {
    if (r.weekday !== wd) continue;
    if (r.validFrom && day < new Date(r.validFrom)) continue;
    if (r.validTo && day > new Date(r.validTo)) continue;
    const start = zonedToUtc(o.date, r.startTime, o.tz).getTime();
    const end = zonedToUtc(o.date, r.endTime, o.tz).getTime();
    for (let t = start; t + o.durationMin * 60_000 <= end; t += step) {
      const s = new Date(t), e = new Date(t + occupy);
      if (s < o.earliest) continue;
      if (o.busy.some((b) => overlaps(s, e, b.start, b.end))) continue;
      out.push(s);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}
