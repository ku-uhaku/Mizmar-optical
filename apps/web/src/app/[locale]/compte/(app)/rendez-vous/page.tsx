'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { errorText } from '@/lib/errors';
import { formatAt } from '@/lib/format';
import { notify } from '@/components/toaster';
import { Button } from '@/components/ui/button';

interface Appt { id: string; number: string; status: string; startsAt: string; type: { name: string }; practitioner: string | null; store?: { name: string; timezone?: string } }

export default function MyAppointments() {
  const t = useTranslations('account');
  const a = useTranslations('appointments');
  const c = useTranslations('common');
  const locale = useLocale();
  const [rows, setRows] = useState<Appt[] | null>(null);
  useEffect(() => { let alive = true; api<Appt[]>('/account/appointments').then((r) => alive && setRows(r)).catch(() => alive && setRows([])); return () => { alive = false; }; }, []);
  const cancel = async (x: Appt) => {
    if (!confirm(a('confirmCancel'))) return;
    try { await api(`/account/appointments/${x.number}/cancel`, { method: 'POST' }); setRows((r) => (r ?? []).map((y) => (y.id === x.id ? { ...y, status: 'CANCELLED' } : y))); notify(a('cancelled')); }
    catch (e) { notify(errorText(e, (k, v) => c(k, v as never)), 'error'); }
  };
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">{t('nav.appointments')}</h1><Button asChild><Link href={'/rendez-vous' as '/'}>{a('book')}</Link></Button></div>
      {rows === null ? <p className="text-muted-foreground">…</p> : rows.length === 0 ? <p className="rounded-lg border bg-card p-8 text-center text-muted-foreground">{t('noAppointments')}</p> : (
        <ul className="divide-y rounded-lg border bg-card">{rows.map((x) => {
          const upcoming = new Date(x.startsAt) > new Date() && ['PENDING', 'CONFIRMED'].includes(x.status);
          return (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div><p className="font-medium">{formatAt(locale, x.store?.timezone ?? 'UTC', x.startsAt, { dateStyle: 'full', timeStyle: 'short' })}</p><p className="text-muted-foreground">{x.type.name}{x.store ? ` · ${x.store.name}` : ''}{x.practitioner ? ` · ${x.practitioner}` : ''} · <span className="font-mono">{x.number}</span></p></div>
              <div className="flex items-center gap-3"><span className="rounded-full bg-muted px-2.5 py-0.5 text-xs">{a(`status.${x.status}`)}</span>{upcoming && <Button size="sm" variant="outline" onClick={() => cancel(x)}>{c('cancel')}</Button>}</div>
            </li>);
        })}</ul>
      )}
    </section>
  );
}
