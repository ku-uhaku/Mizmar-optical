'use client';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Plus, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { salesError } from '@/lib/errors';
import { useFormat } from '@/lib/format';
import { printHtml } from '@/lib/print';
import { uuid } from '@/lib/uuid';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { toApiLines, type CartLine, type CustomerLite, type PosConfig, type PricedCart } from './types';

interface Row { id: string; methodId: string; amount: string; reference: string; tendered: string }
interface DoneOrder { id: string; number: string; total: number; paidTotal: number; balanceDue: number; status: string; invoices: { id: string; number: string }[] }

const cents = (n: number) => Math.round(n * 100);

/**
 * Collect payment: split tenders, change for cash, and (prescription orders) a deposit with the balance left open.
 * A fresh clientRef is made each time the dialog opens, so a retry of THIS attempt can never sell twice.
 */
export function PaymentDialog({ open, onClose, onFinished, cart, lines, customer, config, quoteId }: {
  open: boolean; onClose: () => void; onFinished: () => void; cart: PricedCart; lines: CartLine[]; customer: CustomerLite | null; config: PosConfig; quoteId?: string | null;
}) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const f = useFormat();
  const qc = useQueryClient();
  const clientRef = useRef(uuid());
  const cash = config.paymentMethods.find((m) => m.type === 'CASH') ?? config.paymentMethods[0];
  // the page mounts this dialog only while paying, so a fresh attempt always starts from the full amount
  const [rows, setRows] = useState<Row[]>(() => [{ id: uuid(), methodId: cash?.id ?? '', amount: cart.total.toFixed(2), reference: '', tendered: '' }]);
  const [done, setDone] = useState<DoneOrder | null>(null);
  const [change, setChange] = useState(0);
  const total = cart.total, min = cart.minimumPayment;

  const paid = rows.reduce((n, r) => n + cents(Number(r.amount) || 0), 0);
  const due = cents(total) - paid;
  const methodOf = (id: string) => config.paymentMethods.find((m) => m.id === id);
  const valid = rows.length > 0 && rows.every((r) => r.methodId && Number(r.amount) > 0) && paid <= cents(total) && (paid >= cents(min) || total === 0) && (paid > 0 || total === 0);

  const checkout = useMutation({
    mutationFn: () => api<DoneOrder>('/pos/checkout', { method: 'POST', body: { clientRef: clientRef.current, customerId: customer?.id, quoteId: quoteId || undefined, lines: toApiLines(lines), payments: rows.filter((r) => Number(r.amount) > 0).map((r) => ({ methodId: r.methodId, amount: Number(r.amount), reference: r.reference || undefined })) } }),
    onSuccess: (o) => {
      // change due = cash handed over minus the cash portion we keep
      const cashRows = rows.filter((r) => methodOf(r.methodId)?.type === 'CASH' && Number(r.tendered) > 0);
      setChange(cashRows.reduce((n, r) => n + Math.max(0, cents(Number(r.tendered)) - cents(Number(r.amount))), 0) / 100);
      setDone(o);
      for (const k of ['pos-current', 'products', 'orders', 'invoices', 'quotes', 'customer']) qc.invalidateQueries({ queryKey: [k] });
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('inv') });
    },
    onError: (e) => toast.error(salesError(e, t)),
  });

  const setRow = (id: string, patch: Partial<Row>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const fillRemaining = (id: string) => setRow(id, { amount: (Math.max(0, cents(total) - (paid - cents(Number(rows.find((r) => r.id === id)?.amount) || 0))) / 100).toFixed(2) });
  const printDoc = async (path: string) => { try { printHtml((await api<{ html: string }>(path)).html); } catch (e) { toast.error((e as Error).message); } };

  if (done) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onFinished()}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-6 text-emerald-600" /> {t('sale.done')}</DialogTitle>
          <DialogDescription>{done.number}</DialogDescription>
          <dl className="space-y-1.5 rounded-md border p-3 text-sm">
            <div className="flex justify-between"><dt>{c('total')}</dt><dd className="font-semibold">{f.money(done.total)}</dd></div>
            <div className="flex justify-between"><dt>{t('sale.paid')}</dt><dd>{f.money(done.paidTotal)}</dd></div>
            {done.balanceDue > 0 && <div className="flex justify-between font-semibold text-amber-600"><dt>{t('sale.balanceDue')}</dt><dd>{f.money(done.balanceDue)}</dd></div>}
            {change > 0 && <div className="flex justify-between border-t pt-1.5 text-lg font-bold text-emerald-600"><dt>{t('sale.change')}</dt><dd>{f.money(change)}</dd></div>}
          </dl>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => printDoc(`/orders/${done.id}/receipt`)}><Printer /> {t('sale.receipt')}</Button>
            <Button variant="outline" disabled={!done.invoices[0]} onClick={() => done.invoices[0] && printDoc(`/invoices/${done.invoices[0].id}/document`)}><Printer /> {t('sale.invoice')}</Button>
          </div>
          <Button size="lg" autoFocus onClick={onFinished}>{t('sale.new')}</Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !checkout.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>{t('pay')}</DialogTitle>
        <DialogDescription>{customer ? `${customer.firstName} ${customer.lastName}` : t('walkIn')}</DialogDescription>
        <div className="flex items-baseline justify-between rounded-md bg-muted px-3 py-2"><span className="text-sm text-muted-foreground">{t('amountDue')}</span><span className="text-2xl font-bold">{f.money(total)}</span></div>
        {cart.hasLens && <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">{t('depositInfo', { percent: cart.depositPercent ?? 0, amount: f.money(min) })}</p>}

        <div className="space-y-2">
          {rows.map((r) => {
            const m = methodOf(r.methodId);
            const tendered = Number(r.tendered), amount = Number(r.amount);
            return (
              <div key={r.id} className="space-y-1.5 rounded-md border p-2.5">
                <div className="flex gap-2">
                  <NativeSelect aria-label={t('method')} value={r.methodId} onChange={(e) => setRow(r.id, { methodId: e.target.value })}>{config.paymentMethods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect>
                  <Input type="number" min={0.01} step="0.01" inputMode="decimal" className="w-32 text-end" aria-label={c('price')} value={r.amount} onChange={(e) => setRow(r.id, { amount: e.target.value })} />
                  <Button type="button" variant="outline" size="sm" onClick={() => fillRemaining(r.id)}>{t('rest')}</Button>
                  {rows.length > 1 && <Button type="button" variant="ghost" size="icon" aria-label={c('remove')} onClick={() => setRows(rows.filter((x) => x.id !== r.id))}><Trash2 className="text-destructive" /></Button>}
                </div>
                {m?.type === 'CASH' ? (
                  <div className="flex items-center gap-2 text-sm"><label htmlFor={`t-${r.id}`} className="text-muted-foreground">{t('tendered')}</label><Input id={`t-${r.id}`} type="number" min={0} step="0.01" inputMode="decimal" className="h-8 w-28 text-end" value={r.tendered} onChange={(e) => setRow(r.id, { tendered: e.target.value })} />
                    {tendered > amount && <span className="font-semibold text-emerald-600">{t('sale.change')}: {f.money(tendered - amount)}</span>}</div>
                ) : <Input aria-label={t('reference')} placeholder={t('reference')} className="h-8" value={r.reference} onChange={(e) => setRow(r.id, { reference: e.target.value })} />}
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { id: uuid(), methodId: config.paymentMethods[0]?.id ?? '', amount: Math.max(0, due / 100).toFixed(2), reference: '', tendered: '' }])}><Plus /> {t('addPayment')}</Button>
        </div>

        <div className="space-y-0.5 text-sm" aria-live="polite">
          <div className="flex justify-between"><span className="text-muted-foreground">{t('sale.paid')}</span><span>{f.money(paid / 100)}</span></div>
          {due > 0 && <div className={`flex justify-between font-medium ${cart.hasLens && paid >= cents(min) ? 'text-amber-600' : 'text-destructive'}`}><span>{cart.hasLens && paid >= cents(min) ? t('sale.balanceDue') : t('sale.remaining')}</span><span>{f.money(due / 100)}</span></div>}
          {due < 0 && <div className="flex justify-between font-medium text-destructive"><span>{t('sale.over')}</span><span>{f.money(-due / 100)}</span></div>}
        </div>
        <Button size="lg" className="h-12 text-base" disabled={!valid || checkout.isPending} onClick={() => checkout.mutate()}>{checkout.isPending ? t('processing') : t('confirmPayment')}</Button>
      </DialogContent>
    </Dialog>
  );
}
