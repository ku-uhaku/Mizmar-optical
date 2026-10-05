'use client';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { user } = useAuth();
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
    </div>
  );
}
