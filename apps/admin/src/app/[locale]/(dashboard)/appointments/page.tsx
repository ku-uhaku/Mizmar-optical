'use client';
import { useMemo, useState } from 'react';
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { DataTable, type Column } from '@/components/data-table';
import { ResourcePage, type FieldDef } from '@/components/resource-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { AppointmentDialog, NewAppointmentDialog, type Appt } from './dialogs';
import { SchedulesTab } from './schedules';

const tone = (s: string) => (s === 'COMPLETED' ? 'success' : s === 'CANCELLED' || s === 'NO_SHOW' ? 'danger' : s === 'PENDING' ? 'outline' : 'secondary') as 'success' | 'danger' | 'outline' | 'secondary';
export const fmtTime = (locale: string, tz: string, d: string | Date) => new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(d));
const dayKey = (tz: string, d: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(d));
const startOfWeek = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }; // Monday

function Calendar({ onOpen }: { onOpen: (a: Appt) => void }) {
  const t = useTranslations('shopAdmin');
  const locale = useLocale();
  const { storeId } = useAuth();
  const [offset, setOffset] = useState(0);
  const [practitioner, setPractitioner] = useState('');
  const from = useMemo(() => { const s = startOfWeek(new Date()); s.setDate(s.getDate() + offset * 7); return s; }, [offset]);
  const to = useMemo(() => new Date(from.getTime() + 7 * 86_400_000), [from]);
  const { data: staff } = useQuery({ queryKey: ['appt-staff', storeId], enabled: !!storeId, queryFn: () => api<{ id: string; firstName: string; lastName: string; hasSchedule: boolean }[]>('/appointments/staff', { query: { storeId } }) });
  const { data } = useQuery({
    queryKey: ['appt-calendar', storeId, from.toISOString(), practitioner], enabled: !!storeId,
    queryFn: () => api<{ appointments: Appt[]; timeOff: { id: string; practitionerId: string; startsAt: string; endsAt: string; reason: string | null }[]; timezone: string }>('/appointments/calendar', { query: { storeId, from: from.toISOString(), to: to.toISOString(), practitionerId: practitioner || undefined } }),
  });
  const tz = data?.timezone ?? 'UTC';
  const days = Array.from({ length: 7 }, (_, i) => new Date(from.getTime() + i * 86_400_000));
  const who = (id: string | null) => { const p = staff?.find((x) => x.id === id); return p ? `${p.firstName}` : ''; };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label={t('prev')} onClick={() => setOffset(offset - 1)}><ChevronLeft className="rtl:rotate-180" /></Button>
        <Button variant="outline" size="sm" onClick={() => setOffset(0)}>{t('today')}</Button>
        <Button variant="outline" size="icon" aria-label={t('next')} onClick={() => setOffset(offset + 1)}><ChevronRight className="rtl:rotate-180" /></Button>
        <span className="text-sm text-muted-foreground">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(from)} – {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(to.getTime() - 1))}</span>
        <select aria-label={t('practitioner')} value={practitioner} onChange={(e) => setPractitioner(e.target.value)} className="ms-auto h-9 rounded-md border bg-background px-2 text-sm"><option value="">{t('everyone')}</option>{staff?.filter((p) => p.hasSchedule).map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}</select>
      </div>
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((d) => {
          const key = dayKey('UTC', new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
          const items = (data?.appointments ?? []).filter((a) => dayKey(tz, a.startsAt) === key);
          const off = (data?.timeOff ?? []).filter((x) => dayKey(tz, x.startsAt) <= key && dayKey(tz, x.endsAt) >= key);
          const today = dayKey('UTC', new Date()) === key;
          return (
            <section key={key} aria-label={key} className={`min-h-28 rounded-lg border bg-card p-2 ${today ? 'ring-2 ring-primary' : ''}`}>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">{new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`))}</h3>
              {off.map((x) => <p key={x.id} className="mb-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{who(x.practitionerId)} · {x.reason ?? t('timeOff')}</p>)}
              <ul className="space-y-1">
                {items.map((a) => (
                  <li key={a.id}><button type="button" onClick={() => onOpen(a)} className="w-full rounded-md border-s-4 bg-muted/50 p-1.5 text-start text-xs hover:bg-muted" style={{ borderColor: a.type.color ?? 'var(--primary)' }}>
                    <span className="font-medium">{fmtTime(locale, tz, a.startsAt)}</span> {a.customer ? `${a.customer.firstName} ${a.customer.lastName}` : a.guestName}
                    <span className="block text-muted-foreground">{a.type.name} · {who(a.practitionerId)}</span>
                    {a.status !== 'CONFIRMED' && <Badge variant={tone(a.status)} className="mt-0.5">{t(`status.${a.status}`)}</Badge>}
                  </button></li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ListTab({ onOpen }: { onOpen: (a: Appt) => void }) {
  const t = useTranslations('shopAdmin');
  const c = useTranslations('common');
  const locale = useLocale();
  const { storeId } = useAuth();
  const [status, setStatus] = useState('');
  const cols: Column<Appt>[] = [
    { header: t('when'), cell: (a) => <button className="underline" onClick={() => onOpen(a)}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(a.startsAt))}</button> },
    { header: t('visitor'), cell: (a) => (a.customer ? `${a.customer.firstName} ${a.customer.lastName}` : a.guestName) },
    { header: t('service'), cell: (a) => a.type.name, className: 'hidden md:table-cell' },
    { header: t('practitioner'), cell: (a) => (a.practitioner ? `${a.practitioner.firstName} ${a.practitioner.lastName}` : '—'), className: 'hidden lg:table-cell' },
    { header: t('source'), cell: (a) => t(`sources.${a.source}`), className: 'hidden lg:table-cell' },
    { header: c('status'), cell: (a) => <Badge variant={tone(a.status)}>{t(`status.${a.status}`)}</Badge> },
  ];
  return <DataTable<Appt> queryKey="appointments" endpoint="/appointments" columns={cols} extraQuery={{ storeId: storeId ?? undefined, status: status || undefined, sortOrder: 'desc' }}
    toolbar={<select aria-label={c('status')} value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">{c('all')}</option>{['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</select>} />;
}

export default function AppointmentsPage() {
  const t = useTranslations('shopAdmin');
  const c = useTranslations('common');
  const { can } = useAuth();
  const [tab, setTab] = useState<'calendar' | 'list' | 'types' | 'schedules'>('calendar');
  const [open, setOpen] = useState<Appt | null>(null);
  const [creating, setCreating] = useState(false);
  const types: FieldDef[] = [
    { name: 'code', label: c('code'), required: true, createOnly: true }, { name: 'name', label: c('name'), required: true },
    { name: 'durationMin', label: t('duration'), type: 'number', step: '5', required: true }, { name: 'bufferMin', label: t('buffer'), type: 'number', step: '5' }, { name: 'price', label: c('price'), type: 'number' },
    { name: 'color', label: t('color') }, { name: 'bookableOnline', label: t('online'), type: 'checkbox', hint: t('bookableOnline') }, { name: 'isActive', label: c('status'), type: 'checkbox', hint: c('active') }, { name: 'description', label: c('description'), type: 'textarea' },
  ];
  const typeCols: Column<{ id: string; [k: string]: any }>[] = [
    { header: c('name'), cell: (r) => <span className="font-medium">{r.name}</span> }, { header: t('duration'), cell: (r) => `${r.durationMin} min${r.bufferMin ? ` + ${r.bufferMin}` : ''}` },
    { header: c('price'), cell: (r) => Number(r.price) }, { header: t('online'), cell: (r) => (r.bookableOnline ? '✓' : '—') },
  ];
  return (
    <RequirePermission permission="appointments:read">
      <div className="space-y-4">
        <PageHeader title={t('appointments.title')} actions={can('appointments:create') ? <Button onClick={() => setCreating(true)}><Plus /> {t('newAppointment')}</Button> : undefined} />
        <Tabs value={tab} onChange={setTab} items={[{ value: 'calendar', label: t('tabs.calendar') }, { value: 'list', label: t('tabs.list') }, ...(can('appointments:update') ? [{ value: 'types' as const, label: t('tabs.types') }, { value: 'schedules' as const, label: t('tabs.schedules') }] : [])]} />
        {tab === 'calendar' && <Calendar onOpen={setOpen} />}
        {tab === 'list' && <ListTab onOpen={setOpen} />}
        {tab === 'types' && <ResourcePage queryKey="appointment-types" endpoint="/appointment-types" module="appointments" title={t('tabs.types')} columns={typeCols} fields={types} defaults={{ durationMin: 30, bufferMin: 0, price: 0, bookableOnline: true, isActive: true }} />}
        {tab === 'schedules' && <SchedulesTab />}
        <AppointmentDialog appt={open} onClose={() => setOpen(null)} />
        <NewAppointmentDialog open={creating} onClose={() => setCreating(false)} />
      </div>
    </RequirePermission>
  );
}
