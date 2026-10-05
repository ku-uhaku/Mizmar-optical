'use client';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft, PackageCheck, Printer, Send, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { workError } from '@/lib/work-errors';
import { useFormat } from '@/lib/format';
import { invalidateInventory } from '@/lib/query';
import { printHtml } from '@/lib/print';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { poTone } from '../page';

interface PoLine { id: string; description: string; qtyOrdered: number; qtyReceived: number; unitCost: number; lineTotal: number; variant: { sku: string } }
interface Po { id: string; number: string; status: string; subtotal: number; taxTotal: number; total: number; expectedAt: string | null; notes: string | null; supplier: { name: string }; warehouse: { name: string }; lines: PoLine[]; receipts: { id: string; number: string; status: string; receivedAt: string; deliveryNoteRef: string | null }[] }

function ReceiveDialog({ po, open, onClose }: { po: Po; open: boolean; onClose: () => void }) {
  const t = useTranslations('work');
  const c = useTranslations('common');
  const qc = useQueryClient();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [ref, setRef] = useState('');
  const outstanding = (l: PoLine) => l.qtyOrdered - l.qtyReceived;
  const value = (l: PoLine) => qty[l.id] ?? outstanding(l);
  const lines = po.lines.filter((l) => value(l) > 0).map((l) => ({ purchaseOrderLineId: l.id, quantity: value(l) }));
  const save = useMutation({
    mutationFn: () => api(`/purchase-orders/${po.id}/receipts`, { method: 'POST', body: { deliveryNoteRef: ref || undefined, lines } }),
    onSuccess: () => { toast.success(t('purchasing.received')); qc.invalidateQueries({ queryKey: ['po', po.id] }); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); qc.invalidateQueries({ queryKey: ['purchasing-summary'] }); invalidateInventory(qc); setQty({}); onClose(); },
    onError: (e) => toast.error(workError(e, t)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>{t('purchasing.receive')}</DialogTitle>
        <DialogDescription>{t('purchasing.receiveHint')}</DialogDescription>
        <Input aria-label={t('purchasing.deliveryNote')} placeholder={t('purchasing.deliveryNote')} value={ref} onChange={(e) => setRef(e.target.value)} />
        <ul className="divide-y rounded-md border">
          {po.lines.filter((l) => outstanding(l) > 0).map((l) => (
            <li key={l.id} className="flex items-center gap-3 p-2 text-sm">
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{l.description}</div><div className="text-xs text-muted-foreground">{t('purchasing.outstanding')}: {outstanding(l)}</div></div>
              <Input type="number" min={0} max={outstanding(l)} className="w-24" aria-label={`${c('quantity')} ${l.description}`} value={value(l)} onChange={(e) => setQty({ ...qty, [l.id]: Number(e.target.value) })} />
            </li>
          ))}
        </ul>
        <Button onClick={() => save.mutate()} disabled={lines.length === 0 || save.isPending}><PackageCheck /> {t('purchasing.confirmReceive')}</Button>
      </DialogContent>
    </Dialog>
  );
}

export default function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('work');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [receiving, setReceiving] = useState(false);
  const { data: po, error } = useQuery({ queryKey: ['po', id], queryFn: () => api<Po>(`/purchase-orders/${id}`) });
  const act = useMutation({
    mutationFn: (a: 'send' | 'cancel') => api(`/purchase-orders/${id}/${a}`, { method: 'POST' }),
    onSuccess: () => { toast.success(c('saved')); qc.invalidateQueries({ queryKey: ['po', id] }); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); qc.invalidateQueries({ queryKey: ['purchasing-summary'] }); },
    onError: (e) => toast.error(workError(e, t)),
  });
  const print = async () => { try { printHtml((await api<{ html: string }>(`/purchase-orders/${id}/document`)).html); } catch (e) { toast.error((e as Error).message); } };
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!po) return <p className="text-muted-foreground">{c('loading')}</p>;
  const canReceive = ['SENT', 'PARTIALLY_RECEIVED'].includes(po.status) && can('purchasing:receive');

  return (
    <RequirePermission permission="purchasing:read">
      <div className="space-y-4">
        <Link href="/purchasing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="size-4 rtl:rotate-180" /> {t('purchasing.title')}</Link>
        <PageHeader title={po.number} subtitle={`${po.supplier.name} · ${po.warehouse.name}`} actions={<>
          <Badge variant={poTone(po.status)} className="self-center">{t(`purchasing.status.${po.status}`)}</Badge>
          <Button variant="outline" onClick={print}><Printer /> {c('print')}</Button>
          {po.status === 'DRAFT' && can('purchasing:approve') && <Button onClick={() => act.mutate('send')} disabled={act.isPending}><Send /> {t('purchasing.send')}</Button>}
          {canReceive && <Button onClick={() => setReceiving(true)}><PackageCheck /> {t('purchasing.receive')}</Button>}
          {['DRAFT', 'SENT'].includes(po.status) && can('purchasing:approve') && <Button variant="outline" onClick={() => confirm(t('purchasing.confirmCancel')) && act.mutate('cancel')}><XCircle /> {c('cancel')}</Button>}
        </>} />
        <Card>
          <CardContent className="pt-6">
            <Table>
              <THead><TR><TH>{c('description')}</TH><TH>{t('purchasing.ordered')}</TH><TH>{t('purchasing.receivedQty')}</TH><TH>{t('purchasing.unitCost')}</TH><TH className="text-end">{c('total')}</TH></TR></THead>
              <TBody>{po.lines.map((l) => <TR key={l.id}><TD><div className="font-medium">{l.description}</div><div className="font-mono text-xs text-muted-foreground">{l.variant.sku}</div></TD><TD>{l.qtyOrdered}</TD><TD>{l.qtyReceived}</TD><TD>{f.money(l.unitCost)}</TD><TD className="text-end">{f.money(l.lineTotal)}</TD></TR>)}</TBody>
            </Table>
            <dl className="ms-auto mt-4 w-64 space-y-1 text-sm">
              <div className="flex justify-between"><dt>{t('purchasing.subtotalExcl')}</dt><dd>{f.money(po.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>{t('purchasing.tax')}</dt><dd>{f.money(po.taxTotal)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>{t('purchasing.totalIncl')}</dt><dd>{f.money(po.total)}</dd></div>
            </dl>
          </CardContent>
        </Card>
        {po.receipts.length > 0 && (
          <Card><CardHeader><CardTitle>{t('purchasing.receipts')}</CardTitle></CardHeader><CardContent>
            <ul className="divide-y text-sm">{po.receipts.map((r) => <li key={r.id} className="flex items-center justify-between py-2"><span className="font-mono text-xs">{r.number}</span><span>{f.date(r.receivedAt)}{r.deliveryNoteRef && ` · ${r.deliveryNoteRef}`}</span><Badge variant={r.status === 'POSTED' ? 'success' : 'danger'}>{t(`purchasing.receiptStatus.${r.status}`)}</Badge></li>)}</ul>
          </CardContent></Card>
        )}
        {po.notes && <p className="text-sm text-muted-foreground">{po.notes}</p>}
        <ReceiveDialog po={po} open={receiving} onClose={() => setReceiving(false)} />
      </div>
    </RequirePermission>
  );
}
