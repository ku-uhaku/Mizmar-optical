'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { workError } from '@/lib/work-errors';
import { Field } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';

interface Rule { weekday: number; startTime: string; endTime: string }
const DAYS = [1, 2, 3, 4, 5, 6, 0]; // Monday first

function Editor({ practitionerId, storeId }: { practitionerId: string; storeId: string }) {
  const t = useTranslations('shopAdmin');
  const w = useTranslations('work');
  const c = useTranslations('common');
  const locale = useLocale();
  const qc = useQueryClient();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [off, setOff] = useState({ startsAt: '', endsAt: '', reason: '' });
  const { data } = useQuery({ queryKey: ['availability', practitionerId, storeId], queryFn: () => api<(Rule & { storeId: string })[]>(`/practitioners/${practitionerId}/availability`) });
  const { data: timeOff } = useQuery({ queryKey: ['time-off', practitionerId], queryFn: () => api<{ id: string; startsAt: string; endsAt: string; reason: string | null }[]>(`/practitioners/${practitionerId}/time-off`) });
  const current: Rule[] = rules ?? (data ?? []).filter((r) => r.storeId === storeId).map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime }));
  const save = useMutation({
    mutationFn: () => api(`/practitioners/${practitionerId}/availability`, { method: 'PUT', body: { storeId, rules: current } }),
    onSuccess: () => { toast.success(c('saved')); setRules(null); qc.invalidateQueries({ queryKey: ['availability'] }); qc.invalidateQueries({ queryKey: ['appt-staff'] }); }, onError: (e) => toast.error(workError(e, w)),
  });
  const addOff = useMutation({
    mutationFn: () => api<{ conflictingAppointments: number }>(`/practitioners/${practitionerId}/time-off`, { method: 'POST', body: { startsAt: new Date(off.startsAt).toISOString(), endsAt: new Date(off.endsAt).toISOString(), reason: off.reason || undefined } }),
    onSuccess: (r) => { toast.success(r.conflictingAppointments ? t('timeOffConflicts', { n: r.conflictingAppointments }) : c('saved')); setOff({ startsAt: '', endsAt: '', reason: '' }); qc.invalidateQueries({ queryKey: ['time-off'] }); qc.invalidateQueries({ queryKey: ['appt-calendar'] }); }, onError: (e) => toast.error(workError(e, w)),
  });
  const removeOff = useMutation({ mutationFn: (id: string) => api(`/time-off/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['time-off'] }); qc.invalidateQueries({ queryKey: ['appt-calendar'] }); } });
  const set = (next: Rule[]) => setRules(next);
  const dayName = (d: number) => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 4 + d)));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>{t('weeklyHours')}</CardTitle></CardHeader><CardContent className="space-y-2">
        {DAYS.map((d) => {
          const mine = current.map((r, i) => ({ r, i })).filter((x) => x.r.weekday === d);
          return (
            <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 font-medium">{dayName(d)}</span>
              {mine.length === 0 && <span className="text-muted-foreground">{t('closed')}</span>}
              {mine.map(({ r, i }) => (
                <span key={i} className="flex items-center gap-1">
                  <Input type="time" aria-label={`${dayName(d)} ${t('from')}`} className="h-8 w-28" value={r.startTime} onChange={(e) => set(current.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} />–
                  <Input type="time" aria-label={`${dayName(d)} ${t('to')}`} className="h-8 w-28" value={r.endTime} onChange={(e) => set(current.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))} />
                  <Button variant="ghost" size="icon" aria-label={c('remove')} onClick={() => set(current.filter((_, j) => j !== i))}><Trash2 className="text-destructive" /></Button>
                </span>
              ))}
              <Button variant="ghost" size="sm" onClick={() => set([...current, { weekday: d, startTime: '09:00', endTime: '12:00' }])}><Plus /> {t('addWindow')}</Button>
            </div>
          );
        })}
        <Button onClick={() => save.mutate()} disabled={save.isPending || rules === null}>{c('save')}</Button>
      </CardContent></Card>

      <Card><CardHeader><CardTitle>{t('timeOff')}</CardTitle></CardHeader><CardContent className="space-y-3">
        <ul className="divide-y text-sm">
          {(timeOff ?? []).length === 0 && <li className="py-2 text-muted-foreground">—</li>}
          {(timeOff ?? []).map((x) => <li key={x.id} className="flex items-center justify-between py-2"><span>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(x.startsAt))} → {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(x.endsAt))}{x.reason ? ` · ${x.reason}` : ''}</span><Button variant="ghost" size="icon" aria-label={c('remove')} onClick={() => removeOff.mutate(x.id)}><Trash2 className="text-destructive" /></Button></li>)}
        </ul>
        <div className="grid grid-cols-2 gap-2 border-t pt-3">
          <Field id="to-from" label={t('from')}><Input id="to-from" type="datetime-local" value={off.startsAt} onChange={(e) => setOff({ ...off, startsAt: e.target.value })} /></Field>
          <Field id="to-to" label={t('to')}><Input id="to-to" type="datetime-local" value={off.endsAt} onChange={(e) => setOff({ ...off, endsAt: e.target.value })} /></Field>
          <Field id="to-reason" label={t('reason')} className="col-span-2"><Input id="to-reason" value={off.reason} onChange={(e) => setOff({ ...off, reason: e.target.value })} /></Field>
          <Button className="col-span-2" variant="outline" disabled={!off.startsAt || !off.endsAt || addOff.isPending} onClick={() => addOff.mutate()}>{t('addTimeOff')}</Button>
        </div>
      </CardContent></Card>
    </div>
  );
}

export function SchedulesTab() {
  const t = useTranslations('shopAdmin');
  const { storeId } = useAuth();
  const [who, setWho] = useState('');
  const { data: staff } = useQuery({ queryKey: ['appt-staff', storeId], enabled: !!storeId, queryFn: () => api<{ id: string; firstName: string; lastName: string; hasSchedule: boolean; roles: string[] }[]>('/appointments/staff', { query: { storeId } }) });
  const chosen = who || staff?.find((s) => s.hasSchedule)?.id || staff?.[0]?.id || '';
  return (
    <div className="space-y-4">
      <Field id="sc-who" label={t('practitioner')} className="max-w-xs"><NativeSelect id="sc-who" value={chosen} onChange={(e) => setWho(e.target.value)}>{staff?.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}{s.hasSchedule ? '' : ` (${t('noSchedule')})`}</option>)}</NativeSelect></Field>
      {chosen && storeId && <Editor key={`${chosen}-${storeId}`} practitionerId={chosen} storeId={storeId} />}
    </div>
  );
}
