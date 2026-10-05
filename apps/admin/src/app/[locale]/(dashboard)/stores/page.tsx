'use client';
import { useTranslations } from 'next-intl';
import { DataTable, type Column } from '@/components/data-table';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';

interface StoreRow { id: string; code: string; name: string; city: string | null; phone: string | null; isActive: boolean }

export default function StoresPage() {
  const t = useTranslations('stores');
  const c = useTranslations('common');
  const columns: Column<StoreRow>[] = [
    { header: t('code'), cell: (s) => <span className="font-mono text-xs">{s.code}</span> },
    { header: t('name'), cell: (s) => <span className="font-medium">{s.name}</span> },
    { header: t('city'), cell: (s) => s.city ?? '—', className: 'hidden sm:table-cell' },
    { header: t('phone'), cell: (s) => s.phone ?? '—', className: 'hidden md:table-cell' },
    { header: c('status'), cell: (s) => <Badge variant={s.isActive ? 'success' : 'danger'}>{s.isActive ? c('active') : c('inactive')}</Badge> },
  ];
  return <RequirePermission permission="stores:read"><div className="space-y-4"><h1 className="text-2xl font-semibold">{t('title')}</h1><DataTable<StoreRow> queryKey="stores" endpoint="/stores" columns={columns} /></div></RequirePermission>;
}
