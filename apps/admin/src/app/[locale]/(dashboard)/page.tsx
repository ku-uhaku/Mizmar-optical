'use client';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { StatCard } from '@/components/form-field';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const i = useTranslations('inventory');
  const { user, can } = useAuth();
  const f = useFormat();
  const stock = useQuery({ queryKey: ['inv-summary'], queryFn: () => api<{ units: number; value: number; lowStock: number; outOfStock: number }>('/inventory/summary'), enabled: can('inventory:read') });
  if (!user) return null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('welcome', { name: user.firstName })}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardDescription>{t('roles')}</CardDescription><CardTitle className="flex flex-wrap gap-1.5">{user.roles.map((r) => <Badge key={r}>{r}</Badge>)}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>{t('stores')}</CardDescription><CardTitle className="flex flex-wrap gap-1.5">{user.stores.map((s) => <Badge key={s.id} variant="secondary">{s.name}</Badge>)}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>{t('permissions')}</CardDescription><CardTitle className="text-3xl">{user.isSuperAdmin ? '∞' : user.permissions.length}</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground">{user.isSuperAdmin ? t('superAdmin') : ''}</CardContent></Card>
      </div>
      {can('inventory:read') && stock.data && (
        <div className="space-y-2">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{i('title')}</h2><Link href={'/inventory' as '/'} className="text-sm text-primary hover:underline">{i('tabs.stock')} →</Link></div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={i('units')} value={f.int(stock.data.units)} />
            <StatCard label={i('stockValue')} value={f.money(stock.data.value)} hint={i('atCost')} />
            <StatCard label={i('lowStock')} value={f.int(stock.data.lowStock)} tone={stock.data.lowStock ? 'warn' : undefined} />
            <StatCard label={i('outOfStock')} value={f.int(stock.data.outOfStock)} tone={stock.data.outOfStock ? 'danger' : undefined} />
          </div>
        </div>
      )}
    </div>
  );
}
