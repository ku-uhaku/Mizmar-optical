'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useFormat } from '@/lib/format';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/input';

export const ORDER_STATUSES = ['DRAFT', 'PENDING', 'CONFIRMED', 'PROCESSING', 'READY', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED'];
export const PAY_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];
export const statusTone = (s: string) => (s === 'COMPLETED' || s === 'DELIVERED' ? 'success' : s === 'CANCELLED' ? 'danger' : 'default') as 'success' | 'danger' | 'default';
export const payTone = (s: string) => (s === 'PAID' ? 'success' : s === 'UNPAID' || s === 'REFUNDED' ? 'danger' : 'secondary') as 'success' | 'danger' | 'secondary';

interface Row { id: string; number: string; placedAt: string | null; status: string; paymentStatus: string; total: number; paidTotal: number; balanceDue: number; customer: { firstName: string; lastName: string } | null; _count: { lines: number } }

export default function OrdersPage() {
  const t = useTranslations('orders');
  const c = useTranslations('common');
  const f = useFormat();
  const [status, setStatus] = useState('');
  const [pay, setPay] = useState('');
  const [owing, setOwing] = useState(false);
  const columns: Column<Row>[] = [
    { header: t('number'), cell: (o) => <Link href={`/orders/${o.id}` as '/'} className="font-mono text-xs underline">{o.number}</Link> },
    { header: c('date'), cell: (o) => f.dateTime(o.placedAt), className: 'hidden md:table-cell' },
    { header: t('customer'), cell: (o) => (o.customer ? `${o.customer.firstName} ${o.customer.lastName}` : t('walkIn')) },
    { header: c('total'), cell: (o) => <span className="font-medium">{f.money(o.total)}</span> },
    { header: t('balance'), cell: (o) => (o.balanceDue > 0 ? <Badge>{f.money(o.balanceDue)}</Badge> : '—'), className: 'hidden sm:table-cell' },
    { header: c('status'), cell: (o) => <div className="flex flex-wrap gap-1"><Badge variant={statusTone(o.status)}>{t(`status.${o.status}`)}</Badge><Badge variant={payTone(o.paymentStatus)}>{t(`payStatus.${o.paymentStatus}`)}</Badge></div> },
  ];
  return (
    <RequirePermission permission="orders:read">
      <div className="space-y-4">
        <PageHeader title={t('title')} />
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect className="w-48" aria-label={c('status')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{c('status')}: {c('all')}</option>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</NativeSelect>
          <NativeSelect className="w-52" aria-label={t('payment')} value={pay} onChange={(e) => setPay(e.target.value)}><option value="">{t('payment')}: {c('all')}</option>{PAY_STATUSES.map((s) => <option key={s} value={s}>{t(`payStatus.${s}`)}</option>)}</NativeSelect>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={owing} onChange={(e) => setOwing(e.target.checked)} /> {t('withBalance')}</label>
        </div>
        <DataTable<Row> queryKey="orders" endpoint="/orders" columns={columns} extraQuery={{ status: status || undefined, paymentStatus: pay || undefined, hasBalance: owing ? 'true' : undefined }} />
      </div>
    </RequirePermission>
  );
}
