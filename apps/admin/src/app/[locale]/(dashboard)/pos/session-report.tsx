'use client';
import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import { useFormat } from '@/lib/format';
import { printHtml } from '@/lib/print';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface SessionReport {
  session: { id: string; status: string; register: { name: string }; openedAt: string; closedAt: string | null; openedBy: string | null; closedBy: string | null; notes: string | null };
  sales: { orders: number; gross: number; discounts: number; tax: number; total: number };
  payments: { methodId: string; name: string; type: string; received: number; refunded: number; net: number }[];
  cash: { openingFloat: number; sales: number; refunds: number; cashIn: number; cashOut: number; expected: number; counted: number | null; variance: number | null };
  movements: { type: string; amount: number; reason: string | null; at: string }[];
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** X report (open) / Z report (closed): what was sold, how it was paid, and whether the drawer reconciles. */
export function SessionReportView({ report, showPrint = true }: { report: SessionReport; showPrint?: boolean }) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const f = useFormat();
  const closed = report.session.status === 'CLOSED';
  const v = report.cash.variance;

  const print = () => {
    const rows = (xs: string[][]) => xs.map((r) => `<tr>${r.map((x, i) => `<td${i ? ' style="text-align:end"' : ''}>${esc(x)}</td>`).join('')}</tr>`).join('');
    printHtml(`<!doctype html><meta charset="utf-8"><title>${esc(t('report.title'))}</title><style>body{font-family:system-ui,sans-serif;font-size:13px;padding:12px;max-width:420px}h1{font-size:16px;margin:0 0 4px}table{width:100%;border-collapse:collapse}td{padding:3px 0;border-bottom:1px dotted #bbb}h2{font-size:13px;margin:12px 0 4px}</style>
      <h1>${esc(t(closed ? 'report.z' : 'report.x'))} — ${esc(report.session.register.name)}</h1>
      <div>${esc(f.dateTime(report.session.openedAt))}${report.session.closedAt ? ' → ' + esc(f.dateTime(report.session.closedAt)) : ''}<br>${esc(report.session.openedBy)}</div>
      <h2>${esc(t('report.sales'))}</h2><table>${rows([[t('report.orders'), String(report.sales.orders)], [t('report.gross'), f.money(report.sales.gross)], [t('report.discounts'), f.money(report.sales.discounts)], [t('report.tax'), f.money(report.sales.tax)], [t('report.total'), f.money(report.sales.total)]])}</table>
      <h2>${esc(t('report.payments'))}</h2><table>${rows(report.payments.map((p) => [p.name, f.money(p.net)]))}</table>
      <h2>${esc(t('report.cash'))}</h2><table>${rows([[t('report.float'), f.money(report.cash.openingFloat)], [t('report.cashSales'), f.money(report.cash.sales)], [t('report.cashRefunds'), f.money(report.cash.refunds)], [t('report.cashIn'), f.money(report.cash.cashIn)], [t('report.cashOut'), f.money(report.cash.cashOut)], [t('report.expected'), f.money(report.cash.expected)], ...(report.cash.counted != null ? [[t('report.counted'), f.money(report.cash.counted)], [t('report.variance'), f.money(report.cash.variance)]] : [])])}</table>`);
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={closed ? 'secondary' : 'success'}>{closed ? t('report.closed') : t('report.open')}</Badge>
        <span className="font-medium">{report.session.register.name}</span>
        <span className="text-muted-foreground">{f.dateTime(report.session.openedAt)}{report.session.closedAt ? ` → ${f.dateTime(report.session.closedAt)}` : ''} · {report.session.openedBy}</span>
        {showPrint && <Button variant="outline" size="sm" className="ms-auto" onClick={print}><Printer /> {c('print')}</Button>}
      </div>
      <section aria-label={t('report.sales')} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {([['orders', String(report.sales.orders)], ['gross', f.money(report.sales.gross)], ['discounts', f.money(report.sales.discounts)], ['tax', f.money(report.sales.tax)], ['total', f.money(report.sales.total)]] as const).map(([k, val]) => (
          <div key={k} className="rounded-md border p-2.5"><div className="text-xs text-muted-foreground">{t(`report.${k}`)}</div><div className="font-semibold">{val}</div></div>
        ))}
      </section>
      <section>
        <h3 className="mb-1 font-medium">{t('report.payments')}</h3>
        <table className="w-full"><thead><tr className="text-xs text-muted-foreground"><th className="text-start">{c('name')}</th><th className="text-end">{t('report.received')}</th><th className="text-end">{t('report.refunded')}</th><th className="text-end">{t('report.net')}</th></tr></thead>
          <tbody>{report.payments.map((p) => <tr key={p.methodId} className="border-t"><td className="py-1.5">{p.name}</td><td className="text-end">{f.money(p.received)}</td><td className="text-end">{p.refunded ? f.money(p.refunded) : '—'}</td><td className="text-end font-medium">{f.money(p.net)}</td></tr>)}
            {report.payments.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-muted-foreground">{c('empty')}</td></tr>}</tbody></table>
      </section>
      <section>
        <h3 className="mb-1 font-medium">{t('report.cash')}</h3>
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-md border p-3">
          <dt>{t('report.float')}</dt><dd className="text-end">{f.money(report.cash.openingFloat)}</dd>
          <dt>{t('report.cashSales')}</dt><dd className="text-end">{f.money(report.cash.sales)}</dd>
          <dt>{t('report.cashRefunds')}</dt><dd className="text-end">{f.money(report.cash.refunds)}</dd>
          <dt>{t('report.cashIn')}</dt><dd className="text-end">{f.money(report.cash.cashIn)}</dd>
          <dt>{t('report.cashOut')}</dt><dd className="text-end">{f.money(report.cash.cashOut)}</dd>
          <dt className="border-t pt-1 font-semibold">{t('report.expected')}</dt><dd className="border-t pt-1 text-end font-semibold">{f.money(report.cash.expected)}</dd>
          {report.cash.counted != null && (<>
            <dt>{t('report.counted')}</dt><dd className="text-end">{f.money(report.cash.counted)}</dd>
            <dt className="font-semibold">{t('report.variance')}</dt><dd className={`text-end font-semibold ${v ? (v < 0 ? 'text-destructive' : 'text-amber-600') : 'text-emerald-600'}`}>{v && v > 0 ? '+' : ''}{f.money(v)}</dd>
          </>)}
        </dl>
      </section>
      {report.movements.length > 0 && (
        <section><h3 className="mb-1 font-medium">{t('report.movements')}</h3>
          <ul className="divide-y rounded-md border">{report.movements.map((m, i) => <li key={i} className="flex justify-between gap-3 px-3 py-1.5"><span>{m.reason} <span className="text-xs text-muted-foreground">{f.dateTime(m.at)}</span></span><span className={m.amount < 0 ? 'text-destructive' : 'text-emerald-600'}>{m.amount > 0 ? '+' : ''}{f.money(m.amount)}</span></li>)}</ul></section>
      )}
    </div>
  );
}
