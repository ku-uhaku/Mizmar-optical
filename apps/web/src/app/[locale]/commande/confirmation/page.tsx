'use client';
import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useFormat } from '@/lib/format';
import { Button } from '@/components/ui/button';

interface Placed { number: string; status: string; paymentStatus: string; fulfillment: string; total: number; paymentInstructions: string | null; contact: string; lines: { description: string; quantity: number; lineTotal: number }[]; store: { name: string; address: string | null; city: string | null } | null; workshop: { number: string }[] }

let cached: { raw: string | null; value: Placed | null } = { raw: null, value: null };
function read(): Placed | null {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem('mizmar.shop.lastOrder'); } catch { /* private mode */ }
  if (raw !== cached.raw) { let value: Placed | null = null; try { value = raw ? JSON.parse(raw) : null; } catch { /* corrupt */ } cached = { raw, value }; }
  return cached.value;
}

export default function ConfirmationPage() {
  const t = useTranslations('checkout');
  const f = useFormat();
  const order = useSyncExternalStore(() => () => undefined, read, () => null);
  if (!order) return <div className="mx-auto max-w-xl px-4 py-20 text-center"><p className="text-muted-foreground">{t('noRecentOrder')}</p><Button asChild className="mt-6"><Link href={'/suivi' as '/'}>{t('trackOrder')}</Link></Button></div>;
  const paid = order.paymentStatus === 'PAID';
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-12">
      <div className="text-center"><CheckCircle2 className="mx-auto size-14 text-emerald-500" aria-hidden /><h1 className="mt-3 text-3xl font-bold">{t('thanks')}</h1><p className="mt-1 text-muted-foreground">{t('orderNumber')} <b data-testid="order-number" className="font-mono text-foreground">{order.number}</b></p></div>
      <div className="space-y-3 rounded-lg border bg-card p-5 text-sm">
        <p>{paid ? t('statusPaid') : order.status === 'PENDING' ? t('statusAwaitingPayment') : t('statusConfirmed')}</p>
        {order.paymentInstructions && <p className="rounded-md bg-muted p-3">{order.paymentInstructions}</p>}
        {order.fulfillment === 'PICKUP' && order.store && <p>{t('pickupAt', { store: order.store.name })}{order.store.address ? ` — ${order.store.address}${order.store.city ? `, ${order.store.city}` : ''}` : ''}</p>}
        {order.fulfillment === 'DELIVERY' && <p>{t('deliveryTo')}</p>}
        {order.workshop.length > 0 && <p>{t('workshopNote')}</p>}
        <p>{t('confirmationSent', { email: order.contact })}</p>
        <ul className="divide-y border-y">{order.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 py-2"><span>{l.quantity} × {l.description}</span><span>{f.money(l.lineTotal)}</span></li>)}</ul>
        <p className="flex justify-between text-lg font-semibold"><span>{t('total')}</span><span>{f.money(order.total)}</span></p>
      </div>
      <div className="flex flex-wrap justify-center gap-3"><Button asChild><Link href={`/suivi?number=${order.number}` as '/'}>{t('trackOrder')}</Link></Button><Button asChild variant="outline"><Link href={'/catalogue' as '/'}>{t('continueShopping')}</Link></Button></div>
    </div>
  );
}
