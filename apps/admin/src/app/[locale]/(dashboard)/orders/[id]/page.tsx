'use client';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft, CreditCard, PackageCheck, Printer, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { salesError } from '@/lib/errors';
import { dioptre, useFormat } from '@/lib/format';
import { printHtml } from '@/lib/print';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { payTone, statusTone } from '../page';
import { CancelDialog, PaymentDialog, ReturnDialog, type OrderView } from './order-dialogs';

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('orders');
  const p = useTranslations('pos');
  const r = useTranslations('rx');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<'pay' | 'return' | 'cancel' | null>(null);
  const { data: o, isLoading, error } = useQuery({ queryKey: ['order', id], queryFn: () => api<any>(`/orders/${id}`) });
  const deliver = useMutation({ mutationFn: () => api(`/orders/${id}/deliver`, { method: 'POST' }), onSuccess: () => { toast.success(t('delivered')); qc.invalidateQueries({ queryKey: ['order', id] }); qc.invalidateQueries({ queryKey: ['orders'] }); }, onError: (e) => toast.error(salesError(e, p)) });
  const printDoc = async (path: string) => { try { printHtml((await api<{ html: string }>(path)).html); } catch (e) { toast.error((e as Error).message); } };

  const view = o as (OrderView & Record<string, any>) | undefined;
  const open = view && !['CANCELLED', 'COMPLETED'].includes(view.status);
  const canCancel = view && ['PENDING', 'CONFIRMED', 'PROCESSING', 'READY'].includes(view.status) && view.returns.length === 0;
  const hasReturnable = view?.lines.some((l: any) => l.returnableQty > 0);

  return (
    <RequirePermission permission="orders:read">
      <div className="space-y-4">
        <Link href={'/orders' as '/'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" /> {t('title')}</Link>
        {isLoading && <p className="text-muted-foreground">{c('loading')}</p>}
        {error && <p className="text-destructive">{(error as Error).message}</p>}
        {view && (<>
          <PageHeader title={view.number} subtitle={[f.dateTime(view.placedAt), view.cashier && `${view.cashier.firstName} ${view.cashier.lastName}`].filter(Boolean).join(' · ')}
            actions={<>
              <Button variant="outline" onClick={() => printDoc(`/orders/${id}/receipt`)}><Printer /> {t('receipt')}</Button>
              {view.invoices[0] && can('invoices:read') && <Button variant="outline" onClick={() => printDoc(`/invoices/${view.invoices[0].id}/document`)}><Printer /> {t('invoice')}</Button>}
              {open && view.balanceDue > 0 && can('payments:create') && <Button onClick={() => setDlg('pay')}><CreditCard /> {t('addPayment')}</Button>}
              {open && view.balanceDue === 0 && can('orders:update') && <Button onClick={() => confirm(t('confirmDeliver')) && deliver.mutate()}><PackageCheck /> {t('handOver')}</Button>}
              {hasReturnable && view.status !== 'CANCELLED' && can('returns:create') && <Button variant="outline" onClick={() => setDlg('return')}><Undo2 /> {t('return')}</Button>}
              {canCancel && can('orders:cancel') && <Button variant="outline" onClick={() => setDlg('cancel')}><XCircle className="text-destructive" /> {t('cancelOrder')}</Button>}
            </>} />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusTone(view.status)}>{t(`status.${view.status}`)}</Badge><Badge variant={payTone(view.paymentStatus)}>{t(`payStatus.${view.paymentStatus}`)}</Badge>
            {view.customer && <Link href={`/customers/${view.customer.id}` as '/'} className="text-sm underline">{view.customer.firstName} {view.customer.lastName}</Link>}
            {view.cancelReason && <span className="text-sm text-muted-foreground">— {view.cancelReason}</span>}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2"><CardHeader><CardTitle>{t('items')}</CardTitle></CardHeader><CardContent>
              <Table><THead><TR><TH>{c('name')}</TH><TH className="text-end">{c('quantity')}</TH><TH className="text-end">{c('total')}</TH></TR></THead>
                <TBody>{view.lines.map((l: any) => (
                  <TR key={l.id}><TD><div className="font-medium">{l.description.split(' + ')[0]}</div><div className="font-mono text-xs text-muted-foreground">{l.sku}</div>
                    {l.lensConfig && (
                      <div className="mt-1.5 space-y-0.5 rounded-md bg-muted p-2 text-xs">
                        {/* the description already reads "<lens> (<treatments>)": show it once */}
                        <div className="font-medium">{l.description.includes(' + ') ? l.description.split(' + ')[1] : l.lensConfig.lensType?.name}</div>
                        {l.lensConfig.prescriptionSnapshot && (() => { const s = l.lensConfig.prescriptionSnapshot; return <div dir="ltr" className="text-start font-mono">{r('od')}: {dioptre(s.odSph)} {dioptre(s.odCyl)} ×{s.odAxis ?? '—'}° · {r('os')}: {dioptre(s.osSph)} {dioptre(s.osCyl)} ×{s.osAxis ?? '—'}°{s.pdTotal ? ` · PD ${s.pdTotal}` : ''}</div>; })()}
                      </div>
                    )}
                    {l.returnedQty > 0 && <Badge variant="secondary" className="mt-1">{t('returned', { count: l.returnedQty })}</Badge>}
                  </TD><TD className="text-end">{l.quantity}</TD><TD className="text-end">{f.money(l.lineTotal)}{l.discount > 0 && <div className="text-xs text-muted-foreground">−{f.money(l.discount)}</div>}</TD></TR>
                ))}</TBody></Table>
            </CardContent></Card>
            <Card><CardHeader><CardTitle>{c('total')}</CardTitle></CardHeader><CardContent><dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">{p('subtotal')}</dt><dd>{f.money(view.subtotal)}</dd></div>
              {view.discountTotal > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{p('discounts')}</dt><dd>−{f.money(view.discountTotal)}</dd></div>}
              <div className="flex justify-between text-xs text-muted-foreground"><dt>{p('includingTax')}</dt><dd>{f.money(view.taxTotal)}</dd></div>
              <div className="flex justify-between border-t pt-1.5 text-lg font-bold"><dt>{c('total')}</dt><dd>{f.money(view.total)}</dd></div>
              <div className="flex justify-between"><dt>{p('sale.paid')}</dt><dd>{f.money(view.paidTotal)}</dd></div>
              {view.balanceDue > 0 && <div className="flex justify-between font-semibold text-amber-600"><dt>{p('sale.balanceDue')}</dt><dd>{f.money(view.balanceDue)}</dd></div>}
            </dl></CardContent></Card>
          </div>

          <Card><CardHeader><CardTitle>{t('payments')}</CardTitle></CardHeader><CardContent>
            <Table><THead><TR><TH>{c('date')}</TH><TH>{p('method')}</TH><TH>{c('type')}</TH><TH>{p('reference')}</TH><TH className="text-end">{c('price')}</TH></TR></THead>
              <TBody>{view.payments.map((x: any) => (
                <TR key={x.id}><TD>{f.dateTime(x.paidAt)}</TD><TD>{x.method.name}</TD><TD><Badge variant={x.kind === 'REFUND' ? 'danger' : 'secondary'}>{t(`kind.${x.kind}`)}</Badge></TD><TD className="text-muted-foreground">{x.reference ?? ''}</TD>
                  <TD className={`text-end font-medium ${x.kind === 'REFUND' ? 'text-destructive' : ''}`}>{x.kind === 'REFUND' ? '−' : ''}{f.money(x.amount)}</TD></TR>
              ))}
                {view.payments.length === 0 && <TR><TD colSpan={5} className="py-6 text-center text-muted-foreground">{c('empty')}</TD></TR>}</TBody></Table>
            {view.returns.length > 0 && <p className="mt-3 text-sm text-muted-foreground">{t('returnsList')}: {view.returns.map((x: any) => `${x.number} (${f.money(x.refundTotal)})`).join(' · ')}</p>}
          </CardContent></Card>

          <PaymentDialog order={view} open={dlg === 'pay'} onClose={() => setDlg(null)} />
          <ReturnDialog order={view} open={dlg === 'return'} onClose={() => setDlg(null)} />
          <CancelDialog order={view} open={dlg === 'cancel'} onClose={() => setDlg(null)} />
        </>)}
      </div>
    </RequirePermission>
  );
}
