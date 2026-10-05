'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check, Printer, Send, ShoppingCart, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { salesError } from '@/lib/errors';
import { useFormat } from '@/lib/format';
import { printHtml } from '@/lib/print';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';

const STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'];
const tone = (s: string) => (s === 'ACCEPTED' || s === 'CONVERTED' ? 'success' : s === 'REJECTED' || s === 'EXPIRED' ? 'danger' : 'secondary') as 'success' | 'danger' | 'secondary';
interface Row { id: string; number: string; status: string; total: number; validUntil: string | null; createdAt: string; customer: { id: string; firstName: string; lastName: string } | null; convertedOrderId: string | null; _count: { lines: number } }

export default function QuotesPage() {
  const t = useTranslations('quotes');
  const p = useTranslations('pos');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'send' | 'accept' | 'reject' | 'delete' }) => (action === 'delete' ? api(`/quotes/${id}`, { method: 'DELETE' }) : api(`/quotes/${id}/${action}`, { method: 'POST' })),
    onSuccess: () => { toast.success(c('saved')); qc.invalidateQueries({ queryKey: ['quotes'] }); }, onError: (e) => toast.error(salesError(e, p)),
  });
  const print = async (id: string) => { try { printHtml((await api<{ html: string }>(`/quotes/${id}/document`)).html); } catch (e) { toast.error((e as Error).message); } };

  const columns: Column<Row>[] = [
    { header: t('number'), cell: (q) => <span className="font-mono text-xs">{q.number}</span> },
    { header: t('customer'), cell: (q) => (q.customer ? `${q.customer.firstName} ${q.customer.lastName}` : '—') },
    { header: c('date'), cell: (q) => f.date(q.createdAt), className: 'hidden md:table-cell' },
    { header: t('validUntil'), cell: (q) => f.date(q.validUntil), className: 'hidden md:table-cell' },
    { header: c('total'), cell: (q) => <span className="font-medium">{f.money(q.total)}</span> },
    { header: c('status'), cell: (q) => <Badge variant={tone(q.status)}>{t(`status.${q.status}`)}</Badge> },
    { header: '', className: 'text-end', cell: (q) => (
      <div className="flex flex-wrap justify-end gap-1">
        <Button variant="ghost" size="icon" aria-label={c('print')} onClick={() => print(q.id)}><Printer /></Button>
        {q.status === 'DRAFT' && can('quotes:update') && <Button variant="outline" size="sm" onClick={() => act.mutate({ id: q.id, action: 'send' })}><Send /> {t('send')}</Button>}
        {['DRAFT', 'SENT'].includes(q.status) && can('quotes:update') && (<>
          <Button variant="outline" size="sm" onClick={() => act.mutate({ id: q.id, action: 'accept' })}><Check /> {t('accept')}</Button>
          <Button variant="ghost" size="icon" aria-label={t('reject')} onClick={() => act.mutate({ id: q.id, action: 'reject' })}><X /></Button>
        </>)}
        {['DRAFT', 'SENT', 'ACCEPTED'].includes(q.status) && can('pos:access') && <Button size="sm" asChild><Link href={`/pos?quote=${q.id}` as '/'}><ShoppingCart /> {t('sell')}</Link></Button>}
        {q.convertedOrderId && <Button size="sm" variant="outline" asChild><Link href={`/orders/${q.convertedOrderId}` as '/'}>{t('viewOrder')}</Link></Button>}
        {q.status === 'DRAFT' && can('quotes:delete') && <Button variant="ghost" size="icon" aria-label={c('delete')} onClick={() => confirm(c('confirmDelete')) && act.mutate({ id: q.id, action: 'delete' })}><Trash2 className="text-destructive" /></Button>}
      </div>
    ) },
  ];
  return (
    <RequirePermission permission="quotes:read">
      <div className="space-y-4">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <NativeSelect className="w-48" aria-label={c('status')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{c('status')}: {c('all')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</NativeSelect>
        <DataTable<Row> queryKey="quotes" endpoint="/quotes" columns={columns} extraQuery={{ status: status || undefined }} />
      </div>
    </RequirePermission>
  );
}
