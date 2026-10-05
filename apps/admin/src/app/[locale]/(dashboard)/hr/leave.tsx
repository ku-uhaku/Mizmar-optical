'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { workError } from '@/lib/work-errors';
import { DataTable, type Column } from '@/components/data-table';
import { Field } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';

interface Req { id: string; startDate: string; endDate: string; days: number; status: string; reason: string | null; employee: { id: string; firstName: string; lastName: string }; leaveType: { id: string; name: string; isPaid: boolean } }
const tone = (s: string) => (s === 'APPROVED' ? 'success' : s === 'REJECTED' || s === 'CANCELLED' ? 'danger' : 'outline') as 'success' | 'danger' | 'outline';

function RequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('hr');
  const w = useTranslations('work');
  const c = useTranslations('common');
  const qc = useQueryClient();
  const [v, setV] = useState({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
  const { data: types } = useQuery({ queryKey: ['leave-types'], enabled: open, queryFn: () => api<Paginated<{ id: string; name: string }>>('/leave-types', { query: { limit: 50, isActive: 'true' } }).catch(() => ({ data: [], meta: {} as never })) });
  const { data: bal } = useQuery({ queryKey: ['my-balances'], enabled: open, retry: false, queryFn: () => api<{ leaveTypeId: string; name: string; allowance: number | null; remaining: number | null }[]>('/hr/me/leave-balances') });
  const save = useMutation({
    mutationFn: () => api('/leave-requests', { method: 'POST', body: { leaveTypeId: v.leaveTypeId || types?.data[0]?.id, startDate: v.startDate, endDate: v.endDate, reason: v.reason || undefined } }),
    onSuccess: () => { toast.success(c('saved')); qc.invalidateQueries({ queryKey: ['leave-requests'] }); onClose(); }, onError: (e) => toast.error(workError(e, w)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent><DialogTitle>{t('leave.request')}</DialogTitle><DialogDescription>{t('leave.requestHint')}</DialogDescription>
        <Field id="lv-type" label={t('leave.type')}><NativeSelect id="lv-type" value={v.leaveTypeId || types?.data[0]?.id || ''} onChange={(e) => setV({ ...v, leaveTypeId: e.target.value })}>{types?.data.map((x) => { const b = bal?.find((y) => y.leaveTypeId === x.id); return <option key={x.id} value={x.id}>{x.name}{b?.remaining != null ? ` (${t('leave.left', { n: b.remaining })})` : ''}</option>; })}</NativeSelect></Field>
        <div className="grid grid-cols-2 gap-3"><Field id="lv-from" label={t('startDate')}><Input id="lv-from" type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} /></Field><Field id="lv-to" label={t('endDate')}><Input id="lv-to" type="date" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} /></Field></div>
        <Field id="lv-reason" label={t('leave.reason')}><Input id="lv-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
        <Button disabled={!v.startDate || !v.endDate || save.isPending} onClick={() => save.mutate()}>{c('save')}</Button>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveTab() {
  const t = useTranslations('hr');
  const w = useTranslations('work');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [creating, setCreating] = useState(false);
  const act = useMutation({
    mutationFn: (a: { id: string; what: 'approve' | 'reject' | 'cancel' }) => api(`/leave-requests/${a.id}/${a.what}`, { method: 'POST', body: {} }),
    onSuccess: () => { toast.success(t('leave.done')); qc.invalidateQueries({ queryKey: ['leave-requests'] }); }, onError: (e) => toast.error(workError(e, w)),
  });
  const cols: Column<Req>[] = [
    { header: t('employee'), cell: (r) => `${r.employee.firstName} ${r.employee.lastName}` }, { header: t('leave.type'), cell: (r) => <>{r.leaveType.name}{!r.leaveType.isPaid && <Badge variant="secondary" className="ms-1">{t('leave.unpaid')}</Badge>}</> },
    { header: t('leave.period'), cell: (r) => `${f.date(r.startDate)} → ${f.date(r.endDate)}` }, { header: t('leave.days'), cell: (r) => Number(r.days), className: 'hidden sm:table-cell' },
    { header: t('status.label'), cell: (r) => <Badge variant={tone(r.status)}>{t(`leave.status.${r.status}`)}</Badge> },
    { header: '', className: 'w-56', cell: (r) => (
      <div className="flex gap-1">
        {r.status === 'PENDING' && can('hr:update') && <><Button size="sm" onClick={() => act.mutate({ id: r.id, what: 'approve' })}>{t('leave.approve')}</Button><Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, what: 'reject' })}>{t('leave.reject')}</Button></>}
        {['PENDING', 'APPROVED'].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => confirm(t('leave.confirmCancel')) && act.mutate({ id: r.id, what: 'cancel' })}>{t('leave.cancel')}</Button>}
      </div>) },
  ];
  return (
    <>
      <DataTable<Req> queryKey="leave-requests" endpoint="/leave-requests" columns={cols} searchable={false} extraQuery={{ status: status || undefined }}
        toolbar={<div className="flex gap-2"><NativeSelect aria-label={t('status.label')} value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">{t('all')}</option>{['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => <option key={s} value={s}>{t(`leave.status.${s}`)}</option>)}</NativeSelect><Button onClick={() => setCreating(true)}><Plus /> {t('leave.request')}</Button></div>} />
      <RequestDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
