'use client';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { api } from '@/lib/client-api';
import { errorText } from '@/lib/errors';
import { formatAt } from '@/lib/format';
import { notify } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

interface Appt { number: string; status: string; startsAt: string; type: { name: string }; practitioner: string | null; store?: { name: string; address: string | null; city: string | null; timezone?: string } }

export default function ManageAppointment() {
  const t = useTranslations('appointments');
  const c = useTranslations('common');
  const locale = useLocale();
  const [number, setNumber] = useState('');
  const [contact, setContact] = useState('');
  const [appt, setAppt] = useState<Appt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = { number: number.trim(), contact: contact.trim() };
  const lookup = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try { setAppt(await api<Appt>('/public/appointments/lookup', { method: 'POST', body })); } catch (ex) { setAppt(null); setError(errorText(ex, (k, x) => c(k, x as never))); }
  };
  const cancel = async () => {
    if (!confirm(t('confirmCancel'))) return;
    try { setAppt(await api<Appt>('/public/appointments/cancel', { method: 'POST', body })); notify(t('cancelled')); } catch (ex) { notify(errorText(ex, (k, x) => c(k, x as never)), 'error'); }
  };
  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-bold">{t('manage')}</h1>
      <form onSubmit={lookup} className="grid gap-3 rounded-lg border bg-card p-5 sm:grid-cols-2">
        <Field id="m-num" label={t('reference')}><Input id="m-num" required value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        <Field id="m-contact" label={t('contactUsed')}><Input id="m-contact" required value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
        <Button type="submit" className="sm:col-span-2">{t('find')}</Button>
      </form>
      {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
      {appt && (
        <section className="space-y-2 rounded-lg border bg-card p-5 text-sm" aria-live="polite">
          <p className="text-lg font-semibold">{formatAt(locale, appt.store?.timezone ?? 'UTC', appt.startsAt, { dateStyle: 'full', timeStyle: 'short' })}</p>
          <p>{appt.type.name}{appt.practitioner ? ` · ${appt.practitioner}` : ''}</p>
          {appt.store && <p className="text-muted-foreground">{appt.store.name}{appt.store.address ? ` — ${appt.store.address}` : ''}</p>}
          <p><span className="rounded-full bg-muted px-2.5 py-0.5 text-xs">{t(`status.${appt.status}`)}</span></p>
          {['PENDING', 'CONFIRMED'].includes(appt.status) && <Button variant="outline" onClick={cancel}>{t('cancelAppointment')}</Button>}
        </section>
      )}
    </div>
  );
}
