'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Clock, LogIn, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { BarChart } from '@/components/bar-chart';
import { StatCard } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Dash {
  sales: { today: number; week: number; month: number; ordersToday: number; ordersMonth: number; averageBasket: number };
  series: { date: string; revenue: number }[]; topProducts: { name: string; units: number; revenue: number }[];
  alerts: { lowStock: number; openJobs: number; lateJobs: number; appointmentsToday: number; unpaidSupplierInvoices: number; newCustomersMonth: number; onlineToProcess: number; pendingLeave: number };
}

/** Clock-in/out for staff whose login is linked to an employee record (hidden otherwise). */
function ClockCard() {
  const t = useTranslations('dashboard');
  const f = useFormat();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['hr-today'], retry: false, queryFn: () => api<{ employee: { firstName: string }; record: { checkIn: string | null; checkOut: string | null; status: string } | null }>('/hr/me/today') });
  const clock = useMutation({
    mutationFn: (a: 'in' | 'out') => api(`/hr/clock/${a}`, { method: 'POST', body: {} }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr-today'] }); toast.success(t('clocked')); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  });
  if (!data) return null;
  const r = data.record;
  return (
    <Card><CardHeader><CardDescription className="flex items-center gap-1"><Clock className="size-4" />{t('attendance')}</CardDescription>
      <CardTitle className="text-base font-medium">{r?.checkIn ? `${t('in')} ${f.dateTime(r.checkIn).split(' ').pop()}${r.checkOut ? ` · ${t('out')} ${f.dateTime(r.checkOut).split(' ').pop()}` : ''}` : t('notClockedIn')}</CardTitle></CardHeader>
      <CardContent className="flex gap-2">
        <Button size="sm" disabled={!!r?.checkIn || clock.isPending} onClick={() => clock.mutate('in')}><LogIn /> {t('clockIn')}</Button>
        <Button size="sm" variant="outline" disabled={!r?.checkIn || !!r?.checkOut || clock.isPending} onClick={() => clock.mutate('out')}><LogOut /> {t('clockOut')}</Button>
      </CardContent></Card>
  );
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const f = useFormat();
  const { user, can, storeId } = useAuth();
  const dash = useQuery({ queryKey: ['dashboard', storeId], enabled: can('reports:read'), queryFn: () => api<Dash>('/reports/dashboard', { query: { storeId } }) });
  if (!user) return null;
  const d = dash.data;
  const link = (href: string, label: string, n: number, tone?: 'warn' | 'danger') => <Link key={label} href={href as '/'} className="block"><StatCard label={label} value={f.int(n)} tone={n > 0 ? tone : undefined} /></Link>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">{t('welcome', { name: user.firstName })}</h1><p className="text-muted-foreground">{t('subtitle')}</p></div>
        <ClockCard />
      </div>
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('salesToday')} value={f.money(d.sales.today)} hint={t('orders', { n: d.sales.ordersToday })} />
            <StatCard label={t('salesWeek')} value={f.money(d.sales.week)} />
            <StatCard label={t('salesMonth')} value={f.money(d.sales.month)} hint={t('orders', { n: d.sales.ordersMonth })} />
            <StatCard label={t('basket')} value={f.money(d.sales.averageBasket)} hint={t('thisMonth')} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2"><CardHeader><CardTitle>{t('last30')}</CardTitle></CardHeader><CardContent><BarChart label={t('last30')} data={d.series.map((s) => ({ label: f.date(s.date), value: s.revenue }))} format={f.money} /></CardContent></Card>
            <Card><CardHeader><CardTitle>{t('topProducts')}</CardTitle><CardDescription>{t('thisMonth')}</CardDescription></CardHeader><CardContent>
              {d.topProducts.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : <ol className="space-y-2 text-sm">{d.topProducts.map((p, i) => <li key={i} className="flex justify-between gap-2"><span className="min-w-0 truncate">{i + 1}. {p.name}</span><span className="shrink-0 font-medium">{f.money(p.revenue)}</span></li>)}</ol>}
            </CardContent></Card>
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">{t('attention')}</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {can('inventory:read') && link('/inventory', t('lowStock'), d.alerts.lowStock, 'warn')}
              {can('workshop:read') && link('/workshop', t('lateJobs'), d.alerts.lateJobs, 'danger')}
              {can('workshop:read') && link('/workshop', t('openJobs'), d.alerts.openJobs)}
              {can('appointments:read') && link('/appointments', t('appointmentsToday'), d.alerts.appointmentsToday)}
              {can('orders:read') && link('/orders', t('onlineToProcess'), d.alerts.onlineToProcess, 'warn')}
              {can('finance:read') && link('/payables', t('unpaidSupplierInvoices'), d.alerts.unpaidSupplierInvoices, 'warn')}
              {can('hr:read') && link('/hr', t('pendingLeave'), d.alerts.pendingLeave, 'warn')}
              {can('customers:read') && link('/customers', t('newCustomers'), d.alerts.newCustomersMonth)}
            </div>
          </div>
        </>
      )}
      {!can('reports:read') && <p className="text-sm text-muted-foreground">{t('noReports')}</p>}
    </div>
  );
}
