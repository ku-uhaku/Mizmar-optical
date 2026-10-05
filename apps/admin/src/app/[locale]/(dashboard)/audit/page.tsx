'use client';
import { useLocale, useTranslations } from 'next-intl';
import { DataTable, type Column } from '@/components/data-table';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';

interface AuditRow { id: string; entity: string; entityId: string | null; action: string; actorId: string | null; ip: string | null; createdAt: string }

export default function AuditPage() {
  const t = useTranslations('audit');
  const locale = useLocale();
  const columns: Column<AuditRow>[] = [
    { header: t('when'), cell: (a) => new Date(a.createdAt).toLocaleString(locale) },
    { header: t('action'), cell: (a) => <Badge variant={a.action === 'DELETE' ? 'danger' : 'default'}>{a.action}</Badge> },
    { header: t('entity'), cell: (a) => <span dir="ltr" className="font-mono text-xs">{a.entity}{a.entityId ? `/${a.entityId.slice(0, 8)}` : ''}</span> },
    { header: t('ip'), cell: (a) => <span dir="ltr">{a.ip ?? '—'}</span>, className: 'hidden md:table-cell' },
  ];
  return <RequirePermission permission="audit:read"><div className="space-y-4"><h1 className="text-2xl font-semibold">{t('title')}</h1><DataTable<AuditRow> queryKey="audit" endpoint="/audit-logs" columns={columns} /></div></RequirePermission>;
}
