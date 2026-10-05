'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { workError } from '@/lib/work-errors';
import { Field } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

interface Row { id: string; firstName: string; lastName: string; employeeNumber: string; present: number; late: number; absent: number; leave: number; holiday: number; workedMinutes: number }

export function AttendanceTab() {
  const t = useTranslations('hr');
  const w = useTranslations('work');
  const c = useTranslations('common');
  const { can, storeId } = useAuth();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [entry, setEntry] = useState({ employeeId: '', date: new Date().toISOString().slice(0, 10), checkIn: '09:00', checkOut: '18:00', breakMinutes: '60', status: 'PRESENT' });
  const { data } = useQuery({ queryKey: ['attendance-summary', period, storeId], queryFn: () => api<Row[]>('/attendance/summary', { query: { periodKey: period, storeId } }) });
  const save = useMutation({
    mutationFn: () => api('/attendance', { method: 'POST', body: { employeeId: entry.employeeId, date: entry.date, status: entry.status, ...(entry.status === 'PRESENT' || entry.status === 'LATE' ? { checkIn: entry.checkIn, checkOut: entry.checkOut || undefined, breakMinutes: Number(entry.breakMinutes) || 0 } : {}) } }),
    onSuccess: () => { toast.success(c('saved')); qc.invalidateQueries({ queryKey: ['attendance-summary'] }); }, onError: (e) => toast.error(workError(e, w)),
  });
  const hours = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3"><Field id="at-period" label={t('period')}><Input id="at-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field></div>
      <div className="rounded-lg border bg-card"><Table>
        <THead><TR><TH>{t('name')}</TH><TH>{t('att.present')}</TH><TH>{t('att.late')}</TH><TH>{t('att.absent')}</TH><TH>{t('att.leave')}</TH><TH>{t('att.worked')}</TH></TR></THead>
        <TBody>{(data ?? []).map((r) => <TR key={r.id}><TD className="font-medium">{r.firstName} {r.lastName}</TD><TD>{r.present}</TD><TD>{r.late}</TD><TD className={r.absent ? 'text-destructive' : ''}>{r.absent}</TD><TD>{r.leave}</TD><TD>{hours(r.workedMinutes)}</TD></TR>)}</TBody>
      </Table></div>
      {can('hr:update') && (
        <div className="grid items-end gap-3 rounded-lg border bg-card p-4 sm:grid-cols-3 lg:grid-cols-7">
          <Field id="m-emp" label={t('employee')} className="lg:col-span-2"><NativeSelect id="m-emp" value={entry.employeeId} onChange={(e) => setEntry({ ...entry, employeeId: e.target.value })}><option value="">—</option>{data?.map((r) => <option key={r.id} value={r.id}>{r.firstName} {r.lastName}</option>)}</NativeSelect></Field>
          <Field id="m-date" label={c('date')}><Input id="m-date" type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} /></Field>
          <Field id="m-status" label={c('status')}><NativeSelect id="m-status" value={entry.status} onChange={(e) => setEntry({ ...entry, status: e.target.value })}>{['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY'].map((s) => <option key={s} value={s}>{t(`att.status.${s}`)}</option>)}</NativeSelect></Field>
          <Field id="m-in" label={t('att.in')}><Input id="m-in" type="time" value={entry.checkIn} onChange={(e) => setEntry({ ...entry, checkIn: e.target.value })} /></Field>
          <Field id="m-out" label={t('att.out')}><Input id="m-out" type="time" value={entry.checkOut} onChange={(e) => setEntry({ ...entry, checkOut: e.target.value })} /></Field>
          <Button disabled={!entry.employeeId || save.isPending} onClick={() => save.mutate()}>{t('att.record')}</Button>
        </div>
      )}
    </div>
  );
}
