'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { api } from '@/lib/client-api';
import { errorText } from '@/lib/errors';
import { useFormat } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

interface Tracked {
  number: string; status: string; paymentStatus: string; fulfillment: string; placedAt: string; total: number; balanceDue: number; lines: { description: string; quantity: number; lineTotal: number }[];
  shipments: { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null; status: string }[]; workshop: { number: string; status: string; promisedAt: string | null }[]; store: { name: string } | null;
}
const STEPS = { DELIVERY: ['PENDING', 'CONFIRMED', 'SHIPPED', 'COMPLETED'], PICKUP: ['PENDING', 'CONFIRMED', 'READY', 'COMPLETED'] } as const;
const rank = (steps: readonly string[], s: string) => { const i = steps.indexOf(s === 'DELIVERED' ? 'COMPLETED' : s === 'PROCESSING' ? 'CONFIRMED' : s); return i < 0 ? 0 : i; };

function Tracker() {
  const t = useTranslations('tracking');
  const c = useTranslations('common');
  const f = useFormat();
  const params = useSearchParams();
  const [number, setNumber] = useState(params.get('number') ?? '');
  const [contact, setContact] = useState('');
  const [order, setOrder] = useState<Tracked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { setOrder(await api<Tracked>('/public/orders/track', { method: 'POST', body: { number: number.trim(), contact: contact.trim() } })); }
    catch (err) { setOrder(null); setError(errorText(err, (k, x) => c(k, x as never))); } finally { setBusy(false); }
  };
  const steps = order ? STEPS[order.fulfillment === 'DELIVERY' ? 'DELIVERY' : 'PICKUP'] : [];
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <form onSubmit={submit} className="grid gap-3 rounded-lg border bg-card p-5 sm:grid-cols-2">
        <Field id="t-num" label={t('number')}><Input id="t-num" required value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        <Field id="t-contact" label={t('contact')} hint={t('contactHint')}><Input id="t-contact" required value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
        <Button type="submit" className="sm:col-span-2" disabled={busy}>{t('track')}</Button>
      </form>
      {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
      {order && (
        <section className="space-y-5 rounded-lg border bg-card p-5" aria-live="polite">
          <header className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-mono text-lg font-semibold">{order.number}</h2><span className="text-sm text-muted-foreground">{f.date(order.placedAt)}</span></header>
          {order.status === 'CANCELLED' ? <p className="rounded-md bg-destructive/10 p-3 text-sm font-medium text-destructive">{t('status.CANCELLED')}</p> : (
            <ol className="flex" aria-label={t('progress')}>
              {steps.map((s, i) => { const done = i <= rank(steps, order.status); return (
                <li key={s} className="flex-1 text-center text-xs" aria-current={i === rank(steps, order.status) ? 'step' : undefined}>
                  <span className={`mx-auto mb-1 grid size-7 place-items-center rounded-full border-2 ${done ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{done ? <Check className="size-4" /> : i + 1}</span>
                  <span className={done ? 'font-medium' : 'text-muted-foreground'}>{t(`status.${s}`)}</span>
                </li>); })}
            </ol>
          )}
          {order.shipments.filter((s) => s.trackingNumber).map((s, i) => <p key={i} className="text-sm">{t('shipment')}: <b>{s.carrier}</b> <bdi className="font-mono">{s.trackingNumber}</bdi>{s.trackingUrl && <> — <a className="underline" href={s.trackingUrl} target="_blank" rel="noreferrer noopener">{t('follow')}</a></>}</p>)}
          {order.workshop.map((j) => <p key={j.number} className="text-sm text-muted-foreground">{t('workshop')} <span className="font-mono">{j.number}</span>: <b className="text-foreground">{t(`job.${j.status}`)}</b>{j.promisedAt && j.status !== 'READY' && j.status !== 'DELIVERED' ? ` — ${t('promised', { date: f.date(j.promisedAt) })}` : ''}</p>)}
          <ul className="divide-y border-y text-sm">{order.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 py-2"><span>{l.quantity} × {l.description}</span><span>{f.money(l.lineTotal)}</span></li>)}</ul>
          <p className="flex justify-between font-semibold"><span>{t('total')}</span><span>{f.money(order.total)}</span></p>
          {order.balanceDue > 0 && <p className="text-sm text-muted-foreground">{t('balanceDue', { amount: f.money(order.balanceDue) })}</p>}
        </section>
      )}
    </div>
  );
}

export default function TrackingPage() { return <Suspense><Tracker /></Suspense>; }
