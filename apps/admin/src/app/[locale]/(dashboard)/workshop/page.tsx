'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { workError } from '@/lib/work-errors';
import { useFormat } from '@/lib/format';
import { Field, PageHeader, StatCard } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface Job {
  id: string; number: string; status: string; priority: string; promisedAt: string | null; isOverdue: boolean;
  customer: { firstName: string; lastName: string }; technician: { firstName: string; lastName: string } | null; order: { number: string } | null;
  frameVariant: { product: { name: string } } | null; frameDescription: string | null;
}
export const COLUMNS = ['PENDING', 'LENSES_ORDERED', 'LENSES_RECEIVED', 'CUTTING_MOUNTING', 'QUALITY_CHECK', 'READY', 'ON_HOLD'] as const;
export const jobTone = (s: string) => (s === 'READY' || s === 'DELIVERED' ? 'success' : s === 'CANCELLED' ? 'danger' : s === 'ON_HOLD' ? 'outline' : 'secondary') as 'success' | 'danger' | 'outline' | 'secondary';

function NewJobDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('work');
  const c = useTranslations('common');
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [rxId, setRxId] = useState('');
  const [lensTypeId, setLensTypeId] = useState('');
  const [frame, setFrame] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [promisedAt, setPromisedAt] = useState('');
  const [notes, setNotes] = useState('');
  const { data: customers } = useQuery({ queryKey: ['job-customers', q], enabled: open && q.trim().length >= 2, queryFn: () => api<Paginated<{ id: string; firstName: string; lastName: string; phone: string | null }>>('/customers', { query: { search: q.trim(), limit: 6 } }) });
  const { data: rxs } = useQuery({ queryKey: ['job-rx', customerId], enabled: !!customerId, queryFn: () => api<Paginated<{ id: string; issuedAt: string }> | { id: string; issuedAt: string }[]>(`/customers/${customerId}/prescriptions`) });
  const { data: lensTypes } = useQuery({ queryKey: ['options', '/lens-types'], enabled: open, queryFn: () => api<Paginated<{ id: string; name: string }>>('/lens-types', { query: { limit: 100 } }), staleTime: 60_000 });
  const rxList = Array.isArray(rxs) ? rxs : (rxs?.data ?? []);
  const f = useFormat();
  const save = useMutation({
    mutationFn: () => api<{ id: string }>('/jobs', { method: 'POST', body: { customerId, prescriptionId: rxId || undefined, lensTypeId: lensTypeId || undefined, frameDescription: frame, priority, promisedAt: promisedAt || undefined, notes: notes || undefined } }),
    onSuccess: (j) => { toast.success(c('saved')); qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['jobs-summary'] }); onClose(); router.push(`/workshop/${j.id}` as '/'); },
    onError: (e) => toast.error(workError(e, t)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>{t('workshop.newJob')}</DialogTitle>
        <DialogDescription>{t('workshop.newJobHint')}</DialogDescription>
        <Field id="job-customer" label={t('workshop.customer')} required>
          {customerId ? (
            <div className="flex items-center justify-between rounded-md border p-2 text-sm"><span>{q}</span><Button variant="ghost" size="sm" onClick={() => { setCustomerId(''); setRxId(''); }}>{c('edit')}</Button></div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input id="job-customer" className="ps-8" value={q} placeholder={c('search')} onChange={(e) => setQ(e.target.value)} />
              {(customers?.data.length ?? 0) > 0 && q.trim().length >= 2 && (
                <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
                  {customers!.data.map((cu) => <li key={cu.id}><button type="button" className="w-full rounded px-2 py-1.5 text-start text-sm hover:bg-muted" onClick={() => { setCustomerId(cu.id); setQ(`${cu.firstName} ${cu.lastName}`); }}>{cu.firstName} {cu.lastName} <span className="text-xs text-muted-foreground">{cu.phone}</span></button></li>)}
                </ul>
              )}
            </div>
          )}
        </Field>
        <Field id="job-frame" label={t('workshop.frame')} required hint={t('workshop.frameHint')}><Input id="job-frame" value={frame} onChange={(e) => setFrame(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="job-rx" label={t('workshop.prescription')}><NativeSelect id="job-rx" value={rxId} onChange={(e) => setRxId(e.target.value)} disabled={!customerId}><option value="">—</option>{rxList.map((r) => <option key={r.id} value={r.id}>{f.date(r.issuedAt)}</option>)}</NativeSelect></Field>
          <Field id="job-lens" label={t('workshop.lensType')}><NativeSelect id="job-lens" value={lensTypeId} onChange={(e) => setLensTypeId(e.target.value)}><option value="">—</option>{lensTypes?.data.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></Field>
          <Field id="job-priority" label={t('workshop.priorityLabel')}><NativeSelect id="job-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>{['NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{t(`workshop.priority.${p}`)}</option>)}</NativeSelect></Field>
          <Field id="job-promised" label={t('workshop.promised')}><Input id="job-promised" type="date" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} /></Field>
        </div>
        <Field id="job-notes" label={c('notes')}><Textarea id="job-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button onClick={() => save.mutate()} disabled={!customerId || !frame.trim() || save.isPending}>{c('save')}</Button>
      </DialogContent>
    </Dialog>
  );
}

export default function WorkshopPage() {
  const t = useTranslations('work');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const { data: summary } = useQuery({ queryKey: ['jobs-summary'], queryFn: () => api<{ counts: Record<string, number>; overdue: number; mine: number }>('/jobs/summary') });
  const { data, isLoading } = useQuery({ queryKey: ['jobs', { mine, search }], queryFn: () => api<Paginated<Job>>('/jobs', { query: { open: 'true', limit: 100, sortBy: 'promisedAt', sortOrder: 'asc', mine: mine ? 'true' : undefined, search: search.trim() || undefined } }), refetchInterval: 30_000 });
  const jobs = data?.data ?? [];
  const who = (j: Job) => `${j.customer.firstName} ${j.customer.lastName}`;

  return (
    <RequirePermission permission="workshop:read">
      <div className="space-y-4">
        <PageHeader title={t('workshop.title')} actions={can('workshop:create') ? <Button onClick={() => setCreating(true)}><Plus /> {t('workshop.newJob')}</Button> : undefined} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t('workshop.inWorkshop')} value={['PENDING', 'LENSES_ORDERED', 'LENSES_RECEIVED', 'CUTTING_MOUNTING', 'QUALITY_CHECK'].reduce((n, s) => n + (summary?.counts[s] ?? 0), 0)} />
          <StatCard label={t('workshop.status.READY')} value={summary?.counts.READY ?? 0} />
          <StatCard label={t('workshop.overdue')} value={summary?.overdue ?? 0} tone={summary?.overdue ? 'danger' : undefined} />
          <StatCard label={t('workshop.myJobs')} value={summary?.mine ?? 0} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs"><Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="ps-8" placeholder={c('search')} aria-label={c('search')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t('workshop.myJobs')}</label>
        </div>
        {isLoading && <p className="text-muted-foreground">{c('loading')}</p>}
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => {
            const items = jobs.filter((j) => j.status === col);
            return (
              <section key={col} className="w-64 shrink-0 rounded-lg border bg-muted/30 p-2" aria-label={t(`workshop.status.${col}`)}>
                <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-medium">{t(`workshop.status.${col}`)}<Badge variant="secondary">{items.length}</Badge></h2>
                <ul className="space-y-2">
                  {items.map((j) => (
                    <li key={j.id}>
                      <Link href={`/workshop/${j.id}` as '/'} className="block rounded-md border bg-card p-2 text-sm shadow-sm hover:border-primary">
                        <div className="flex items-center justify-between"><span className="font-mono text-xs">{j.number}</span>{j.priority !== 'NORMAL' && <Badge variant={j.priority === 'URGENT' ? 'danger' : 'default'}>{t(`workshop.priority.${j.priority}`)}</Badge>}</div>
                        <div className="mt-1 font-medium">{who(j)}</div>
                        <div className="truncate text-xs text-muted-foreground">{j.frameVariant?.product.name ?? j.frameDescription}</div>
                        <div className={`mt-1 flex items-center gap-1 text-xs ${j.isOverdue ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>{j.isOverdue && <AlertTriangle className="size-3" />}{f.date(j.promisedAt)}{j.technician && <span className="ms-auto">{j.technician.firstName}</span>}</div>
                      </Link>
                    </li>
                  ))}
                  {items.length === 0 && <li className="px-1 py-3 text-center text-xs text-muted-foreground">—</li>}
                </ul>
              </section>
            );
          })}
        </div>
        <NewJobDialog open={creating} onClose={() => setCreating(false)} />
      </div>
    </RequirePermission>
  );
}
