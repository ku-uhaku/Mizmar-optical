'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { workError } from '@/lib/work-errors';
import { useFormat } from '@/lib/format';
import { DataTable, type Column } from '@/components/data-table';
import { Field, PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

interface Inv { id: string; number: string; supplierRef: string; status: string; issuedAt: string; dueAt: string | null; total: number; paidTotal: number; balance: number; isOverdue: boolean; supplier: { id: string; name: string } }
interface InvDetail extends Inv { subtotal: number; taxTotal: number; lines: { id: string; description: string; quantity: number; unitCost: number; lineTotal: number }[]; payments: { id: string; amount: number; paidAt: string; reference: string | null }[] }
const tone = (s: string) => (s === 'PAID' ? 'success' : s === 'VOID' ? 'danger' : 'secondary') as 'success' | 'danger' | 'secondary';
const today = () => new Date().toISOString().slice(0, 10);

interface Open { goodsReceiptLineId: string; description: string; quantity: number; unitCost: number; receipt: { number: string } }
interface FormLine { description: string; quantity: number; unitCost: number; goodsReceiptLineId?: string }

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('work');
  const c = useTranslations('common');
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [poId, setPoId] = useState('');
  const [ref, setRef] = useState('');
  const [issuedAt, setIssuedAt] = useState(today());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<FormLine[]>([]);
  const { data: suppliers } = useQuery({ queryKey: ['options', 'suppliers-active'], queryFn: () => api<Paginated<{ id: string; name: string }>>('/suppliers', { query: { limit: 100, isActive: 'true' } }), enabled: open });
  const { data: pos } = useQuery({ queryKey: ['po-for-invoice', supplierId], enabled: !!supplierId, queryFn: () => api<Paginated<{ id: string; number: string }>>('/purchase-orders', { query: { supplierId, limit: 50 } }) });
  const loadMatch = async (id: string) => {
    setPoId(id);
    if (!id) return setLines([]);
    const rows = await api<Open[]>(`/purchase-orders/${id}/uninvoiced`);
    setLines(rows.map((r) => ({ description: r.description, quantity: r.quantity, unitCost: r.unitCost, goodsReceiptLineId: r.goodsReceiptLineId })));
  };
  const save = useMutation({
    mutationFn: () => api('/supplier-invoices', { method: 'POST', body: { supplierId, supplierRef: ref, issuedAt, purchaseOrderId: poId || undefined, notes: notes || undefined, lines } }),
    onSuccess: () => { toast.success(c('saved')); qc.invalidateQueries({ queryKey: ['supplier-invoices'] }); qc.invalidateQueries({ queryKey: ['purchasing-summary'] }); setLines([]); setRef(''); setPoId(''); onClose(); },
    onError: (e) => toast.error(workError(e, t)),
  });
  const set = (i: number, p: Partial<FormLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const invalid = !supplierId || !ref.trim() || lines.length === 0 || lines.some((l) => !l.description.trim() || l.quantity < 1);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>{t('payables.newInvoice')}</DialogTitle>
        <DialogDescription>{t('payables.newInvoiceHint')}</DialogDescription>
        <div className="grid grid-cols-2 gap-3">
          <Field id="inv-supplier" label={t('purchasing.supplier')} required><NativeSelect id="inv-supplier" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setPoId(''); setLines([]); }}><option value="">—</option>{suppliers?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
          <Field id="inv-po" label={t('purchasing.order')} hint={t('payables.matchHint')}><NativeSelect id="inv-po" value={poId} onChange={(e) => loadMatch(e.target.value)} disabled={!supplierId}><option value="">—</option>{pos?.data.map((p) => <option key={p.id} value={p.id}>{p.number}</option>)}</NativeSelect></Field>
          <Field id="inv-ref" label={t('payables.supplierRef')} required><Input id="inv-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          <Field id="inv-date" label={t('payables.issuedAt')} required><Input id="inv-date" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} /></Field>
        </div>
        <ul className="divide-y rounded-md border">
          {lines.map((l, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 p-2 text-sm">
              <Input className="min-w-40 flex-1" aria-label={c('description')} value={l.description} disabled={!!l.goodsReceiptLineId} onChange={(e) => set(i, { description: e.target.value })} />
              <Input type="number" min={1} className="w-20" aria-label={c('quantity')} value={l.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} />
              <Input type="number" min={0} step="0.01" className="w-28" aria-label={t('purchasing.unitCost')} value={l.unitCost} onChange={(e) => set(i, { unitCost: Number(e.target.value) })} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>{c('remove')}</Button>
            </li>
          ))}
          {lines.length === 0 && <li className="p-3 text-sm text-muted-foreground">{t('payables.noLines')}</li>}
        </ul>
        <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { description: '', quantity: 1, unitCost: 0 }])}><Plus /> {t('payables.addLine')}</Button>
        <Field id="inv-notes" label={c('notes')}><Textarea id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button onClick={() => save.mutate()} disabled={invalid || save.isPending}>{c('save')}</Button>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslations('work');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const { data: inv } = useQuery({ queryKey: ['supplier-invoice', id], enabled: !!id, queryFn: () => api<InvDetail>(`/supplier-invoices/${id}`) });
  const { data: methods } = useQuery({ queryKey: ['payment-methods'], enabled: !!id, queryFn: () => api<{ id: string; name: string }[]>('/payment-methods'), staleTime: 60_000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['supplier-invoice', id] }); qc.invalidateQueries({ queryKey: ['supplier-invoices'] }); qc.invalidateQueries({ queryKey: ['purchasing-summary'] }); };
  const pay = useMutation({
    mutationFn: () => api(`/supplier-invoices/${id}/payments`, { method: 'POST', body: { methodId: methodId || methods?.[0]?.id, amount: Number(amount), reference: reference || undefined } }),
    onSuccess: () => { toast.success(t('payables.paid')); setAmount(''); setReference(''); refresh(); },
    onError: (e) => toast.error(workError(e, t)),
  });
  const voidInv = useMutation({ mutationFn: () => api(`/supplier-invoices/${id}/void`, { method: 'POST' }), onSuccess: () => { toast.success(t('payables.voided')); refresh(); }, onError: (e) => toast.error(workError(e, t)) });
  const due = inv ? inv.balance : 0;
  const canPay = inv && !['PAID', 'VOID'].includes(inv.status) && can('finance:approve');

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>{inv?.number} — {inv?.supplier.name}</DialogTitle>
        <DialogDescription>{t('payables.supplierRef')}: {inv?.supplierRef}</DialogDescription>
        {inv && (
          <>
            <Table>
              <THead><TR><TH>{c('description')}</TH><TH>{c('quantity')}</TH><TH>{t('purchasing.unitCost')}</TH><TH className="text-end">{c('total')}</TH></TR></THead>
              <TBody>{inv.lines.map((l) => <TR key={l.id}><TD>{l.description}</TD><TD>{l.quantity}</TD><TD>{f.money(l.unitCost)}</TD><TD className="text-end">{f.money(l.lineTotal)}</TD></TR>)}</TBody>
            </Table>
            <dl className="ms-auto w-64 space-y-1 text-sm">
              <div className="flex justify-between"><dt>{t('purchasing.subtotalExcl')}</dt><dd>{f.money(inv.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>{t('purchasing.tax')}</dt><dd>{f.money(inv.taxTotal)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>{t('purchasing.totalIncl')}</dt><dd>{f.money(inv.total)}</dd></div>
              <div className="flex justify-between"><dt>{t('payables.paidTotal')}</dt><dd>{f.money(inv.paidTotal)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>{t('payables.balance')}</dt><dd className={inv.isOverdue ? 'text-destructive' : undefined}>{f.money(due)}</dd></div>
            </dl>
            {inv.payments.length > 0 && <ul className="divide-y rounded-md border text-sm">{inv.payments.map((p) => <li key={p.id} className="flex justify-between p-2"><span>{f.date(p.paidAt)}{p.reference && ` · ${p.reference}`}</span><span>{f.money(p.amount)}</span></li>)}</ul>}
            {canPay && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                <Field id="pay-method" label={t('payables.method')} className="min-w-36 flex-1"><NativeSelect id="pay-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>{methods?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</NativeSelect></Field>
                <Field id="pay-amount" label={c('price')} className="w-32"><Input id="pay-amount" type="number" min={0} step="0.01" placeholder={String(due)} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field id="pay-ref" label={t('payables.reference')} className="w-36"><Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
                <Button onClick={() => pay.mutate()} disabled={!(Number(amount) > 0) || pay.isPending}><Wallet /> {t('payables.pay')}</Button>
                <Button variant="ghost" size="sm" onClick={() => setAmount(String(due))}>{t('payables.payAll')}</Button>
              </div>
            )}
            {inv.status === 'UNPAID' && can('finance:update') && <Button variant="outline" onClick={() => confirm(t('payables.confirmVoid')) && voidInv.mutate()}>{t('payables.void')}</Button>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PayablesPage() {
  const t = useTranslations('work');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const cols: Column<Inv>[] = [
    { header: t('payables.number'), cell: (i) => <button className="font-mono text-xs underline" onClick={() => setDetail(i.id)}>{i.number}</button> },
    { header: t('payables.supplierRef'), cell: (i) => i.supplierRef, className: 'hidden md:table-cell' },
    { header: t('purchasing.supplier'), cell: (i) => i.supplier.name },
    { header: t('payables.dueAt'), cell: (i) => <>{f.date(i.dueAt)} {i.isOverdue && <Badge variant="danger">{t('payables.overdue')}</Badge>}</>, className: 'hidden sm:table-cell' },
    { header: c('total'), cell: (i) => f.money(i.total) },
    { header: t('payables.balance'), cell: (i) => <span className="font-medium">{f.money(i.balance)}</span> },
    { header: c('status'), cell: (i) => <Badge variant={tone(i.status)}>{t(`payables.status.${i.status}`)}</Badge> },
  ];
  return (
    <RequirePermission permission="finance:read">
      <div className="space-y-4">
        <PageHeader title={t('payables.title')} actions={can('finance:create') ? <Button onClick={() => setCreating(true)}><Plus /> {t('payables.newInvoice')}</Button> : undefined} />
        <DataTable<Inv> queryKey="supplier-invoices" endpoint="/supplier-invoices" columns={cols} extraQuery={{ status: status || undefined, overdue: overdue ? 'true' : undefined }}
          toolbar={<div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> {t('payables.overdueOnly')}</label>
            <NativeSelect aria-label={c('status')} value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">{c('all')}</option>{['UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID'].map((s) => <option key={s} value={s}>{t(`payables.status.${s}`)}</option>)}</NativeSelect>
          </div>} />
        <CreateDialog open={creating} onClose={() => setCreating(false)} />
        <DetailDialog id={detail} onClose={() => setDetail(null)} />
      </div>
    </RequirePermission>
  );
}
