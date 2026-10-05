'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { workError } from '@/lib/work-errors';
import { Field } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface Appt {
  id: string; number: string; status: string; source: string; startsAt: string; endsAt: string; reason: string | null; notes: string | null; guestName: string | null; guestEmail: string | null; guestPhone: string | null; practitionerId: string | null;
  type: { id: string; name: string; durationMin: number; color: string | null }; practitioner: { id: string; firstName: string; lastName: string } | null; customer: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null } | null;
}
const NEXT: Record<string, string[]> = { PENDING: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['CHECKED_IN', 'NO_SHOW', 'CANCELLED'], CHECKED_IN: ['COMPLETED', 'NO_SHOW', 'CANCELLED'], COMPLETED: [], CANCELLED: [], NO_SHOW: [] };

const useRefresh = () => { const qc = useQueryClient(); return () => { qc.invalidateQueries({ queryKey: ['appt-calendar'] }); qc.invalidateQueries({ queryKey: ['appointments'] }); }; };

export function AppointmentDialog({ appt, onClose }: { appt: Appt | null; onClose: () => void }) {
  const t = useTranslations('shopAdmin');
  const w = useTranslations('work');
  const c = useTranslations('common');
  const locale = useLocale();
  const { can } = useAuth();
  const refresh = useRefresh();
  const [notes, setNotes] = useState<string | null>(null);
  const [when, setWhen] = useState('');
  const run = useMutation({
    mutationFn: (a: { path: string; method?: string; body: unknown }) => api<Appt>(`/appointments/${appt!.id}${a.path}`, { method: a.method ?? 'POST', body: a.body }),
    onSuccess: () => { toast.success(c('saved')); refresh(); onClose(); }, onError: (e) => toast.error(workError(e, w)),
  });
  if (!appt) return <Dialog open={false} onOpenChange={onClose}><DialogContent><DialogTitle>-</DialogTitle></DialogContent></Dialog>;
  const editable = ['PENDING', 'CONFIRMED'].includes(appt.status) && can('appointments:update');
  const person = appt.customer ? `${appt.customer.firstName} ${appt.customer.lastName}` : appt.guestName;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>{person} <Badge variant="secondary">{t(`status.${appt.status}`)}</Badge></DialogTitle>
        <DialogDescription>{appt.number} · {appt.type.name} · {new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(appt.startsAt))}</DialogDescription>
        <dl className="grid grid-cols-2 gap-1 text-sm">
          <dt className="text-muted-foreground">{t('practitioner')}</dt><dd>{appt.practitioner ? `${appt.practitioner.firstName} ${appt.practitioner.lastName}` : '—'}</dd>
          <dt className="text-muted-foreground">{t('contact')}</dt><dd><bdi>{appt.customer?.phone ?? appt.guestPhone ?? '—'}</bdi><br />{appt.customer?.email ?? appt.guestEmail}</dd>
          <dt className="text-muted-foreground">{t('source')}</dt><dd>{t(`sources.${appt.source}`)}</dd>
          {appt.reason && <><dt className="text-muted-foreground">{t('reason')}</dt><dd>{appt.reason}</dd></>}
        </dl>
        {editable && (
          <div className="space-y-3 border-t pt-3">
            <Field id="ap-when" label={t('reschedule')}><Input id="ap-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
            <Field id="ap-notes" label={c('notes')}><Textarea id="ap-notes" value={notes ?? appt.notes ?? ''} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Button variant="outline" disabled={run.isPending || (!when && notes === null)} onClick={() => run.mutate({ path: '', method: 'PATCH', body: { startsAt: when ? new Date(when).toISOString() : undefined, notes: notes ?? undefined } })}>{t('saveChanges')}</Button>
          </div>
        )}
        {can('appointments:update') && NEXT[appt.status].length > 0 && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {NEXT[appt.status].map((s) => <Button key={s} variant={s === 'CANCELLED' || s === 'NO_SHOW' ? 'outline' : 'default'} disabled={run.isPending} onClick={() => (s !== 'CANCELLED' || confirm(t('confirmCancel'))) && run.mutate({ path: '/status', body: { to: s } })}>{t(`actions.${s}`)}</Button>)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface Slots { timezone: string; days: { date: string; slots: { startsAt: string; practitionerIds: string[] }[] }[] }

export function NewAppointmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('shopAdmin');
  const w = useTranslations('work');
  const c = useTranslations('common');
  const locale = useLocale();
  const { storeId } = useAuth();
  const refresh = useRefresh();
  const [q, setQ] = useState('');
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [guest, setGuest] = useState({ name: '', email: '', phone: '' });
  const [typeId, setTypeId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startsAt, setStartsAt] = useState('');
  const [source, setSource] = useState<'STAFF' | 'PHONE'>('PHONE');
  const [reason, setReason] = useState('');
  const { data: customers } = useQuery({ queryKey: ['appt-customers', q], enabled: open && !customer && q.trim().length >= 2, queryFn: () => api<Paginated<{ id: string; firstName: string; lastName: string; phone: string | null }>>('/customers', { query: { search: q.trim(), limit: 6 } }) });
  const { data: types } = useQuery({ queryKey: ['appt-types'], enabled: open, queryFn: () => api<Paginated<{ id: string; name: string; durationMin: number }>>('/appointment-types', { query: { limit: 50, isActive: 'true' } }) });
  const eType = typeId || types?.data[0]?.id || '';
  const { data: slots } = useQuery({ queryKey: ['appt-slots', storeId, eType, date], enabled: open && !!storeId && !!eType, queryFn: () => api<Slots>('/appointments/slots', { query: { storeId, typeId: eType, from: date, to: date } }) });
  const times = slots?.days[0]?.slots ?? [];
  const tz = slots?.timezone ?? 'UTC';
  const save = useMutation({
    mutationFn: () => api('/appointments', { method: 'POST', body: { typeId: eType, storeId, startsAt, source, reason: reason || undefined, customerId: customer?.id, guest: customer ? undefined : { name: guest.name, email: guest.email, phone: guest.phone } } }),
    onSuccess: () => { toast.success(c('saved')); refresh(); setStartsAt(''); setReason(''); onClose(); }, onError: (e) => toast.error(workError(e, w)),
  });
  const valid = !!startsAt && (!!customer || (guest.name.trim() && guest.email.includes('@') && guest.phone.trim().length >= 6));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>{t('newAppointment')}</DialogTitle><DialogDescription>{t('newAppointmentHint')}</DialogDescription>
        <Field id="na-customer" label={t('visitor')}>
          {customer ? <div className="flex items-center justify-between rounded-md border p-2 text-sm"><span>{customer.name}</span><Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>{c('edit')}</Button></div> : (
            <div className="space-y-2">
              <div className="relative"><Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" /><Input id="na-customer" className="ps-8" placeholder={t('searchCustomer')} value={q} onChange={(e) => setQ(e.target.value)} />
                {(customers?.data.length ?? 0) > 0 && <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">{customers!.data.map((cu) => <li key={cu.id}><button type="button" className="w-full rounded px-2 py-1.5 text-start text-sm hover:bg-muted" onClick={() => setCustomer({ id: cu.id, name: `${cu.firstName} ${cu.lastName}` })}>{cu.firstName} {cu.lastName} <span className="text-xs text-muted-foreground">{cu.phone}</span></button></li>)}</ul>}</div>
              <p className="text-xs text-muted-foreground">{t('orWalkIn')}</p>
              <div className="grid grid-cols-3 gap-2"><Input aria-label={t('name')} placeholder={t('name')} value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} /><Input aria-label="Email" placeholder="Email" type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} /><Input aria-label={t('phone')} placeholder={t('phone')} value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} /></div>
            </div>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="na-type" label={t('service')}><NativeSelect id="na-type" value={eType} onChange={(e) => { setTypeId(e.target.value); setStartsAt(''); }}>{types?.data.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.durationMin} min)</option>)}</NativeSelect></Field>
          <Field id="na-date" label={t('date')}><Input id="na-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setStartsAt(''); }} /></Field>
        </div>
        <Field id="na-times" label={t('time')}>
          {times.length === 0 ? <p className="text-sm text-muted-foreground">{t('noSlots')}</p> : <div id="na-times" role="radiogroup" className="flex flex-wrap gap-1.5">{times.map((s) => <button key={s.startsAt} type="button" role="radio" aria-checked={startsAt === s.startsAt} onClick={() => setStartsAt(s.startsAt)} className={`rounded-md border px-2.5 py-1 text-sm ${startsAt === s.startsAt ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(s.startsAt))}</button>)}</div>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="na-source" label={t('source')}><NativeSelect id="na-source" value={source} onChange={(e) => setSource(e.target.value as 'STAFF')}><option value="PHONE">{t('sources.PHONE')}</option><option value="STAFF">{t('sources.STAFF')}</option></NativeSelect></Field>
          <Field id="na-reason" label={t('reason')}><Input id="na-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{c('save')}</Button>
      </DialogContent>
    </Dialog>
  );
}
