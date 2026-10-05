'use client';
import { use, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { errorText } from '@/lib/errors';
import { useFormat } from '@/lib/format';
import { notify } from '@/components/toaster';
import { Button } from '@/components/ui/button';

interface Order { number: string; status: string; paymentStatus: string; fulfillment: string; placedAt: string; total: number; paidTotal: number; balanceDue: number; shippingTotal: number; discountTotal: number; lines: { description: string; quantity: number; lineTotal: number }[]; shipments: { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null }[]; workshop: { number: string; status: string; promisedAt: string | null }[] }

export default function OrderDetail({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  const t = useTranslations('account');
  const o = useTranslations('tracking');
  const c = useTranslations('common');
  const f = useFormat();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { let alive = true; api<Order>(`/account/orders/${encodeURIComponent(number)}`).then((r) => alive && setOrder(r)).catch(() => alive && setMissing(true)); return () => { alive = false; }; }, [number]);
  const cancel = async () => {
    if (!confirm(t('confirmCancel'))) return;
    try { setOrder(await api<Order>(`/account/orders/${encodeURIComponent(number)}/cancel`, { method: 'POST', body: {} })); notify(t('cancelled')); }
    catch (e) { notify(errorText(e, (k, x) => c(k, x as never)), 'error'); }
  };
  if (missing) return <p>{t('notFound')}</p>;
  if (!order) return <p className="text-muted-foreground">…</p>;
  const cancellable = ['PENDING', 'CONFIRMED'].includes(order.status) && order.paidTotal === 0;
  return (
    <section className="space-y-4">
      <Link href={'/compte' as '/'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="size-4 rtl:rotate-180" />{t('nav.orders')}</Link>
      <header className="flex flex-wrap items-baseline justify-between gap-2"><h1 className="font-mono text-2xl font-bold">{order.number}</h1><span className="rounded-full bg-muted px-3 py-1 text-sm">{o(`orderStatus.${order.status}`)}</span></header>
      <p className="text-sm text-muted-foreground">{f.date(order.placedAt)}</p>
      <ul className="divide-y rounded-lg border bg-card text-sm">{order.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 p-3"><span>{l.quantity} × {l.description}</span><span>{f.money(l.lineTotal)}</span></li>)}</ul>
      <dl className="ms-auto w-64 space-y-1 text-sm">
        {order.discountTotal > 0 && <div className="flex justify-between"><dt>{o('discount')}</dt><dd>− {f.money(order.discountTotal)}</dd></div>}
        {order.shippingTotal > 0 && <div className="flex justify-between"><dt>{o('shipping')}</dt><dd>{f.money(order.shippingTotal)}</dd></div>}
        <div className="flex justify-between text-base font-semibold"><dt>{o('total')}</dt><dd>{f.money(order.total)}</dd></div>
        {order.balanceDue > 0 && <div className="flex justify-between text-muted-foreground"><dt>{t('balanceDue')}</dt><dd>{f.money(order.balanceDue)}</dd></div>}
      </dl>
      {order.shipments.filter((s) => s.trackingNumber).map((s, i) => <p key={i} className="text-sm">{o('shipment')}: <b>{s.carrier}</b> <bdi className="font-mono">{s.trackingNumber}</bdi>{s.trackingUrl && <> — <a className="underline" href={s.trackingUrl} target="_blank" rel="noreferrer noopener">{o('follow')}</a></>}</p>)}
      {order.workshop.map((j) => <p key={j.number} className="text-sm text-muted-foreground">{o('workshop')} <span className="font-mono">{j.number}</span>: <b className="text-foreground">{o(`job.${j.status}`)}</b></p>)}
      {cancellable && <Button variant="outline" onClick={cancel}>{t('cancelOrder')}</Button>}
    </section>
  );
}
