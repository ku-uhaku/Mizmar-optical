'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { printHtml } from '@/lib/print';
import { Field, PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

interface Table_ { title: string; columns: { key: string; label: string; type: 'text' | 'money' | 'number' | 'percent' }[]; rows: Record<string, string | number | null>[]; totals?: Record<string, string | number | null> }
const REPORTS = ['sales', 'best-sellers', 'stock-value', 'profit', 'top-customers'] as const;
const GROUPS = ['day', 'week', 'month', 'store', 'employee', 'category', 'brand', 'product', 'type', 'channel'];
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };

export default function ReportsPage() {
  const t = useTranslations('reports');
  const locale = useLocale();
  const f = useFormat();
  const { can, storeId } = useAuth();
  const [name, setName] = useState<(typeof REPORTS)[number]>('sales');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [groupBy, setGroupBy] = useState('day');
  const [allStores, setAllStores] = useState(false);
  const store = allStores ? undefined : (storeId ?? undefined);
  const query = name === 'stock-value' ? { storeId: store, locale } : { from, to, storeId: store, locale, ...(name === 'sales' ? { groupBy } : {}), ...(name === 'best-sellers' ? { by: 'revenue', limit: 20 } : {}) };
  const { data, isLoading, error } = useQuery({ queryKey: ['report', name, query], queryFn: () => api<Table_>(`/reports/${name}`, { query: query as Record<string, string | number | undefined> }) });
  const qs = (extra: Record<string, string>) => `?${new URLSearchParams(Object.entries({ ...query, ...extra }).filter((e): e is [string, string] => e[1] !== undefined).map(([k, v]) => [k, String(v)]))}`;
  const download = async (format: 'xlsx' | 'csv') => { try { await apiDownload(`/reports/export/${name}${qs({ format })}`, `${name}_${from}_${to}.${format}`); } catch (e) { toast.error((e as Error).message); } };
  const print = async () => { try { printHtml((await api<{ html: string }>(`/reports/export/${name}${qs({ format: 'html' })}`)).html); } catch (e) { toast.error((e as Error).message); } };
  const cell = (c: Table_['columns'][number], v: string | number | null | undefined) => (v == null || v === '' ? '' : typeof v !== 'number' ? v : c.type === 'money' ? f.money(v) : c.type === 'percent' ? `${v.toFixed(1)} %` : f.int(v));
  return (
    <RequirePermission permission="reports:read">
      <div className="space-y-4">
        <PageHeader title={t('title')} actions={can('reports:export') ? <>
          <Button variant="outline" onClick={() => download('xlsx')}><FileSpreadsheet /> Excel</Button>
          <Button variant="outline" onClick={() => download('csv')}><FileText /> CSV</Button>
          <Button variant="outline" onClick={print}><Printer /> {t('pdf')}</Button></> : undefined} />
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
          <Field id="rp-name" label={t('report')}><NativeSelect id="rp-name" value={name} onChange={(e) => setName(e.target.value as typeof name)}>{REPORTS.map((r) => <option key={r} value={r}>{t(`names.${r}`)}</option>)}</NativeSelect></Field>
          {name !== 'stock-value' && <><Field id="rp-from" label={t('from')}><Input id="rp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field id="rp-to" label={t('to')}><Input id="rp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}
          {name === 'sales' && <Field id="rp-group" label={t('groupBy')}><NativeSelect id="rp-group" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>{GROUPS.map((g) => <option key={g} value={g}>{t(`groups.${g}`)}</option>)}</NativeSelect></Field>}
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={allStores} onChange={(e) => setAllStores(e.target.checked)} />{t('allStores')}</label>
        </div>
        {isLoading && <p className="text-muted-foreground">…</p>}
        {!!error && <p role="alert" className="text-destructive">{(error as Error).message}</p>}
        {data && (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <THead><TR>{data.columns.map((c) => <TH key={c.key} className={c.type === 'text' ? '' : 'text-end'}>{c.label}</TH>)}</TR></THead>
              <TBody>
                {data.rows.length === 0 && <TR><TD colSpan={data.columns.length} className="py-8 text-center text-muted-foreground">{t('empty')}</TD></TR>}
                {data.rows.map((r, i) => <TR key={i}>{data.columns.map((c) => <TD key={c.key} className={c.type === 'text' ? '' : 'text-end tabular-nums'}>{cell(c, r[c.key])}</TD>)}</TR>)}
                {data.totals && <TR className="font-semibold">{data.columns.map((c, i) => <TD key={c.key} className={c.type === 'text' ? '' : 'text-end tabular-nums'}>{i === 0 && data.totals![c.key] == null ? t('total') : cell(c, data.totals![c.key])}</TD>)}</TR>}
              </TBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t('note')}</p>
      </div>
    </RequirePermission>
  );
}
