'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { ResourcePage, type FieldDef } from '@/components/resource-page';
import type { Column } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Tabs } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';

type Row = { id: string; [k: string]: any };
const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');
const list = (v: string) => { const a = String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean); return a.length ? a : undefined; };

export default function PromotionsPage() {
  const t = useTranslations('shopAdmin');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const [tab, setTab] = useState<'coupons' | 'shipping'>('coupons');
  const active = (r: Row) => (r.isActive ? <Check className="size-4 text-emerald-600" aria-label={c('active')} /> : <X className="size-4 text-muted-foreground" aria-label={c('inactive')} />);

  const couponCols: Column<Row>[] = [
    { header: c('code'), cell: (r) => <span className="font-mono text-xs font-medium">{r.code}</span> },
    { header: c('type'), cell: (r) => <Badge variant="secondary">{t(`coupons.type.${r.type}`)}</Badge> },
    { header: t('coupons.value'), cell: (r) => (r.type === 'PERCENT' ? `${Number(r.value)} %` : r.type === 'FIXED' ? f.money(Number(r.value)) : '—') },
    { header: t('coupons.used'), cell: (r) => `${r.usedCount}${r.usageLimit ? ` / ${r.usageLimit}` : ''}`, className: 'hidden md:table-cell' },
    { header: t('coupons.validity'), cell: (r) => (r.startsAt || r.endsAt ? `${day(r.startsAt) || '…'} → ${day(r.endsAt) || '…'}` : '—'), className: 'hidden lg:table-cell' },
    { header: c('status'), cell: active, className: 'w-16' },
  ];
  const couponFields: FieldDef[] = [
    { name: 'code', label: c('code'), required: true, createOnly: true, hint: 'BIENVENUE10' }, { name: 'description', label: c('description') },
    { name: 'type', label: c('type'), type: 'select', required: true, options: ['PERCENT', 'FIXED', 'FREE_SHIPPING'].map((x) => ({ value: x, label: t(`coupons.type.${x}`) })) }, { name: 'value', label: t('coupons.value'), type: 'number', step: '0.01', hint: t('coupons.valueHint') },
    { name: 'minSubtotal', label: t('coupons.minSubtotal'), type: 'number', step: '0.01' }, { name: 'maxDiscount', label: t('coupons.maxDiscount'), type: 'number', step: '0.01' },
    { name: 'usageLimit', label: t('coupons.usageLimit'), type: 'number', step: '1' }, { name: 'perCustomerLimit', label: t('coupons.perCustomerLimit'), type: 'number', step: '1' },
    { name: 'startsAt', label: t('coupons.startsAt'), type: 'date', initial: (r) => day(r.startsAt) }, { name: 'endsAt', label: t('coupons.endsAt'), type: 'date', initial: (r) => day(r.endsAt) },
    { name: 'isActive', label: c('status'), type: 'checkbox', hint: c('active') },
  ];
  const shipCols: Column<Row>[] = [
    { header: c('name'), cell: (r) => <span className="font-medium">{r.name}</span> }, { header: c('code'), cell: (r) => <span className="font-mono text-xs">{r.code}</span>, className: 'hidden md:table-cell' },
    { header: c('price'), cell: (r) => f.money(Number(r.price)) }, { header: t('shipping.freeOver'), cell: (r) => (r.freeOverAmount == null ? '—' : f.money(Number(r.freeOverAmount))), className: 'hidden md:table-cell' },
    { header: t('shipping.zones'), cell: (r) => (Array.isArray(r.zones) && r.zones.length ? r.zones.join(', ') : t('shipping.everywhere')), className: 'hidden lg:table-cell' }, { header: c('status'), cell: active, className: 'w-16' },
  ];
  const shipFields: FieldDef[] = [
    { name: 'code', label: c('code'), required: true, createOnly: true, hint: 'express' }, { name: 'name', label: c('name'), required: true }, { name: 'description', label: c('description'), span: 2 },
    { name: 'price', label: c('price'), type: 'number', step: '0.01', required: true }, { name: 'freeOverAmount', label: t('shipping.freeOver'), type: 'number', step: '0.01' },
    { name: 'estimatedDaysMin', label: t('shipping.daysMin'), type: 'number', step: '1' }, { name: 'estimatedDaysMax', label: t('shipping.daysMax'), type: 'number', step: '1' },
    { name: 'zones', label: t('shipping.zones'), span: 2, hint: t('shipping.zonesHint'), initial: (r) => (Array.isArray(r.zones) ? r.zones.join(', ') : ''), toBody: list },
    { name: 'sortOrder', label: c('sortOrder'), type: 'number', step: '1' }, { name: 'isActive', label: c('status'), type: 'checkbox', hint: c('active') },
  ];
  return (
    <RequirePermission permission="coupons:read">
      <div className="space-y-4">
        <PageHeader title={t('promotions.title')} />
        <Tabs value={tab} onChange={setTab} items={[{ value: 'coupons', label: t('promotions.coupons') }, ...(can('shipping:read') ? [{ value: 'shipping' as const, label: t('promotions.shipping') }] : [])]} />
        {tab === 'coupons'
          ? <ResourcePage key="coupons" queryKey="coupons" endpoint="/coupons" module="coupons" title={t('promotions.coupons')} columns={couponCols} fields={couponFields} defaults={{ type: 'PERCENT', isActive: true }} />
          : <ResourcePage key="shipping" queryKey="shipping-methods" endpoint="/shipping-methods" module="shipping" title={t('promotions.shipping')} columns={shipCols} fields={shipFields} defaults={{ price: 0, isActive: true, sortOrder: 0 }} />}
      </div>
    </RequirePermission>
  );
}
