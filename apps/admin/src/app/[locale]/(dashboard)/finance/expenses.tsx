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

interface Exp { id: string; number: string; description: string; amount: number; taxAmount: number; status: string; incurredAt: string; category: { name: string }; supplier: { name: string } | null }
const tone = (s: string) => (s === 'PAID' ? 'success' : s === 'REJECTED' ? 'danger' : s === 'APPROVED' ? 'secondary' : 'outline') as 'success' | 'danger' | 'secondary' | 'outline';

function NewExpense({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('finance');
  const w = useTranslations('work');
  const c = useTranslations('common');
  const qc = useQueryClient();
  const [v, setV] = useState({ categoryId: '', description: '', amount: '', taxAmount: '', incurredAt: new Date().toISOString().slice(0, 10) });
  const { data: cats } = useQuery({ queryKey: ['expense-cats'], enabled: open, queryFn: () => api<Paginated<{ id: string; name: string }>>('/expense-categories', { query: { limit: 100, isActive: 'true' } }) });
  const save = useMutation({
    mutationFn: () => api('/expenses', { method: 'POST', body: { categoryId: v.categoryId || cats?.data[0]?.id, description: v.description, amount: Number(v.amount), taxAmount: v.taxAmount ? Number(v.taxAmount) : undefined, incurredAt: v.incurredAt } }),
    onSuccess: () => { toast.success(c('saved')); qc.invalidateQueries({ queryKey: ['expenses'] }); setV({ ...v, description: '', amount: '', taxAmount: '' }); onClose(); }, onError: (e) => toast.error(workError(e, w)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent><DialogTitle>{t('exp.new')}</DialogTitle><DialogDescription>{t('exp.hint')}</DialogDescription>
        <Field id="ex-cat" label={t('exp.category')}><NativeSelect id="ex-cat" value={v.categoryId || cats?.data[0]?.id || ''} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>{cats?.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field>
        <Field id="ex-desc" label={c('description')}><Input id="ex-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field id="ex-amount" label={t('exp.amountIncl')}><Input id="ex-amount" type="number" min={0} step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
          <Field id="ex-tax" label={t('exp.vat')}><Input id="ex-tax" type="number" min={0} step="0.01" value={v.taxAmount} onChange={(e) => setV({ ...v, taxAmount: e.target.value })} /></Field>
          <Field id="ex-date" label={c('date')}><Input id="ex-date" type="date" value={v.incurredAt} onChange={(e) => setV({ ...v, incurredAt: e.target.value })} /></Field>
        </div>
        <Button disabled={!v.description.trim() || !(Number(v.amount) > 0) || save.isPending} onClick={() => save.mutate()}>{c('save')}</Button>
      </DialogContent>
    </Dialog>
  );
}

export function ExpensesTab() {
  const t = useTranslations('finance');
  const w = useTranslations('work');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const { data: accounts } = useQuery({ queryKey: ['bank-accounts-opts'], queryFn: () => api<Paginated<{ id: string; name: string }>>('/bank-accounts', { query: { limit: 50, isActive: 'true' } }) });
  const act = useMutation({
    mutationFn: (a: { id: string; what: 'approve' | 'reject' | 'pay'; body?: unknown }) => api(`/expenses/${a.id}/${a.what}`, { method: 'POST', body: a.body ?? {} }),
    onSuccess: () => { toast.success(t('exp.done')); qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['fin-summary'] }); }, onError: (e) => toast.error(workError(e, w)),
  });
  const cols: Column<Exp>[] = [
    { header: t('exp.number'), cell: (e) => <span className="font-mono text-xs">{e.number}</span>, className: 'hidden md:table-cell' }, { header: t('exp.date'), cell: (e) => f.date(e.incurredAt) },
    { header: t('exp.description'), cell: (e) => <span><b>{e.description}</b><span className="block text-xs text-muted-foreground">{e.category.name}{e.supplier ? ` · ${e.supplier.name}` : ''}</span></span> },
    { header: t('exp.amount'), cell: (e) => f.money(Number(e.amount)) }, { header: t('exp.status'), cell: (e) => <Badge variant={tone(e.status)}>{t(`exp.statuses.${e.status}`)}</Badge> },
    { header: '', className: 'w-64', cell: (e) => !can('finance:approve') ? null : (
      <div className="flex gap-1">
        {e.status === 'DRAFT' && <><Button size="sm" onClick={() => act.mutate({ id: e.id, what: 'approve' })}>{t('exp.approve')}</Button><Button size="sm" variant="outline" onClick={() => act.mutate({ id: e.id, what: 'reject' })}>{t('exp.reject')}</Button></>}
        {e.status === 'APPROVED' && <Button size="sm" onClick={() => act.mutate({ id: e.id, what: 'pay', body: { bankAccountId: accounts?.data[0]?.id } })}>{t('exp.pay')}</Button>}
      </div>) },
  ];
  return (
    <>
      <DataTable<Exp> queryKey="expenses" endpoint="/expenses" columns={cols} extraQuery={{ status: status || undefined }}
        toolbar={<div className="flex gap-2"><NativeSelect aria-label={t('exp.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">{t('all')}</option>{['DRAFT', 'APPROVED', 'PAID', 'REJECTED'].map((s) => <option key={s} value={s}>{t(`exp.statuses.${s}`)}</option>)}</NativeSelect>{can('finance:create') && <Button onClick={() => setCreating(true)}><Plus /> {t('exp.new')}</Button>}</div>} />
      <NewExpense open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
