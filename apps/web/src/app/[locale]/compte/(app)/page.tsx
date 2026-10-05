'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { useFormat } from '@/lib/format';

interface Row { id: string; number: string; status: string; paymentStatus: string; total: number; placedAt: string; channel: string }

export default function OrdersPage() {
  const t = useTranslations('account');
  const o = useTranslations('tracking');
  const f = useFormat();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { let alive = true; api<Row[]>('/account/orders').then((r) => alive && setRows(r)).catch(() => alive && setRows([])); return () => { alive = false; }; }, []);
  return (
    <section aria-labelledby="h">
      <h1 id="h" className="mb-4 text-2xl font-bold">{t('nav.orders')}</h1>
      {rows === null ? <p className="text-muted-foreground">…</p> : rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-8 text-center text-muted-foreground">{t('noOrders')} <Link href={'/catalogue' as '/'} className="underline">{t('startShopping')}</Link></p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((r) => (
            <li key={r.id}><Link href={`/compte/commandes/${r.number}` as '/'} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/50">
              <span><span className="font-mono text-sm font-medium">{r.number}</span><span className="block text-xs text-muted-foreground">{f.date(r.placedAt)} · {r.channel === 'POS' ? t('inStore') : t('online')}</span></span>
              <span className="flex items-center gap-3"><span className="rounded-full bg-muted px-2.5 py-0.5 text-xs">{o(`orderStatus.${r.status}`)}</span><span className="font-semibold">{f.money(r.total)}</span></span>
            </Link></li>
          ))}
        </ul>
      )}
    </section>
  );
}
