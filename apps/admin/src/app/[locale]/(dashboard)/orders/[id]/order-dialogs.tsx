'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { salesError } from '@/lib/errors';
import { useFormat } from '@/lib/format';
import { Field } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { PosConfig } from '../../pos/types';

export interface OrderLine { id: string; description: string; quantity: number; lineTotal: number; returnableQty: number; returnedQty: number }
export interface OrderView { id: string; number: string; total: number; paidTotal: number; balanceDue: number; status: string; lines: OrderLine[] }

const useMethods = (enabled: boolean) => useQuery({ queryKey: ['pos-config'], queryFn: () => api<PosConfig>('/pos/config'), enabled, staleTime: 60_000 });
const useRefresh = (id: string) => { const qc = useQueryClient(); return () => { for (const k of ['order', 'orders', 'invoices', 'pos-current', 'products']) qc.invalidateQueries({ queryKey: [k, ...(k === 'order' ? [id] : [])] }); qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('inv') }); }; };

export function PaymentDialog({ order, open, onClose }: { order: OrderView; open: boolean; onClose: () => void }) {
  const t = useTranslations('orders');
  const p = useTranslations('pos');
  const c = useTranslations('common');
  const f = useFormat();
  const refresh = useRefresh(order.id);
  const methods = useMethods(open);
  const [methodId, setMethodId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const mid = methodId || methods.data?.paymentMethods[0]?.id || '';
  const pay = useMutation({
    mutationFn: () => api(`/orders/${order.id}/payments`, { method: 'POST', body: { methodId: mid, amount: Number(amount || order.balanceDue), reference: reference || undefined } }),
    onSuccess: () => { toast.success(c('saved')); refresh(); setAmount(''); setReference(''); onClose(); }, onError: (e) => toast.error(salesError(e, p)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent><DialogTitle>{t('addPayment')}</DialogTitle><DialogDescription>{t('balanceDue', { amount: f.money(order.balanceDue) })}</DialogDescription>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); pay.mutate(); }}>
          <Field id="op-method" label={p('method')}><NativeSelect id="op-method" value={mid} onChange={(e) => setMethodId(e.target.value)}>{methods.data?.paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</NativeSelect></Field>
          <Field id="op-amount" label={c('price')}><Input id="op-amount" type="number" min={0.01} max={order.balanceDue} step="0.01" inputMode="decimal" placeholder={String(order.balanceDue)} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field id="op-ref" label={p('reference')}><Input id="op-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          <Button type="submit" className="w-full" disabled={pay.isPending || !mid}>{c('save')}</Button>
        </form></DialogContent>
    </Dialog>
  );
}

export function ReturnDialog({ order, open, onClose }: { order: OrderView; open: boolean; onClose: () => void }) {
  const t = useTranslations('orders');
  const p = useTranslations('pos');
  const c = useTranslations('common');
  const f = useFormat();
  const refresh = useRefresh(order.id);
  const methods = useMethods(open);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [damaged, setDamaged] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [methodId, setMethodId] = useState('');
  const [refund, setRefund] = useState(true);
  const mid = methodId || methods.data?.paymentMethods[0]?.id || '';
  const picked = order.lines.filter((l) => Number(qty[l.id]) > 0);
  const estimate = picked.reduce((n, l) => n + (l.lineTotal * Number(qty[l.id])) / l.quantity, 0);
  const submit = useMutation({
    mutationFn: () => api(`/orders/${order.id}/returns`, { method: 'POST', body: { reason: reason || undefined, lines: picked.map((l) => ({ orderLineId: l.id, quantity: Number(qty[l.id]), condition: damaged[l.id] ? 'DAMAGED' : undefined })), refund: refund ? { methodId: mid } : undefined } }),
    onSuccess: () => { toast.success(t('returnDone')); refresh(); setQty({}); onClose(); }, onError: (e) => toast.error(salesError(e, p)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl"><DialogTitle>{t('return')}</DialogTitle><DialogDescription>{t('returnHint')}</DialogDescription>
        <ul className="divide-y rounded-md border">
          {order.lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3 p-2.5 text-sm">
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{l.description}</div><div className="text-xs text-muted-foreground">{t('returnable', { count: l.returnableQty, total: l.quantity })}</div></div>
              {l.returnableQty > 0 ? (<>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!!damaged[l.id]} onChange={(e) => setDamaged({ ...damaged, [l.id]: e.target.checked })} /> {t('damaged')}</label>
                <Input type="number" min={0} max={l.returnableQty} className="h-8 w-16 text-end" aria-label={`${c('quantity')} ${l.description}`} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
              </>) : <span className="text-xs text-muted-foreground">{t('fullyReturned')}</span>}
            </li>
          ))}
        </ul>
        <Field id="rt-reason" label={c('reason')}><Textarea id="rt-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={refund} onChange={(e) => setRefund(e.target.checked)} /> {t('refundNow')}</label>
        {refund && <Field id="rt-method" label={t('refundVia')}><NativeSelect id="rt-method" value={mid} onChange={(e) => setMethodId(e.target.value)}>{methods.data?.paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</NativeSelect></Field>}
        <div className="flex items-center justify-between border-t pt-3"><span className="text-sm text-muted-foreground">{t('estimatedRefund')}</span><span className="text-lg font-semibold">≈ {f.money(estimate)}</span></div>
        <Button disabled={picked.length === 0 || submit.isPending || (refund && !mid)} onClick={() => submit.mutate()}>{t('confirmReturn')}</Button>
      </DialogContent>
    </Dialog>
  );
}

export function CancelDialog({ order, open, onClose }: { order: OrderView; open: boolean; onClose: () => void }) {
  const t = useTranslations('orders');
  const p = useTranslations('pos');
  const c = useTranslations('common');
  const f = useFormat();
  const refresh = useRefresh(order.id);
  const methods = useMethods(open && order.paidTotal > 0);
  const [reason, setReason] = useState('');
  const [methodId, setMethodId] = useState('');
  const mid = methodId || methods.data?.paymentMethods[0]?.id || '';
  const cancel = useMutation({
    mutationFn: () => api(`/orders/${order.id}/cancel`, { method: 'POST', body: { reason, refund: order.paidTotal > 0 ? { methodId: mid } : undefined } }),
    onSuccess: () => { toast.success(t('cancelled')); refresh(); onClose(); }, onError: (e) => toast.error(salesError(e, p)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent><DialogTitle>{t('cancelOrder')}</DialogTitle><DialogDescription>{t('cancelHint')}</DialogDescription>
        <Field id="cn-reason" label={c('reason')} required><Textarea id="cn-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {order.paidTotal > 0 && <Field id="cn-method" label={t('refundVia')} hint={t('refundAll', { amount: f.money(order.paidTotal) })}><NativeSelect id="cn-method" value={mid} onChange={(e) => setMethodId(e.target.value)}>{methods.data?.paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</NativeSelect></Field>}
        <Button variant="destructive" disabled={!reason.trim() || cancel.isPending || (order.paidTotal > 0 && !mid)} onClick={() => cancel.mutate()}>{t('confirmCancel')}</Button>
      </DialogContent>
    </Dialog>
  );
}
