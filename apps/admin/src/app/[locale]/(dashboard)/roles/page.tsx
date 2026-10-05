'use client';
import { useTranslations } from 'next-intl';
import { DataTable, type Column } from '@/components/data-table';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';

interface RoleRow { id: string; code: string; name: string; description: string | null; isSystem: boolean; permissionKeys: string[]; _count: { users: number } }

export default function RolesPage() {
  const t = useTranslations('roles');
  const columns: Column<RoleRow>[] = [
    { header: t('name'), cell: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.description}</div></div> },
    { header: t('type'), cell: (r) => <Badge variant={r.isSystem ? 'secondary' : 'default'}>{r.isSystem ? t('system') : t('custom')}</Badge> },
    { header: t('permissions'), cell: (r) => r.permissionKeys.length },
    { header: t('users'), cell: (r) => r._count.users },
  ];
  return <RequirePermission permission="roles:read"><div className="space-y-4"><h1 className="text-2xl font-semibold">{t('title')}</h1><DataTable<RoleRow> queryKey="roles" endpoint="/roles" columns={columns} /></div></RequirePermission>;
}
