'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import type { Column } from '@/components/data-table';
import { ResourcePage, type FieldDef } from '@/components/resource-page';
import { Tabs } from '@/components/ui/tabs';
import { useFormat } from '@/lib/format';

type Row = { id: string; [k: string]: any };

export function SettingsTab() {
  const t = useTranslations('hr');
  const c = useTranslations('common');
  const f = useFormat();
  const [tab, setTab] = useState<'leave' | 'rules'>('leave');
  const ok = (v: unknown) => (v ? <Check className="size-4 text-emerald-600" aria-label={c('active')} /> : <X className="size-4 text-muted-foreground" aria-label={c('inactive')} />);
  const leaveCols: Column<Row>[] = [{ header: c('code'), cell: (r) => <span className="font-mono text-xs">{r.code}</span> }, { header: c('name'), cell: (r) => <b>{r.name}</b> }, { header: t('set.paid'), cell: (r) => ok(r.isPaid) }, { header: t('set.allowance'), cell: (r) => (r.annualDays == null ? '∞' : Number(r.annualDays)) }, { header: c('status'), cell: (r) => ok(r.isActive) }];
  const leaveFields: FieldDef[] = [{ name: 'code', label: c('code'), required: true, createOnly: true }, { name: 'name', label: c('name'), required: true }, { name: 'annualDays', label: t('set.allowance'), type: 'number', step: '0.5', hint: t('set.allowanceHint') }, { name: 'isPaid', label: t('set.paid'), type: 'checkbox', hint: t('set.paid') }, { name: 'requiresApproval', label: t('set.approval'), type: 'checkbox', hint: t('set.approval') }, { name: 'isActive', label: c('status'), type: 'checkbox', hint: c('active') }];
  const ruleCols: Column<Row>[] = [{ header: c('name'), cell: (r) => <b>{r.name}</b> }, { header: t('set.scope'), cell: (r) => t(`set.scopes.${r.scope}`) }, { header: t('comm.rate'), cell: (r) => (r.rateType === 'PERCENT' ? `${Number(r.value)} %` : f.money(Number(r.value))) }, { header: c('status'), cell: (r) => ok(r.isActive) }];
  const ruleFields: FieldDef[] = [
    { name: 'name', label: c('name'), required: true, span: 2 }, { name: 'scope', label: t('set.scope'), type: 'select', options: ['ALL', 'PRODUCT_TYPE'].map((s) => ({ value: s, label: t(`set.scopes.${s}`) })) },
    { name: 'productType', label: c('type'), type: 'select', options: ['FRAME', 'SUNGLASSES', 'CONTACT_LENS', 'LENS', 'ACCESSORY'].map((s) => ({ value: s, label: s })), hint: t('set.productTypeHint') },
    { name: 'rateType', label: t('comm.rate'), type: 'select', options: ['PERCENT', 'FIXED'].map((s) => ({ value: s, label: t(`set.rateTypes.${s}`) })) }, { name: 'value', label: t('comm.value'), type: 'number', step: '0.01', required: true },
    { name: 'minSale', label: t('set.minSale'), type: 'number', step: '0.01' }, { name: 'isActive', label: c('status'), type: 'checkbox', hint: c('active') },
  ];
  return (
    <div className="space-y-4">
      <Tabs value={tab} onChange={setTab} items={[{ value: 'leave', label: t('set.leaveTypes') }, { value: 'rules', label: t('set.rules') }]} />
      {tab === 'leave' ? <ResourcePage key="lt" queryKey="leave-types" endpoint="/leave-types" module="hr" title={t('set.leaveTypes')} columns={leaveCols} fields={leaveFields} defaults={{ isPaid: true, requiresApproval: true, isActive: true }} />
        : <ResourcePage key="cr" queryKey="commission-rules" endpoint="/commission-rules" module="hr" title={t('set.rules')} columns={ruleCols} fields={ruleFields} defaults={{ scope: 'ALL', rateType: 'PERCENT', isActive: true }} />}
    </div>
  );
}
