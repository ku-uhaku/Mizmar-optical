'use client';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarCheck } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';
import { formatAt, useFormat } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';

interface AType { id: string; name: string; description: string | null; durationMin: number; price: number }
interface Store { id: string; name: string; city: string | null }
interface Slots { timezone: string; days: { date: string; slots: { startsAt: string }[] }[] }
interface Booked { number: string; startsAt: string; type: { name: string }; practitioner: string | null; status: string; store?: { name: string; address: string | null; city: string | null; timezone?: string } }

const PHONE = /^\+?[0-9 ().-]{6,20}$/;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export default function BookingPage() {
  const t = useTranslations('appointments');
  const c = useTranslations('common');
  const locale = useLocale();
  const f = useFormat();
  const { user } = useAuth();
  const [types, setTypes] = useState<AType[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [typeId, setTypeId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [offset, setOffset] = useState(0); // weeks from today
  const [slots, setSlots] = useState<Slots | null>(null);
  const [day, setDay] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [guest, setGuest] = useState({ name: '', email: '', phone: '' });
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api<AType[]>('/public/appointments/types'), api<Store[]>('/public/stores')]).then(([ty, st]) => { if (alive) { setTypes(ty); setStores(st); } }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const eType = typeId || types[0]?.id || '';
  const eStore = storeId || stores[0]?.id || '';
  const from = useMemo(() => addDays(new Date(), offset * 7).toISOString().slice(0, 10), [offset]);

  useEffect(() => {
    if (!eType || !eStore) return;
    let alive = true;
    const to = addDays(new Date(`${from}T00:00:00Z`), 6).toISOString().slice(0, 10);
    api<Slots>('/public/appointments/slots', { query: { typeId: eType, storeId: eStore, from, to } }).then((s) => { if (alive) setSlots(s); }).catch(() => alive && setSlots(null));
    return () => { alive = false; };
  }, [eType, eStore, from]);

  const days = slots?.days ?? [];
  const activeDay = days.find((d) => d.date === day && d.slots.length) ?? days.find((d) => d.slots.length);
  const tz = slots?.timezone ?? 'UTC';
  const pick = (type: string, store: string) => { setTypeId(type); setStoreId(store); setDay(''); setStartsAt(''); setOffset(0); setSlots(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!startsAt) err.slot = t('pickSlot');
    if (!user) { if (!guest.name.trim()) err.name = c('required'); if (!/^\S+@\S+\.\S+$/.test(guest.email)) err.email = t('invalidEmail'); if (!PHONE.test(guest.phone)) err.phone = t('invalidPhone'); }
    setErrors(err); setFailure(null);
    if (Object.keys(err).length) return;
    setBusy(true);
    try { setBooked(await api<Booked>('/public/appointments', { method: 'POST', body: { typeId: eType, storeId: eStore, startsAt, guest: user ? undefined : guest, reason: reason.trim() || undefined, locale } })); }
    catch (ex) { setFailure(errorText(ex, (k, x) => c(k, x as never))); setStartsAt(''); pick(eType, eStore); } finally { setBusy(false); }
  };

  if (booked) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-14 text-center">
        <CalendarCheck className="mx-auto size-14 text-emerald-500" aria-hidden />
        <h1 className="text-3xl font-bold">{booked.status === 'CONFIRMED' ? t('confirmedTitle') : t('pendingTitle')}</h1>
        <div className="space-y-1 rounded-lg border bg-card p-5 text-sm">
          <p className="text-lg font-semibold" data-testid="booked-when">{formatAt(locale, booked.store?.timezone ?? tz, booked.startsAt, { dateStyle: 'full', timeStyle: 'short' })}</p>
          <p>{booked.type.name}{booked.practitioner ? ` · ${booked.practitioner}` : ''}</p>
          {booked.store && <p className="text-muted-foreground">{booked.store.name}{booked.store.address ? ` — ${booked.store.address}` : ''}{booked.store.city ? `, ${booked.store.city}` : ''}</p>}
          <p>{t('reference')}: <b data-testid="booked-number" className="font-mono">{booked.number}</b></p>
        </div>
        <p className="text-sm text-muted-foreground">{t('manageHint')}</p>
        <Button asChild variant="outline"><Link href={'/rendez-vous/gerer' as '/'}>{t('manage')}</Link></Button>
      </div>
    );
  }

  const type = types.find((x) => x.id === eType);
  const radio = 'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5';
  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div><h1 className="text-3xl font-bold">{t('title')}</h1><p className="mt-1 text-muted-foreground">{t('subtitle')} <Link href={'/rendez-vous/gerer' as '/'} className="underline">{t('manage')}</Link></p></div>

      <fieldset className="space-y-2"><legend className="text-lg font-semibold">1. {t('type')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">{types.map((x) => <label key={x.id} className={radio}><input type="radio" name="type" checked={eType === x.id} onChange={() => pick(x.id, eStore)} className="mt-1 accent-[var(--primary)]" /><span><b>{x.name}</b><span className="block text-muted-foreground">{t('duration', { min: x.durationMin })}{x.price > 0 ? ` · ${f.money(x.price)}` : ` · ${t('free')}`}</span>{x.description && <span className="block text-xs text-muted-foreground">{x.description}</span>}</span></label>)}</div>
      </fieldset>

      <section className="space-y-2" aria-labelledby="b-store"><h2 id="b-store" className="text-lg font-semibold">2. {t('store')}</h2>
        <select aria-labelledby="b-store" value={eStore} onChange={(e) => pick(eType, e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-80">{stores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ''}</option>)}</select>
      </section>

      <section className="space-y-3" aria-labelledby="b-when"><h2 id="b-when" className="text-lg font-semibold">3. {t('when')}</h2>
        <div className="flex items-center justify-between text-sm"><Button type="button" variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(offset - 1)}>{t('prevWeek')}</Button><span className="text-muted-foreground">{f.date(from)} →</span><Button type="button" variant="outline" size="sm" disabled={offset >= 8} onClick={() => setOffset(offset + 1)}>{t('nextWeek')}</Button></div>
        <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={t('days')}>
          {days.map((d) => (
            <button key={d.date} type="button" disabled={d.slots.length === 0} aria-pressed={activeDay?.date === d.date} onClick={() => { setDay(d.date); setStartsAt(''); }} className={`rounded-md border p-2 text-center text-xs disabled:opacity-40 ${activeDay?.date === d.date ? 'border-primary bg-primary/10' : 'hover:bg-muted'}`}>
              <span className="block text-muted-foreground">{new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d.date}T12:00:00Z`))}</span>
              <span className="block text-base font-semibold">{d.date.slice(8)}</span><span className="block">{d.slots.length || '—'}</span>
            </button>
          ))}
        </div>
        {slots && !days.some((d) => d.slots.length) && <p className="rounded-md bg-muted p-3 text-sm">{t('noSlots')}</p>}
        {activeDay && (
          <div role="radiogroup" aria-label={t('times')} className="flex flex-wrap gap-2">
            {activeDay.slots.map((s) => <button key={s.startsAt} type="button" role="radio" aria-checked={startsAt === s.startsAt} onClick={() => setStartsAt(s.startsAt)} className={`rounded-md border px-3 py-1.5 text-sm ${startsAt === s.startsAt ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{formatAt(locale, tz, s.startsAt, { hour: '2-digit', minute: '2-digit' })}</button>)}
          </div>
        )}
        {errors.slot && <p role="alert" className="text-sm text-destructive">{errors.slot}</p>}
      </section>

      <section className="space-y-3" aria-labelledby="b-you"><h2 id="b-you" className="text-lg font-semibold">4. {t('you')}</h2>
        {user ? <p className="rounded-md bg-muted p-3 text-sm">{t('bookingAs', { name: `${user.firstName} ${user.lastName}` })}</p> : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="g-name" label={t('name')} error={errors.name}><Input id="g-name" autoComplete="name" value={guest.name} aria-invalid={!!errors.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} /></Field>
            <Field id="g-email" label={t('email')} error={errors.email}><Input id="g-email" type="email" autoComplete="email" value={guest.email} aria-invalid={!!errors.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} /></Field>
            <Field id="g-phone" label={t('phone')} error={errors.phone}><Input id="g-phone" type="tel" autoComplete="tel" value={guest.phone} aria-invalid={!!errors.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} /></Field>
          </div>
        )}
        <Field id="g-reason" label={t('reason')}><Textarea id="g-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </section>

      {failure && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{failure}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">{type && startsAt ? `${type.name} · ${formatAt(locale, tz, startsAt, { dateStyle: 'full', timeStyle: 'short' })}` : ''}</p><Button type="submit" className="h-11 px-8" disabled={busy}>{t('confirm')}</Button></div>
    </form>
  );
}
