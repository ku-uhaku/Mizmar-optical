'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader, StatCard } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SessionReportView, type SessionReport } from '../session-report';

interface Row { id: string; status: string; openedAt: string; closedAt: string | null; openingFloat: number; expectedCash: number | null; countedCash: number | null; variance: number | null; register: { name: string } }
interface Daily {
  date: string; storeName: string; netCollected: number; unclosedSessions: number;
  sales: { orders: number; gross: number; discounts: number; tax: number; total: number }; returns: { count: number; refunded: number };
  payments: { methodId: string; name: string; received: number; refunded: number; net: number }[];
}

function ReportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('pos');
  const { data } = useQuery({ queryKey: ['pos-session-report', id], queryFn: () => api<SessionReport>(`/pos/sessions/${id}/report`) });
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"><DialogTitle>{t('report.title')}</DialogTitle><DialogDescription className="sr-only">{t('report.title')}</DialogDescription>{data && <SessionReportView report={data} />}</DialogContent></Dialog>;
}

export default function SessionsPage() {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const f = useFormat();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [view, setView] = useState<string | null>(null);
  const daily = useQuery({ queryKey: ['pos-daily', date], queryFn: () => api<Daily>('/pos/reports/daily', { query: { date } }), enabled: /^\d{4}-\d{2}-\d{2}$/.test(date) });
  const d = daily.data;

  const columns: Column<Row>[] = [
    { header: t('session.register'), cell: (s) => <button className="font-medium underline" onClick={() => setView(s.id)}>{s.register.name}</button> },
    { header: t('session.openedAt'), cell: (s) => f.dateTime(s.openedAt) },
    { header: t('session.closedAt'), cell: (s) => f.dateTime(s.closedAt), className: 'hidden md:table-cell' },
    { header: t('report.expected'), cell: (s) => f.money(s.expectedCash), className: 'hidden sm:table-cell' },
    { header: t('report.counted'), cell: (s) => f.money(s.countedCash), className: 'hidden sm:table-cell' },
    { header: t('report.variance'), cell: (s) => (s.variance == null ? '—' : <span className={s.variance === 0 ? 'text-emerald-600' : s.variance < 0 ? 'font-medium text-destructive' : 'font-medium text-amber-600'}>{s.variance > 0 ? '+' : ''}{f.money(s.variance)}</span>) },
    { header: c('status'), cell: (s) => <Badge variant={s.status === 'OPEN' ? 'success' : 'secondary'}>{s.status === 'OPEN' ? t('report.open') : t('report.closed')}</Badge> },
  ];
  return (
    <RequirePermission permission="pos:manage_register">
      <div className="space-y-5">
        <PageHeader title={t('sessions.title')} subtitle={t('sessions.subtitle')} />
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2"><CardTitle>{t('daily.title')}{d ? ` — ${d.storeName}` : ''}</CardTitle><Input type="date" className="w-44" aria-label={t('daily.date')} value={date} onChange={(e) => setDate(e.target.value)} /></CardHeader>
          <CardContent className="space-y-4">
            {d && (<>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <StatCard label={t('report.orders')} value={f.int(d.sales.orders)} />
                <StatCard label={t('report.total')} value={f.money(d.sales.total)} />
                <StatCard label={t('report.discounts')} value={f.money(d.sales.discounts)} />
                <StatCard label={t('daily.refunded')} value={f.money(d.returns.refunded)} hint={t('daily.returns', { count: d.returns.count })} />
                <StatCard label={t('daily.collected')} value={f.money(d.netCollected)} hint={t('daily.netOfRefunds')} />
              </div>
              {d.unclosedSessions > 0 && <p role="alert" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">{t('daily.unclosed', { count: d.unclosedSessions })}</p>}
              <table className="w-full text-sm"><thead><tr className="text-xs text-muted-foreground"><th className="text-start">{t('method')}</th><th className="text-end">{t('report.received')}</th><th className="text-end">{t('report.refunded')}</th><th className="text-end">{t('report.net')}</th></tr></thead>
                <tbody>{d.payments.map((p) => <tr key={p.methodId} className="border-t"><td className="py-1.5">{p.name}</td><td className="text-end">{f.money(p.received)}</td><td className="text-end">{p.refunded ? f.money(p.refunded) : '—'}</td><td className="text-end font-medium">{f.money(p.net)}</td></tr>)}
                  {d.payments.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">{c('empty')}</td></tr>}</tbody></table>
            </>)}
          </CardContent>
        </Card>
        <DataTable<Row> queryKey="pos-sessions" endpoint="/pos/sessions" columns={columns} searchable={false} />
        {view && <ReportDialog id={view} onClose={() => setView(null)} />}
      </div>
    </RequirePermission>
  );
}
