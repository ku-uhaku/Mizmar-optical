'use client';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Check, Printer, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/navigation';
import { api, type Paginated } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { printHtml } from '@/lib/print';
import { workError } from '@/lib/work-errors';
import { Field, PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { runTone } from '../../payroll';

interface Line { id: string; kind: string; label: string; amount: number; sortOrder: number }
interface Slip { id: string; number: string; baseSalary: number; commissions: number; gross: number; net: number; socialContrib: number; incomeTax: number; status: string; employee: { firstName: string; lastName: string; employeeNumber: string }; lines: Line[] }
interface Run { id: string; periodKey: string; status: string; totalGross: number; totalNet: number; payslips: Slip[] }

function AdjustDialog({ run, slip, onClose }: { run: Run; slip: Slip | null; onClose: () => void }) {
  const t = useTranslations('hr');
  const w = useTranslations('work');
  const c = useTranslations('common');
  const qc = useQueryClient();
  const [v, setV] = useState({ kind: 'BONUS', label: '', amount: '' });
  const save = useMutation({
    mutationFn: () => api(`/payroll/runs/${run.id}/payslips/${slip!.id}/adjust`, { method: 'POST', body: { kind: v.kind, label: v.label, amount: Number(v.amount) } }),
    onSuccess: () => { toast.success(c('saved')); qc.invalidateQueries({ queryKey: ['payroll-run', run.id] }); setV({ kind: 'BONUS', label: '', amount: '' }); onClose(); }, onError: (e) => toast.error(workError(e, w)),
  });
  return (
    <Dialog open={!!slip} onOpenChange={(o) => !o && onClose()}>
      <DialogContent><DialogTitle>{t('pay.adjust')}</DialogTitle><DialogDescription>{slip?.employee.firstName} {slip?.employee.lastName}</DialogDescription>
        <Field id="adj-kind" label={c('type')}><NativeSelect id="adj-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{['BONUS', 'DEDUCTION'].map((k) => <option key={k} value={k}>{t(`pay.kinds.${k}`)}</option>)}</NativeSelect></Field>
        <Field id="adj-label" label={c('description')}><Input id="adj-label" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} /></Field>
        <Field id="adj-amount" label={c('price')}><Input id="adj-amount" type="number" min={0} step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
        <Button disabled={!v.label.trim() || !(Number(v.amount) > 0) || save.isPending} onClick={() => save.mutate()}>{c('save')}</Button>
      </DialogContent>
    </Dialog>
  );
}

export default function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('hr');
  const w = useTranslations('work');
  const c = useTranslations('common');
  const f = useFormat();
  const router = useRouter();
  const qc = useQueryClient();
  const [adjusting, setAdjusting] = useState<Slip | null>(null);
  const [account, setAccount] = useState('');
  const { data: run } = useQuery({ queryKey: ['payroll-run', id], queryFn: () => api<Run>(`/payroll/runs/${id}`) });
  const { data: accounts } = useQuery({ queryKey: ['bank-accounts'], queryFn: () => api<Paginated<{ id: string; name: string }>>('/bank-accounts', { query: { limit: 50 } }).catch(() => ({ data: [], meta: {} as never })) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['payroll-run', id] }); qc.invalidateQueries({ queryKey: ['payroll-runs'] }); };
  const call = useMutation({ mutationFn: (a: { path: string; body?: unknown; method?: string }) => api(`/payroll/runs/${id}${a.path}`, { method: a.method ?? 'POST', body: a.body ?? {} }), onSuccess: (_d, a) => { toast.success(c('saved')); if (a.method === 'DELETE' && a.path === '') router.push('/hr' as '/'); else refresh(); }, onError: (e) => toast.error(workError(e, w)) });
  const print = async (slipId: string) => { try { printHtml((await api<{ html: string }>(`/payslips/${slipId}/document`)).html); } catch (e) { toast.error((e as Error).message); } };
  if (!run) return <p className="text-muted-foreground">{c('loading')}</p>;
  const draft = run.status === 'DRAFT';
  return (
    <RequirePermission permission="hr:payroll">
      <div className="space-y-4">
        <Link href={'/hr' as '/'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="size-4 rtl:rotate-180" /> {t('title')}</Link>
        <PageHeader title={`${t('pay.run')} ${run.periodKey}`} subtitle={`${t('pay.gross')} ${f.money(Number(run.totalGross))} · ${t('pay.net')} ${f.money(Number(run.totalNet))}`} actions={<>
          <Badge variant={runTone(run.status)} className="self-center">{t(`pay.status.${run.status}`)}</Badge>
          {draft && <Button onClick={() => confirm(t('pay.confirmApprove')) && call.mutate({ path: '/approve' })}><Check /> {t('pay.approve')}</Button>}
          {draft && <Button variant="outline" onClick={() => confirm(t('pay.confirmDelete')) && call.mutate({ path: '', method: 'DELETE' })}><Trash2 /> {c('delete')}</Button>}
          {run.status === 'APPROVED' && <><NativeSelect aria-label={t('pay.account')} value={account} onChange={(e) => setAccount(e.target.value)} className="w-48"><option value="">{t('pay.noAccount')}</option>{accounts?.data.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect><Button onClick={() => confirm(t('pay.confirmPay')) && call.mutate({ path: '/pay', body: { bankAccountId: account || undefined } })}><Wallet /> {t('pay.markPaid')}</Button></>}
        </>} />
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{t('pay.disclaimer')}</p>
        <div className="space-y-3">
          {run.payslips.map((s) => (
            <details key={s.id} className="rounded-lg border bg-card">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3"><span><b>{s.employee.firstName} {s.employee.lastName}</b> <span className="font-mono text-xs text-muted-foreground">{s.number}</span></span><span className="flex items-center gap-4 text-sm"><span className="text-muted-foreground">{t('pay.gross')} {f.money(Number(s.gross))}</span><b>{f.money(Number(s.net))}</b></span></summary>
              <div className="space-y-3 border-t p-3">
                <Table><THead><TR><TH>{c('description')}</TH><TH className="text-end">{t('pay.amount')}</TH><TH /></TR></THead>
                  <TBody>{s.lines.map((l) => <TR key={l.id}><TD>{l.label}</TD><TD className={`text-end ${Number(l.amount) < 0 ? 'text-destructive' : ''}`}>{f.money(Number(l.amount))}</TD><TD className="w-10">{draft && l.sortOrder === 50 && <button aria-label={c('remove')} onClick={() => call.mutate({ path: `/payslips/${s.id}/adjustments/${l.id}`, method: 'DELETE' })}><Trash2 className="size-4 text-destructive" /></button>}</TD></TR>)}</TBody></Table>
                <div className="flex gap-2">{draft && <Button size="sm" variant="outline" onClick={() => setAdjusting(s)}>{t('pay.adjust')}</Button>}<Button size="sm" variant="outline" onClick={() => print(s.id)}><Printer /> {t('pay.print')}</Button></div>
              </div>
            </details>
          ))}
        </div>
        <AdjustDialog run={run} slip={adjusting} onClose={() => setAdjusting(null)} />
      </div>
    </RequirePermission>
  );
}
