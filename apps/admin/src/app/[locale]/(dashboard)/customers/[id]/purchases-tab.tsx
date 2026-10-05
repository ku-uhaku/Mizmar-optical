'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useFormat } from '@/lib/format';
import { DataTable, type Column } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { payTone, statusTone } from '../../orders/page';

interface Row { id: string; number: string; placedAt: string | null; status: string; paymentStatus: string; total: number; balanceDue: number }

/** Purchase history: every order this customer has placed (links through to the order). */
export function PurchasesTab({ customerId }: { customerId: string }) {
  const t = useTranslations('orders');
  const c = useTranslations('common');
  const f = useFormat();
  const columns: Column<Row>[] = [
    { header: t('number'), cell: (o) => <Link href={`/orders/${o.id}` as '/'} className="font-mono text-xs underline">{o.number}</Link> },
    { header: c('date'), cell: (o) => f.dateTime(o.placedAt) },
    { header: c('total'), cell: (o) => <span className="font-medium">{f.money(o.total)}</span> },
    { header: t('balance'), cell: (o) => (o.balanceDue > 0 ? <Badge>{f.money(o.balanceDue)}</Badge> : '—') },
    { header: c('status'), cell: (o) => <div className="flex flex-wrap gap-1"><Badge variant={statusTone(o.status)}>{t(`status.${o.status}`)}</Badge><Badge variant={payTone(o.paymentStatus)}>{t(`payStatus.${o.paymentStatus}`)}</Badge></div> },
  ];
  return <DataTable<Row> queryKey="customer-orders" endpoint={`/customers/${customerId}/orders`} columns={columns} searchable={false} />;
}
