'use client';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Bell, Check, PackageCheck, Pause, Play, Plus, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { workError } from '@/lib/work-errors';
import { dioptre, useFormat } from '@/lib/format';
import { printHtml } from '@/lib/print';
import { Field, PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { jobTone } from '../page';

type Task = { id: string; name: string; status: 'TODO' | 'IN_PROGRESS' | 'DONE' };
type Lab = { id: string; status: string; reference: string | null; cost: number | null; supplier: { name: string }; orderedAt: string | null; receivedAt: string | null; notes: string | null };
interface JobView {
  id: string; number: string; status: string; priority: string; promisedAt: string | null; readyAt: string | null; deliveredAt: string | null; isOverdue: boolean; notes: string | null; qcPassed: boolean | null; qcNotes: string | null;
  frameDescription: string | null; fitting: Record<string, unknown> | null; treatments: { id: string; name: string }[] | null; customerNotifiedAt: string | null; technicianId: string | null; allowedNext: string[];
  customer: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null }; technician: { id: string; firstName: string; lastName: string } | null;
  order: { id: string; number: string; balanceDue: number } | null; frameVariant: { sku: string; color: string | null; size: string | null; product: { name: string } } | null;
  lensType: { name: string } | null; lensEntry: { name: string } | null; prescription: Record<string, any> | null;
  tasks: Task[]; labLensOrders: Lab[]; history: { id: string; fromStatus: string | null; toStatus: string; note: string | null; changedBy: string | null; createdAt: string }[];
  notifications: { id: string; channel: string; status: string; createdAt: string }[];
}

function LabDialog({ jobId, open, onClose, done }: { jobId: string; open: boolean; onClose: () => void; done: () => void }) {
  const t = useTranslations('work');
  const c = useTranslations('common');
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [cost, setCost] = useState('');
  const { data } = useQuery({ queryKey: ['options', 'lens-labs'], enabled: open, queryFn: () => api<Paginated<{ id: string; name: string }>>('/suppliers', { query: { limit: 100, isActive: 'true', isLensLab: 'true' } }) });
  const save = useMutation({
    mutationFn: () => api(`/jobs/${jobId}/lens-orders`, { method: 'POST', body: { supplierId, reference: reference || undefined, cost: cost ? Number(cost) : undefined } }),
    onSuccess: () => { toast.success(c('saved')); setReference(''); setCost(''); done(); onClose(); },
    onError: (e) => toast.error(workError(e, t)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{t('job.addLensOrder')}</DialogTitle><DialogDescription>{t('job.lensOrderHint')}</DialogDescription>
        <Field id="lab-supplier" label={t('job.lab')} required><NativeSelect id="lab-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">—</option>{data?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
        <Field id="lab-ref" label={t('job.reference')}><Input id="lab-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field id="lab-cost" label={c('cost')}><Input id="lab-cost" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Button onClick={() => save.mutate()} disabled={!supplierId || save.isPending}>{c('save')}</Button>
      </DialogContent>
    </Dialog>
  );
}

function QcDialog({ jobId, open, onClose, done }: { jobId: string; open: boolean; onClose: () => void; done: () => void }) {
  const t = useTranslations('work');
  const [notes, setNotes] = useState('');
  const run = useMutation({
    mutationFn: (passed: boolean) => api(`/jobs/${jobId}/quality-check`, { method: 'POST', body: { passed, notes: notes || undefined } }),
    onSuccess: (_d, passed) => { toast.success(passed ? t('job.qcPassed') : t('job.qcFailed')); setNotes(''); done(); onClose(); },
    onError: (e) => toast.error(workError(e, t)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{t('job.qualityCheck')}</DialogTitle><DialogDescription>{t('job.qcHint')}</DialogDescription>
        <Field id="qc-notes" label={t('job.qcNotes')}><Textarea id="qc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => run.mutate(true)} disabled={run.isPending}><Check /> {t('job.pass')}</Button>
          <Button className="flex-1" variant="outline" onClick={() => run.mutate(false)} disabled={run.isPending || !notes.trim()}>{t('job.fail')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('work');
  const c = useTranslations('common');
  const f = useFormat();
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<'lab' | 'qc' | null>(null);
  const [task, setTask] = useState('');
  const { data: job, error } = useQuery({ queryKey: ['job', id], queryFn: () => api<JobView>(`/jobs/${id}`) });
  const { data: staff } = useQuery({ queryKey: ['job-staff'], enabled: can('workshop:assign') && can('users:read'), queryFn: () => api<Paginated<{ id: string; firstName: string; lastName: string }>>('/users', { query: { limit: 100 } }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['job', id] }); qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['jobs-summary'] }); qc.invalidateQueries({ queryKey: ['order'] }); };
  const call = useMutation({
    mutationFn: (a: { path: string; method?: string; body?: unknown }) => api(`/jobs/${id}${a.path}`, { method: a.method ?? 'POST', body: a.body ?? {} }),
    onSuccess: refresh, onError: (e) => toast.error(workError(e, t)),
  });
  const print = async () => { try { printHtml((await api<{ html: string }>(`/jobs/${id}/document`)).html); } catch (e) { toast.error((e as Error).message); } };
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!job) return <p className="text-muted-foreground">{c('loading')}</p>;

  const closed = ['DELIVERED', 'CANCELLED'].includes(job.status);
  const canWork = can('workshop:update') && !closed;
  const rx = job.prescription;
  const frame = job.frameVariant ? `${job.frameVariant.product.name}${job.frameVariant.color ? ` — ${job.frameVariant.color}` : ''}` : job.frameDescription;
  const nextButtons = job.allowedNext.filter((s) => !['ON_HOLD', 'CANCELLED'].includes(s));
  const mineAssignable = can('workshop:assign') ? (staff?.data ?? []) : user ? [{ id: user.id, firstName: user.firstName, lastName: user.lastName }] : [];

  return (
    <RequirePermission permission="workshop:read">
      <div className="space-y-4">
        <Link href="/workshop" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="size-4 rtl:rotate-180" /> {t('workshop.title')}</Link>
        <PageHeader title={job.number} subtitle={`${job.customer.firstName} ${job.customer.lastName}${job.order ? ` · ${job.order.number}` : ''}`} actions={<>
          <Badge variant={jobTone(job.status)} className="self-center">{t(`workshop.status.${job.status}`)}</Badge>
          {job.isOverdue && <Badge variant="danger" className="self-center">{t('workshop.overdue')}</Badge>}
          <Button variant="outline" onClick={print}><Printer /> {t('job.ticket')}</Button>
        </>} />

        {canWork && (
          <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3" aria-label={t('job.actions')}>
            {nextButtons.map((s) => <Button key={s} onClick={() => call.mutate({ path: '/status', body: { to: s } })} disabled={call.isPending}>{t('job.moveTo', { status: t(`workshop.status.${s}`) })}</Button>)}
            {job.status === 'QUALITY_CHECK' && can('workshop:quality_check') && <Button onClick={() => setDlg('qc')}><Check /> {t('job.qualityCheck')}</Button>}
            {job.status === 'READY' && <Button onClick={() => call.mutate({ path: '/deliver' }, { onSuccess: () => toast.success(t('job.delivered')) })}><PackageCheck /> {t('job.deliver')}</Button>}
            {job.status === 'READY' && <Button variant="outline" onClick={() => call.mutate({ path: '/notify' }, { onSuccess: () => toast.success(t('job.notified')) })}><Bell /> {t('job.notify')}</Button>}
            {job.status === 'ON_HOLD' && <Button onClick={() => call.mutate({ path: '/resume' })}><Play /> {t('job.resume')}</Button>}
            {job.allowedNext.includes('ON_HOLD') && <Button variant="outline" onClick={() => call.mutate({ path: '/status', body: { to: 'ON_HOLD' } })}><Pause /> {t('job.hold')}</Button>}
            {job.allowedNext.includes('CANCELLED') && <Button variant="outline" onClick={() => confirm(t('job.confirmCancel')) && call.mutate({ path: '/status', body: { to: 'CANCELLED' } })}>{c('cancel')}</Button>}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><CardTitle>{t('job.work')}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">{t('workshop.frame')}:</span> <b>{frame}</b></p>
            <p><span className="text-muted-foreground">{t('workshop.lensType')}:</span> <b>{[job.lensType?.name, job.lensEntry?.name].filter(Boolean).join(' · ') || '—'}</b></p>
            {job.treatments && job.treatments.length > 0 && <p className="flex flex-wrap gap-1">{job.treatments.map((x) => <Badge key={x.id} variant="secondary">{x.name}</Badge>)}</p>}
            <p><span className="text-muted-foreground">{t('workshop.promised')}:</span> <b className={job.isOverdue ? 'text-destructive' : undefined}>{f.date(job.promisedAt)}</b></p>
            <p><span className="text-muted-foreground">{t('workshop.priorityLabel')}:</span> {t(`workshop.priority.${job.priority}`)}</p>
            {job.qcNotes && <p className="rounded-md bg-muted p-2">{job.qcPassed === false ? t('job.qcFailed') : t('job.qcPassed')}: {job.qcNotes}</p>}
            {job.notes && <p className="text-muted-foreground">{job.notes}</p>}
            {rx && (
              <Table dir="ltr">
                <THead><TR><TH /><TH>SPH</TH><TH>CYL</TH><TH>AXIS</TH><TH>ADD</TH><TH>PD</TH></TR></THead>
                <TBody>
                  <TR><TD>OD</TD><TD>{dioptre(rx.odSph)}</TD><TD>{dioptre(rx.odCyl)}</TD><TD>{rx.odAxis ?? '—'}</TD><TD>{dioptre(rx.odAdd)}</TD><TD>{rx.odPd ?? '—'}</TD></TR>
                  <TR><TD>OS</TD><TD>{dioptre(rx.osSph)}</TD><TD>{dioptre(rx.osCyl)}</TD><TD>{rx.osAxis ?? '—'}</TD><TD>{dioptre(rx.osAdd)}</TD><TD>{rx.osPd ?? '—'}</TD></TR>
                </TBody>
              </Table>
            )}
          </CardContent></Card>

          <Card><CardHeader><CardTitle>{t('job.bench')}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
            <Field id="job-tech" label={t('workshop.technician')}>
              <NativeSelect id="job-tech" value={job.technicianId ?? ''} disabled={!canWork} onChange={(e) => call.mutate({ path: '/assign', body: { technicianId: e.target.value || null } })}>
                <option value="">—</option>
                {[...new Map([...(job.technician ? [job.technician] : []), ...mineAssignable].map((u) => [u.id, u])).values()].map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
              </NativeSelect>
            </Field>
            <ul className="divide-y rounded-md border">
              {job.tasks.map((k) => (
                <li key={k.id} className="flex items-center gap-2 p-2">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label={k.name} checked={k.status === 'DONE'} disabled={!canWork}
                    onChange={(e) => call.mutate({ path: `/tasks/${k.id}`, method: 'PATCH', body: { status: e.target.checked ? 'DONE' : 'TODO' } })} />
                  <span className={k.status === 'DONE' ? 'flex-1 text-muted-foreground line-through' : 'flex-1'}>{k.name}</span>
                  {canWork && <Button variant="ghost" size="icon" aria-label={c('remove')} onClick={() => call.mutate({ path: `/tasks/${k.id}`, method: 'DELETE' })}><Trash2 className="text-destructive" /></Button>}
                </li>
              ))}
            </ul>
            {canWork && (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (task.trim()) call.mutate({ path: '/tasks', body: { name: task.trim() } }, { onSuccess: () => setTask('') }); }}>
                <Input aria-label={t('job.newTask')} placeholder={t('job.newTask')} value={task} onChange={(e) => setTask(e.target.value)} /><Button type="submit" variant="outline" size="icon" aria-label={c('add')}><Plus /></Button>
              </form>
            )}
          </CardContent></Card>

          <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>{t('job.lensOrders')}</CardTitle>{canWork && <Button size="sm" variant="outline" onClick={() => setDlg('lab')}><Plus /> {c('add')}</Button>}</CardHeader><CardContent>
            {job.labLensOrders.length === 0 ? <p className="text-sm text-muted-foreground">{t('job.noLensOrders')}</p> : (
              <ul className="divide-y text-sm">
                {job.labLensOrders.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
                    <div className="min-w-0 flex-1"><b>{l.supplier.name}</b> {l.reference && <span className="font-mono text-xs">{l.reference}</span>}<div className="text-xs text-muted-foreground">{t(`job.lab_status.${l.status}`)}{l.cost != null && ` · ${f.money(l.cost)}`}</div></div>
                    {canWork && l.status === 'TO_ORDER' && <Button size="sm" onClick={() => call.mutate({ path: `/lens-orders/${l.id}`, method: 'PATCH', body: { status: 'ORDERED' } })}>{t('job.markOrdered')}</Button>}
                    {canWork && l.status === 'ORDERED' && <Button size="sm" onClick={() => call.mutate({ path: `/lens-orders/${l.id}`, method: 'PATCH', body: { status: 'RECEIVED' } })}>{t('job.markReceived')}</Button>}
                    {canWork && ['ORDERED', 'RECEIVED'].includes(l.status) && <Button size="sm" variant="outline" onClick={() => { const n = prompt(t('job.defectNote')); if (n) call.mutate({ path: `/lens-orders/${l.id}`, method: 'PATCH', body: { status: 'DEFECTIVE', notes: n } }); }}>{t('job.markDefective')}</Button>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent></Card>

          <Card><CardHeader><CardTitle>{t('job.history')}</CardTitle></CardHeader><CardContent>
            <ol className="space-y-2 text-sm">
              {[...job.history].reverse().map((h) => (
                <li key={h.id}><b>{t(`workshop.status.${h.toStatus}`)}</b> <span className="text-xs text-muted-foreground">{f.dateTime(h.createdAt)}{h.changedBy && ` · ${h.changedBy}`}</span>{h.note && <div className="text-xs text-muted-foreground">{h.note}</div>}</li>
              ))}
            </ol>
            {job.notifications.length > 0 && <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">{t('job.notifications')}: {job.notifications.map((n) => `${n.channel} (${n.status})`).join(', ')}</p>}
          </CardContent></Card>
        </div>
        <LabDialog jobId={id} open={dlg === 'lab'} onClose={() => setDlg(null)} done={refresh} />
        <QcDialog jobId={id} open={dlg === 'qc'} onClose={() => setDlg(null)} done={refresh} />
      </div>
    </RequirePermission>
  );
}
