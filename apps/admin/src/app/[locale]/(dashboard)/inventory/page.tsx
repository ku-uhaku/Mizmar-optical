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
import { NativeSelect } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { useWarehouseLabel } from '@/lib/warehouses';
import { AdjustmentsTab, CountsTab, TransfersTab, useWarehouses } from './documents';

const MOVEMENT_TYPES = ['INITIAL', 'PURCHASE_RECEIPT', 'SALE', 'SALE_RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'COUNT_CORRECTION', 'LAB_CONSUMPTION', 'SUPPLIER_RETURN'];

function StockTab() {
  const t = useTranslations('inventory');
  const c = useTranslations('common');
  const f = useFormat();
  const wh = useWarehouses();
  const whName = useWarehouseLabel();
  const [warehouseId, setWarehouseId] = useState('');
  const [low, setLow] = useState(false);
  const columns: Column<any>[] = [
    { header: c('name'), cell: (l) => <div><div className="font-medium">{l.variant.product.name}</div><div className="text-xs text-muted-foreground">{[l.variant.color, l.variant.size].filter(Boolean).join(' · ')} · <span className="font-mono">{l.variant.sku}</span></div></div> },
    { header: t('warehouse'), cell: (l) => whName(l.warehouse), className: 'hidden md:table-cell' },
    { header: t('onHand'), cell: (l) => <Badge variant={l.quantity <= 0 ? 'danger' : l.isLow ? 'default' : 'success'}>{f.int(l.quantity)}</Badge> },
    { header: t('reserved'), cell: (l) => l.reserved, className: 'hidden sm:table-cell' },
    { header: t('available'), cell: (l) => l.available, className: 'hidden sm:table-cell' },
    { header: t('reorderPoint'), cell: (l) => l.reorderPoint || '—', className: 'hidden lg:table-cell' },
    { header: c('status'), cell: (l) => (l.quantity <= 0 ? <Badge variant="danger">{t('outOfStock')}</Badge> : l.isLow ? <Badge>{t('lowStock')}</Badge> : null) },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <NativeSelect className="w-60" aria-label={t('warehouse')} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">{t('warehouse')}: {c('all')}</option>{wh.data?.map((w) => <option key={w.id} value={w.id}>{w.store.name} — {w.name}</option>)}</NativeSelect>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={low} onChange={(e) => setLow(e.target.checked)} /> {t('onlyLow')}</label>
      </div>
      <DataTable<any> queryKey="inv-stock" endpoint="/inventory/stock" columns={columns} extraQuery={{ warehouseId: warehouseId || undefined, lowStock: low ? 'true' : undefined }} />
    </div>
  );
}

function MovementsTab() {
  const t = useTranslations('inventory');
  const c = useTranslations('common');
  const f = useFormat();
  const whName = useWarehouseLabel();
  const [type, setType] = useState('');
  const columns: Column<any>[] = [
    { header: c('date'), cell: (m) => f.dateTime(m.createdAt) },
    { header: c('name'), cell: (m) => <div><div className="font-medium">{m.variant.product.name}</div><div className="font-mono text-xs text-muted-foreground">{m.variant.sku}</div></div> },
    { header: t('warehouse'), cell: (m) => whName(m.warehouse), className: 'hidden md:table-cell' },
    { header: c('type'), cell: (m) => <Badge variant="secondary">{t(`movementTypes.${m.type}`)}</Badge> },
    { header: c('quantity'), cell: (m) => <span className={m.quantity < 0 ? 'font-medium text-destructive' : 'font-medium text-emerald-600'}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span> },
    { header: t('balance'), cell: (m) => m.balanceAfter, className: 'hidden sm:table-cell' },
    { header: c('notes'), cell: (m) => <span className="text-muted-foreground">{m.note ?? ''}</span>, className: 'hidden lg:table-cell' },
  ];
  return (
    <div className="space-y-3">
      <NativeSelect className="w-60" aria-label={c('type')} value={type} onChange={(e) => setType(e.target.value)}><option value="">{c('type')}: {c('all')}</option>{MOVEMENT_TYPES.map((x) => <option key={x} value={x}>{t(`movementTypes.${x}`)}</option>)}</NativeSelect>
      <DataTable<any> queryKey="inv-movements" endpoint="/inventory/movements" columns={columns} extraQuery={{ type: type || undefined }} />
    </div>
  );
}

export default function InventoryPage() {
  const t = useTranslations('inventory');
  const f = useFormat();
  const [tab, setTab] = useState('stock');
  const summary = useQuery({ queryKey: ['inv-summary'], queryFn: () => api<{ units: number; value: number; lowStock: number; outOfStock: number; skus: number }>('/inventory/summary') });
  const s = summary.data;
  return (
    <RequirePermission permission="inventory:read">
      <div className="space-y-4">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label={t('units')} value={f.int(s?.units)} />
          <StatCard label={t('skus')} value={f.int(s?.skus)} />
          <StatCard label={t('stockValue')} value={f.money(s?.value)} hint={t('atCost')} />
          <StatCard label={t('lowStock')} value={f.int(s?.lowStock)} tone={s?.lowStock ? 'warn' : undefined} />
          <StatCard label={t('outOfStock')} value={f.int(s?.outOfStock)} tone={s?.outOfStock ? 'danger' : undefined} />
        </div>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'stock', label: t('tabs.stock') }, { value: 'movements', label: t('tabs.movements') }, { value: 'adjustments', label: t('tabs.adjustments') }, { value: 'transfers', label: t('tabs.transfers') }, { value: 'counts', label: t('tabs.counts') }]} />
        <div key={tab}>
          {tab === 'stock' && <StockTab />}{tab === 'movements' && <MovementsTab />}{tab === 'adjustments' && <AdjustmentsTab />}{tab === 'transfers' && <TransfersTab />}{tab === 'counts' && <CountsTab />}
        </div>
      </div>
    </RequirePermission>
  );
}
