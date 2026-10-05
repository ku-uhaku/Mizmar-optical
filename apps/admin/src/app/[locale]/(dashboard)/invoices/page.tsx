'use client';
import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { printHtml } from '@/lib/print';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Row { id: string; number: string; status: string; issuedAt: string | null; total: number; paidTotal: number; customer: { firstName: string; lastName: string } | null; order: { id: string; number: string } | null }
const tone = (s: string) => (s === 'PAID' ? 'success' : s === 'VOID' ? 'danger' : 'secondary') as 'success' | 'danger' | 'secondary';

export default function InvoicesPage() {
  const t = useTranslations('invoices');
  const c = useTranslations('common');
  const f = useFormat();
  const print = async (id: string) => { try { printHtml((await api<{ html: string }>(`/invoices/${id}/document`)).html); } catch (e) { toast.error((e as Error).message); } };
  const columns: Column<Row>[] = [
    { header: t('number'), cell: (i) => <span className="font-mono text-xs">{i.number}</span> },
    { header: c('date'), cell: (i) => f.date(i.issuedAt), className: 'hidden md:table-cell' },
    { header: t('customer'), cell: (i) => (i.customer ? `${i.customer.firstName} ${i.customer.lastName}` : '—') },
    { header: t('order'), cell: (i) => (i.order ? <Link href={`/orders/${i.order.id}` as '/'} className="font-mono text-xs underline">{i.order.number}</Link> : '—'), className: 'hidden lg:table-cell' },
    { header: c('total'), cell: (i) => <span className="font-medium">{f.money(i.total)}</span> },
    { header: t('paid'), cell: (i) => f.money(i.paidTotal), className: 'hidden sm:table-cell' },
    { header: c('status'), cell: (i) => <Badge variant={tone(i.status)}>{t(`status.${i.status}`)}</Badge> },
    { header: '', className: 'w-12', cell: (i) => <Button variant="ghost" size="icon" aria-label={c('print')} onClick={() => print(i.id)}><Printer /></Button> },
  ];
  return (
    <RequirePermission permission="invoices:read">
      <div className="space-y-4"><PageHeader title={t('title')} /><DataTable<Row> queryKey="invoices" endpoint="/invoices" columns={columns} /></div>
    </RequirePermission>
  );
}
