'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { workError } from '@/lib/work-errors';
import { DataTable, type Column } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Run { id: string; periodKey: string; status: string; totalGross: number; totalNet: number; _count: { payslips: number } }
export const runTone = (s: string) => (s === 'PAID' ? 'success' : s === 'APPROVED' ? 'secondary' : 'outline') as 'success' | 'secondary' | 'outline';

export function PayrollTab() {
  const t = useTranslations('hr');
  const w = useTranslations('work');
  const f = useFormat();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const create = useMutation({ mutationFn: () => api('/payroll/runs', { method: 'POST', body: { periodKey: period } }), onSuccess: () => { toast.success(t('pay.created')); qc.invalidateQueries({ queryKey: ['payroll-runs'] }); }, onError: (e) => toast.error(workError(e, w)) });
  const cols: Column<Run>[] = [
    { header: t('period'), cell: (r) => <Link href={`/hr/payroll/${r.id}` as '/'} className="font-medium underline">{r.periodKey}</Link> },
    { header: t('pay.payslips'), cell: (r) => r._count.payslips }, { header: t('pay.gross'), cell: (r) => f.money(Number(r.totalGross)), className: 'hidden sm:table-cell' }, { header: t('pay.net'), cell: (r) => <b>{f.money(Number(r.totalNet))}</b> },
    { header: t('status.label'), cell: (r) => <Badge variant={runTone(r.status)}>{t(`pay.status.${r.status}`)}</Badge> },
  ];
  return (
    <div className="space-y-4">
      <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{t('pay.disclaimer')}</p>
      <DataTable<Run> queryKey="payroll-runs" endpoint="/payroll/runs" columns={cols} searchable={false}
        toolbar={<div className="flex gap-2"><Input type="month" aria-label={t('period')} value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44" /><Button onClick={() => create.mutate()} disabled={create.isPending}><Plus /> {t('pay.newRun')}</Button></div>} />
    </div>
  );
}
