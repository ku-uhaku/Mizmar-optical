'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from "@/lib/api";
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { workError } from '@/lib/work-errors';
import { BarChart } from '@/components/bar-chart';
import { DataTable, type Column } from '@/components/data-table';
import { Field, StatCard } from '@/components/form-field';
import { ResourcePage, type FieldDef } from '@/components/resource-page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };
const todayStr = () => new Date().toISOString().slice(0, 10);

function RangePicker({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const t = useTranslations('finance');
  return <div className="flex flex-wrap items-end gap-3"><Field id="r-from" label={t('from')}><Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field id="r-to" label={t('to')}><Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>;
}

export function OverviewTab() {
  const t = useTranslations('finance');
  const f = useFormat();
  const { storeId } = useAuth();
  const { data: s } = useQuery({ queryKey: ['fin-summary', storeId], queryFn: () => api<{ cash: { in: number; out: number; net: number }; receivables: { amount: number; orders: number }; payables: { amount: number; overdue: number; invoices: number }; expenses: number; vatDue: number }>('/finance/summary', { query: { storeId } }) });
  const { data: flow } = useQuery({ queryKey: ['fin-flow-mtd', storeId], queryFn: () => api<{ series: { key: string; in: number; out: number }[] }>('/finance/cash-flow', { query: { from: monthStart(), to: todayStr(), storeId, groupBy: 'day' } }) });
  const { data: bal } = useQuery({ queryKey: ['fin-balances'], queryFn: () => api<{ id: string; name: string; isCashAccount: boolean; balance: number }[]>('/finance/balances') });
  return (
    <div className="space-y-4">
      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t('ov.cashIn')} value={f.money(s.cash.in)} hint={t('ov.thisMonth')} /><StatCard label={t('ov.cashOut')} value={f.money(s.cash.out)} hint={t('ov.thisMonth')} />
          <StatCard label={t('ov.net')} value={f.money(s.cash.net)} tone={s.cash.net < 0 ? 'danger' : undefined} hint={t('ov.thisMonth')} /><StatCard label={t('ov.vatDue')} value={f.money(s.vatDue)} hint={t('ov.thisMonth')} />
          <StatCard label={t('ov.receivables')} value={f.money(s.receivables.amount)} hint={t('ov.orders', { n: s.receivables.orders })} /><StatCard label={t('ov.payables')} value={f.money(s.payables.amount)} hint={t('ov.invoices', { n: s.payables.invoices })} />
          <StatCard label={t('ov.overdue')} value={f.money(s.payables.overdue)} tone={s.payables.overdue ? 'danger' : undefined} /><StatCard label={t('ov.expenses')} value={f.money(s.expenses)} hint={t('ov.thisMonth')} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader><CardTitle>{t('ov.inVsOut')}</CardTitle></CardHeader><CardContent>{flow && <BarChart label={t('ov.inVsOut')} data={flow.series.map((x) => ({ label: x.key, value: x.in - x.out }))} format={f.money} />}</CardContent></Card>
        <Card><CardHeader><CardTitle>{t('ov.accounts')}</CardTitle></CardHeader><CardContent><ul className="divide-y text-sm">{(bal ?? []).map((a) => <li key={a.id} className="flex justify-between py-2"><span>{a.name}</span><b className={a.balance < 0 ? 'text-destructive' : ''}>{f.money(a.balance)}</b></li>)}</ul></CardContent></Card>
      </div>
    </div>
  );
}

export function CashFlowTab() {
  const t = useTranslations('finance');
  const w = useTranslations('work');
  const c = useTranslations('common');
  const f = useFormat();
  const { can, storeId } = useAuth();
  const qc = useQueryClient();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());
  const [entry, setEntry] = useState({ direction: 'IN', amount: '', description: '' });
  const { data } = useQuery({ queryKey: ['fin-flow', from, to, storeId], queryFn: () => api<{ totals: { in: number; out: number; net: number }; series: { key: string; in: number; out: number; net: number }[]; bySource: { source: string; direction: string; amount: number }[] }>('/finance/cash-flow', { query: { from, to, storeId, groupBy: 'day' } }) });
  const add = useMutation({ mutationFn: () => api('/finance/cash-entries', { method: 'POST', body: { direction: entry.direction, amount: Number(entry.amount), description: entry.description } }), onSuccess: () => { toast.success(c('saved')); setEntry({ ...entry, amount: '', description: '' }); qc.invalidateQueries({ queryKey: ['fin-flow'] }); qc.invalidateQueries({ queryKey: ['fin-summary'] }); }, onError: (e) => toast.error(workError(e, w)) });
  return (
    <div className="space-y-4">
      <RangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {data && (
        <>
          <div className="grid grid-cols-3 gap-3"><StatCard label={t('ov.cashIn')} value={f.money(data.totals.in)} /><StatCard label={t('ov.cashOut')} value={f.money(data.totals.out)} /><StatCard label={t('ov.net')} value={f.money(data.totals.net)} tone={data.totals.net < 0 ? 'danger' : undefined} /></div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle>{t('cf.byDay')}</CardTitle></CardHeader><CardContent><BarChart label={t('cf.byDay')} data={data.series.map((x) => ({ label: x.key, value: x.net }))} format={f.money} />
              <div className="mt-3 max-h-60 overflow-auto rounded-md border"><Table><THead><TR><TH>{c('date')}</TH><TH className="text-end">{t('cf.in')}</TH><TH className="text-end">{t('cf.out')}</TH><TH className="text-end">{t('ov.net')}</TH></TR></THead><TBody>{data.series.map((x) => <TR key={x.key}><TD>{x.key}</TD><TD className="text-end">{f.money(x.in)}</TD><TD className="text-end">{f.money(x.out)}</TD><TD className="text-end">{f.money(x.net)}</TD></TR>)}</TBody></Table></div></CardContent></Card>
            <Card><CardHeader><CardTitle>{t('cf.bySource')}</CardTitle></CardHeader><CardContent><ul className="divide-y text-sm">{data.bySource.map((s) => <li key={`${s.source}${s.direction}`} className="flex justify-between py-2"><span>{t(`cf.sources.${s.source}`)} <span className="text-xs text-muted-foreground">{s.direction === 'IN' ? '↓' : '↑'}</span></span><b className={s.direction === 'OUT' ? 'text-destructive' : ''}>{s.direction === 'OUT' ? '−' : ''}{f.money(s.amount)}</b></li>)}</ul></CardContent></Card>
          </div>
        </>
      )}
      {can('finance:create') && (
        <div className="grid items-end gap-3 rounded-lg border bg-card p-4 sm:grid-cols-4">
          <Field id="ce-dir" label={c('type')}><NativeSelect id="ce-dir" value={entry.direction} onChange={(e) => setEntry({ ...entry, direction: e.target.value })}><option value="IN">{t('cf.in')}</option><option value="OUT">{t('cf.out')}</option></NativeSelect></Field>
          <Field id="ce-amount" label={c('price')}><Input id="ce-amount" type="number" min={0} step="0.01" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} /></Field>
          <Field id="ce-desc" label={c('description')}><Input id="ce-desc" value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} /></Field>
          <Button disabled={!(Number(entry.amount) > 0) || !entry.description.trim() || add.isPending} onClick={() => add.mutate()}>{t('cf.addEntry')}</Button>
        </div>
      )}
    </div>
  );
}

export function VatTab() {
  const t = useTranslations('finance');
  const f = useFormat();
  const { storeId } = useAuth();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());
  const { data } = useQuery({ queryKey: ['fin-vat', from, to, storeId], queryFn: () => api<{ byRate: { ratePct: number; taxableBase: number; vat: number }[]; collectedBeforeCredits: number; creditNotes: number; collected: number; deductible: { supplierInvoices: number; expenses: number; total: number }; due: number; note: string }>('/finance/vat', { query: { from, to, storeId } }) });
  return (
    <div className="space-y-4">
      <RangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {data && (
        <>
          <div className="grid grid-cols-3 gap-3"><StatCard label={t('vat.collected')} value={f.money(data.collected)} /><StatCard label={t('vat.deductible')} value={f.money(data.deductible.total)} /><StatCard label={t('vat.due')} value={f.money(data.due)} tone={data.due > 0 ? 'warn' : undefined} /></div>
          <Card><CardHeader><CardTitle>{t('vat.byRate')}</CardTitle></CardHeader><CardContent><Table><THead><TR><TH>{t('vat.rate')}</TH><TH className="text-end">{t('vat.base')}</TH><TH className="text-end">{t('vat.title')}</TH></TR></THead><TBody>
            {data.byRate.map((r) => <TR key={r.ratePct}><TD>{r.ratePct} %</TD><TD className="text-end">{f.money(r.taxableBase)}</TD><TD className="text-end">{f.money(r.vat)}</TD></TR>)}
            <TR><TD colSpan={2}>{t('vat.creditNotes')}</TD><TD className="text-end">− {f.money(data.creditNotes)}</TD></TR>
            <TR><TD colSpan={2}>{t('vat.supplierInvoices')}</TD><TD className="text-end">− {f.money(data.deductible.supplierInvoices)}</TD></TR>
            <TR><TD colSpan={2}>{t('vat.expenses')}</TD><TD className="text-end">− {f.money(data.deductible.expenses)}</TD></TR>
          </TBody></Table></CardContent></Card>
          <p className="text-xs text-muted-foreground">{t('vat.note')}</p>
        </>
      )}
    </div>
  );
}

interface Pay { id: string; kind: string; amount: number; paidAt: string; method: { name: string }; order: { number: string } | null; customer: { firstName: string; lastName: string } | null }

export function PaymentsTab() {
  const t = useTranslations('finance');
  const f = useFormat();
  const { storeId } = useAuth();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());
  const { data: byMethod } = useQuery({ queryKey: ['fin-bymethod', from, to, storeId], queryFn: () => api<{ methodId: string; name: string; count: number; amount: number }[]>('/finance/payments/by-method', { query: { from, to, storeId } }) });
  const cols: Column<Pay>[] = [
    { header: t('pay.date'), cell: (p) => f.dateTime(p.paidAt) }, { header: t('pay.method'), cell: (p) => p.method.name }, { header: t('pay.order'), cell: (p) => p.order?.number ?? '—', className: 'hidden md:table-cell' },
    { header: t('pay.customer'), cell: (p) => (p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : '—'), className: 'hidden lg:table-cell' }, { header: t('pay.kind'), cell: (p) => t(`pay.kinds.${p.kind}`) }, { header: t('pay.amount'), cell: (p) => <b>{f.money(Number(p.amount))}</b> },
  ];
  return (
    <div className="space-y-4">
      <RangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{(byMethod ?? []).map((m) => <StatCard key={m.methodId} label={m.name} value={f.money(m.amount)} hint={t('pay.count', { n: m.count })} />)}</div>
      <DataTable<Pay> queryKey="fin-payments" endpoint="/finance/payments" columns={cols} searchable={false} extraQuery={{ from, to, storeId: storeId ?? undefined }} />
    </div>
  );
}

type Row = { id: string; [k: string]: any };

export function SetupTab() {
  const t = useTranslations('finance');
  const c = useTranslations('common');
  const f = useFormat();
  const [tab, setTab] = useState<'categories' | 'accounts'>('categories');
  const ok = (v: unknown) => (v ? <Check className="size-4 text-emerald-600" aria-label={c('active')} /> : <X className="size-4 text-muted-foreground" aria-label={c('inactive')} />);
  const catCols: Column<Row>[] = [{ header: c('code'), cell: (r) => <span className="font-mono text-xs">{r.code}</span> }, { header: c('name'), cell: (r) => <b>{r.name}</b> }, { header: c('status'), cell: (r) => ok(r.isActive) }];
  const catFields: FieldDef[] = [{ name: 'code', label: c('code'), required: true, createOnly: true }, { name: 'name', label: c('name'), required: true }, { name: 'isActive', label: c('status'), type: 'checkbox', hint: c('active') }];
  const accCols: Column<Row>[] = [{ header: c('name'), cell: (r) => <b>{r.name}</b> }, { header: t('setup.bank'), cell: (r) => r.bankName ?? '—' }, { header: t('setup.opening'), cell: (r) => f.money(Number(r.openingBalance)) }, { header: c('status'), cell: (r) => ok(r.isActive) }];
  const accFields: FieldDef[] = [{ name: 'name', label: c('name'), required: true }, { name: 'bankName', label: t('setup.bank') }, { name: 'iban', label: 'IBAN' }, { name: 'openingBalance', label: t('setup.opening'), type: 'number', step: '0.01' }, { name: 'isCashAccount', label: t('setup.cashAccount'), type: 'checkbox', hint: t('setup.cashAccountHint') }, { name: 'isActive', label: c('status'), type: 'checkbox', hint: c('active') }];
  return (
    <div className="space-y-4">
      <Tabs value={tab} onChange={setTab} items={[{ value: 'categories', label: t('setup.categories') }, { value: 'accounts', label: t('setup.accounts') }]} />
      {tab === 'categories' ? <ResourcePage key="c" queryKey="expense-categories" endpoint="/expense-categories" module="finance" title={t('setup.categories')} columns={catCols} fields={catFields} defaults={{ isActive: true }} />
        : <ResourcePage key="a" queryKey="bank-accounts" endpoint="/bank-accounts" module="finance" title={t('setup.accounts')} columns={accCols} fields={accFields} defaults={{ isActive: true, openingBalance: 0 }} />}
    </div>
  );
}
