'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { BellRing, HandCoins, PackageCheck, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { workError } from '@/lib/work-errors';
import { Field } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';

interface Online { id: string; channel: string; fulfillment: string; status: string; balanceDue: number; shippingAddress: { recipient?: string; phone?: string; line1?: string; line2?: string; city?: string } | null; customerNote?: string | null }

/** Staff handling of an online order: confirm a transfer, ship with a tracking number, mark delivered (and cash collected), call for pickup. */
export function OnlineActions({ order }: { order: Online }) {
  const t = useTranslations('shopAdmin');
  const c = useTranslations('common');
  const w = useTranslations('work');
  const { can } = useAuth();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<'pay' | 'ship' | null>(null);
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const { data: methods } = useQuery({ queryKey: ['payment-methods'], enabled: can('finance:read'), queryFn: () => api<{ id: string; name: string; code: string }[]>('/payment-methods') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['order', order.id] }); qc.invalidateQueries({ queryKey: ['orders'] }); };
  const call = useMutation({
    mutationFn: (a: { path: string; body?: unknown }) => api(`/orders/${order.id}/${a.path}`, { method: 'POST', body: a.body ?? {} }),
    onSuccess: () => { toast.success(c('saved')); setDlg(null); refresh(); }, onError: (e) => toast.error(workError(e, w)),
  });
  if (order.channel !== 'ONLINE' || !can('orders:update')) return null;
  const live = ['PENDING', 'CONFIRMED', 'PROCESSING'].includes(order.status);
  const a = order.shippingAddress;

  return (
    <Card>
      <CardHeader><CardTitle>{t('onlineOrder.title')} <Badge variant="secondary">{t(`onlineOrder.fulfillment.${order.fulfillment}`)}</Badge></CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {a && <p>{a.recipient}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}<br /><bdi>{a.phone}</bdi></p>}
        {order.customerNote && <p className="rounded-md bg-muted p-2">{order.customerNote}</p>}
        <div className="flex flex-wrap gap-2">
          {live && order.balanceDue > 0 && can('finance:read') && <Button variant="outline" onClick={() => setDlg('pay')}><HandCoins /> {t('onlineOrder.confirmPayment')}</Button>}
          {order.fulfillment === 'DELIVERY' && ['CONFIRMED', 'PROCESSING'].includes(order.status) && <Button onClick={() => setDlg('ship')}><Truck /> {t('onlineOrder.ship')}</Button>}
          {order.fulfillment === 'DELIVERY' && order.status === 'SHIPPED' && <>
            <Button onClick={() => call.mutate({ path: 'shipment-delivered', body: { collected: order.balanceDue > 0 } })}><PackageCheck /> {order.balanceDue > 0 ? t('onlineOrder.deliveredCollected') : t('onlineOrder.delivered')}</Button>
            {order.balanceDue > 0 && <Button variant="outline" onClick={() => call.mutate({ path: 'shipment-delivered', body: { collected: false } })}>{t('onlineOrder.deliveredNoCash')}</Button>}
          </>}
          {order.fulfillment === 'PICKUP' && ['CONFIRMED', 'PROCESSING'].includes(order.status) && <Button onClick={() => call.mutate({ path: 'ready-for-pickup' })}><BellRing /> {t('onlineOrder.readyForPickup')}</Button>}
        </div>
      </CardContent>

      <Dialog open={dlg === 'pay'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent><DialogTitle>{t('onlineOrder.confirmPayment')}</DialogTitle><DialogDescription>{t('onlineOrder.confirmPaymentHint')}</DialogDescription>
          <Field id="op-method" label={t('onlineOrder.method')}><NativeSelect id="op-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}><option value="">—</option>{methods?.filter((m) => m.code !== 'cash').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</NativeSelect></Field>
          <Field id="op-ref" label={t('onlineOrder.reference')}><Input id="op-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          <Button disabled={!methodId || call.isPending} onClick={() => call.mutate({ path: 'confirm-payment', body: { methodId, reference: reference || undefined } })}>{c('save')}</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={dlg === 'ship'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent><DialogTitle>{t('onlineOrder.ship')}</DialogTitle><DialogDescription>{t('onlineOrder.shipHint')}</DialogDescription>
          <Field id="os-carrier" label={t('onlineOrder.carrier')}><Input id="os-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} /></Field>
          <Field id="os-track" label={t('onlineOrder.tracking')}><Input id="os-track" value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
          <Button disabled={call.isPending} onClick={() => call.mutate({ path: 'ship', body: { carrier: carrier || undefined, trackingNumber: tracking || undefined } })}>{t('onlineOrder.ship')}</Button>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
