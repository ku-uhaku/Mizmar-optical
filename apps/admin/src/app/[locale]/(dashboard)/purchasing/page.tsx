'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { workError } from '@/lib/work-errors';
import { useFormat } from '@/lib/format';
import { invalidateInventory } from '@/lib/query';
import { useWarehouses } from '@/lib/warehouses';
import { DataTable, type Column } from '@/components/data-table';
import { Field, PageHeader, StatCard } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { LinesEditor, type CostLine } from './lines-editor';

interface Po { id: string; number: string; status: string; total: number; expectedAt: string | null; supplier: { name: string }; warehouse: { name: string }; createdAt: string; _count: { lines: number } }
interface Receipt { id: string; number: string; status: string; receivedAt: string; deliveryNoteRef: string | null; supplier: { name: string }; purchaseOrder: { id: string; number: string } | null }
export const poTone = (s: string) => (s === 'RECEIVED' ? 'success' : s === 'CANCELLED' ? 'danger' : s === 'DRAFT' ? 'outline' : 'secondary') as 'success' | 'danger' | 'outline' | 'secondary';

interface Supplier { id: string; name: string; isActive: boolean }
function useSuppliers() { return useQuery({ queryKey: ['options', 'suppliers-active'], queryFn: () => api<Paginated<Supplier>>('/suppliers', { query: { limit: 100, isActive: 'true' } }), staleTime: 30_000 }); }

/** One dialog for both flows: a purchase order (draft) or a direct receipt (stock arrives immediately). */
function OrderDialog({ mode, onClose }: { mode: 'po' | 'direct' | null; onClose: () => void }) {
  const t = useTranslations('work');
  const c = useTranslations('common');
  const qc = useQueryClient();
  const { data: suppliers } = useSuppliers();
  const { data: warehouses } = useWarehouses();
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<CostLine[]>([]);
  const wh = warehouseId || warehouses?.[0]?.id || '';
  const subtotal = lines.reduce((n, l) => n + l.qty * l.cost, 0);
  const f = useFormat();

  const save = useMutation({
    mutationFn: () => {
      const body = { supplierId, warehouseId: wh, lines: lines.map((l) => (mode === 'po' ? { variantId: l.id, quantity: l.qty, unitCost: l.cost } : { variantId: l.id, quantity: l.qty, unitCost: l.cost })), ...(mode === 'po' ? { expectedAt: expectedAt || undefined, notes: note || undefined } : { note: note || undefined }) };
      return api<{ id: string }>(mode === 'po' ? '/purchase-orders' : '/goods-receipts', { method: 'POST', body });
    },
    onSuccess: () => { toast.success(c('saved')); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); qc.invalidateQueries({ queryKey: ['goods-receipts'] }); qc.invalidateQueries({ queryKey: ['purchasing-summary'] }); invalidateInventory(qc); setLines([]); setNote(''); onClose(); },
    onError: (e) => toast.error(workError(e, t)),
  });
  const invalid = !supplierId || !wh || lines.length === 0 || lines.some((l) => l.qty < 1 || l.cost < 0);

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>{mode === 'po' ? t('purchasing.newOrder') : t('purchasing.directReceipt')}</DialogTitle>
        <DialogDescription>{mode === 'po' ? t('purchasing.newOrderHint') : t('purchasing.directHint')}</DialogDescription>
        <div className="grid grid-cols-2 gap-3">
          <Field id="po-supplier" label={t('purchasing.supplier')} required>
            <NativeSelect id="po-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">—</option>{suppliers?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
          </Field>
          <Field id="po-wh" label={t('purchasing.warehouse')} required>
            <NativeSelect id="po-wh" value={wh} onChange={(e) => setWarehouseId(e.target.value)}>{warehouses?.map((w) => <option key={w.id} value={w.id}>{w.store.name} — {w.name}</option>)}</NativeSelect>
          </Field>
          {mode === 'po' && <Field id="po-exp" label={t('purchasing.expectedAt')}><Input id="po-exp" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></Field>}
          <Field id="po-note" label={c('notes')} className={mode === 'po' ? undefined : 'col-span-2'}><Textarea id="po-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <LinesEditor lines={lines} setLines={setLines} warehouseId={wh} />
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('purchasing.subtotalExcl')}: <b className="text-foreground">{f.money(subtotal)}</b></span>
          <Button onClick={() => save.mutate()} disabled={invalid || save.isPending}>{c('save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Summary() {
  const t = useTranslations('work');
  const f = useFormat();
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ['purchasing-summary'], queryFn: () => api<{ openOrders: number; lateOrders: number; unpaidInvoices: number; payable: number; overdue: number }>('/purchasing/summary') });
  if (!data) return null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label={t('purchasing.openOrders')} value={data.openOrders} />
      <StatCard label={t('purchasing.lateOrders')} value={data.lateOrders} tone={data.lateOrders ? 'warn' : undefined} />
      {can('finance:read') && <StatCard label={t('purchasing.payable')} value={f.money(data.payable)} hint={t('purchasing.unpaidCount', { n: data.unpaidInvoices })} />}
      {can('finance:read') && <StatCard label={t('purchasing.overdue')} value={f.money(data.overdue)} tone={data.overdue ? 'danger' : undefined} />}
    </div>
  );
}

export default function PurchasingPage() {
  const t = useTranslations('work');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'orders' | 'receipts'>('orders');
  const [status, setStatus] = useState('');
  const [dlg, setDlg] = useState<'po' | 'direct' | null>(null);
  const voidReceipt = useMutation({
    mutationFn: (id: string) => api(`/goods-receipts/${id}/void`, { method: 'POST' }),
    onSuccess: () => { toast.success(t('purchasing.voided')); qc.invalidateQueries({ queryKey: ['goods-receipts'] }); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); invalidateInventory(qc); },
    onError: (e) => toast.error(workError(e, t)),
  });

  const poCols: Column<Po>[] = [
    { header: t('purchasing.number'), cell: (p) => <Link href={`/purchasing/${p.id}` as '/'} className="font-mono text-xs underline">{p.number}</Link> },
    { header: t('purchasing.supplier'), cell: (p) => p.supplier.name },
    { header: t('purchasing.expectedAt'), cell: (p) => f.date(p.expectedAt), className: 'hidden md:table-cell' },
    { header: t('purchasing.totalIncl'), cell: (p) => f.money(p.total), className: 'hidden sm:table-cell' },
    { header: c('status'), cell: (p) => <Badge variant={poTone(p.status)}>{t(`purchasing.status.${p.status}`)}</Badge> },
  ];
  const rcCols: Column<Receipt>[] = [
    { header: t('purchasing.number'), cell: (r) => <span className="font-mono text-xs">{r.number}</span> },
    { header: c('date'), cell: (r) => f.date(r.receivedAt) },
    { header: t('purchasing.supplier'), cell: (r) => r.supplier.name },
    { header: t('purchasing.order'), cell: (r) => (r.purchaseOrder ? <Link href={`/purchasing/${r.purchaseOrder.id}` as '/'} className="font-mono text-xs underline">{r.purchaseOrder.number}</Link> : t('purchasing.direct')), className: 'hidden md:table-cell' },
    { header: t('purchasing.deliveryNote'), cell: (r) => r.deliveryNoteRef ?? '—', className: 'hidden lg:table-cell' },
    { header: c('status'), cell: (r) => <Badge variant={r.status === 'POSTED' ? 'success' : 'danger'}>{t(`purchasing.receiptStatus.${r.status}`)}</Badge> },
    { header: '', className: 'w-12', cell: (r) => r.status === 'POSTED' && can('purchasing:approve') ? <Button variant="ghost" size="icon" aria-label={t('purchasing.voidReceipt')} onClick={() => confirm(t('purchasing.confirmVoid')) && voidReceipt.mutate(r.id)}><Undo2 /></Button> : null },
  ];

  return (
    <RequirePermission permission="purchasing:read">
      <div className="space-y-4">
        <PageHeader title={t('purchasing.title')} actions={<>
          {can('purchasing:receive') && <Button variant="outline" onClick={() => setDlg('direct')}>{t('purchasing.directReceipt')}</Button>}
          {can('purchasing:create') && <Button onClick={() => setDlg('po')}><Plus /> {t('purchasing.newOrder')}</Button>}
        </>} />
        <Summary />
        <Tabs value={tab} onChange={setTab} items={[{ value: 'orders', label: t('purchasing.orders') }, { value: 'receipts', label: t('purchasing.receipts') }]} />
        {tab === 'orders' ? (
          <DataTable<Po> key="orders" queryKey="purchase-orders" endpoint="/purchase-orders" columns={poCols} extraQuery={{ status: status || undefined }}
            toolbar={<NativeSelect aria-label={c('status')} value={status} onChange={(e) => setStatus(e.target.value)} className="w-44"><option value="">{c('all')}</option>{['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].map((s) => <option key={s} value={s}>{t(`purchasing.status.${s}`)}</option>)}</NativeSelect>} />
        ) : <DataTable<Receipt> key="receipts" queryKey="goods-receipts" endpoint="/goods-receipts" columns={rcCols} />}
        <OrderDialog mode={dlg} onClose={() => setDlg(null)} />
      </div>
    </RequirePermission>
  );
}
