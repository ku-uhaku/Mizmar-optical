'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Calculator, Check } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { workError } from '@/lib/work-errors';
import { DataTable, type Column } from '@/components/data-table';
import { Field } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Row { id: string; baseAmount: number; amount: number; status: string; orderId: string | null; employee: { firstName: string; lastName: string }; rule: { name: string } | null }

export function CommissionsTab() {
  const t = useTranslations('hr');
  const w = useTranslations('work');
  const f = useFormat();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const done = () => qc.invalidateQueries({ queryKey: ['commissions'] });
  const calc = useMutation({ mutationFn: () => api<{ created: number; total: number }>('/commissions/calculate', { method: 'POST', body: { periodKey: period } }), onSuccess: (r) => { toast.success(t('comm.calculated', { n: r.created, total: f.money(r.total) })); done(); }, onError: (e) => toast.error(workError(e, w)) });
  const approve = useMutation({ mutationFn: () => api<{ approved: number }>('/commissions/approve', { method: 'POST', body: { periodKey: period } }), onSuccess: (r) => { toast.success(t('comm.approved', { n: r.approved })); done(); }, onError: (e) => toast.error(workError(e, w)) });
  const voidOne = useMutation({ mutationFn: (id: string) => api(`/commissions/${id}/void`, { method: 'POST' }), onSuccess: done, onError: (e) => toast.error(workError(e, w)) });
  const cols: Column<Row>[] = [
    { header: t('employee'), cell: (r) => `${r.employee.firstName} ${r.employee.lastName}` }, { header: t('comm.rule'), cell: (r) => r.rule?.name ?? '—', className: 'hidden md:table-cell' },
    { header: t('comm.base'), cell: (r) => f.money(Number(r.baseAmount)), className: 'hidden sm:table-cell' }, { header: t('comm.amount'), cell: (r) => <b>{f.money(Number(r.amount))}</b> },
    { header: t('status.label'), cell: (r) => <Badge variant={r.status === 'PAID' ? 'success' : r.status === 'VOID' ? 'danger' : 'secondary'}>{t(`comm.status.${r.status}`)}</Badge> },
    { header: '', className: 'w-24', cell: (r) => (r.status === 'PENDING' || r.status === 'APPROVED') ? <Button size="sm" variant="ghost" onClick={() => voidOne.mutate(r.id)}>{t('comm.void')}</Button> : null },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="cm-period" label={t('period')}><Input id="cm-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
        <Button variant="outline" onClick={() => calc.mutate()} disabled={calc.isPending}><Calculator /> {t('comm.calculate')}</Button>
        <Button onClick={() => approve.mutate()} disabled={approve.isPending}><Check /> {t('comm.approveAll')}</Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('comm.hint')}</p>
      <DataTable<Row> queryKey="commissions" endpoint="/commissions" columns={cols} searchable={false} extraQuery={{ periodKey: period }} />
    </div>
  );
}
