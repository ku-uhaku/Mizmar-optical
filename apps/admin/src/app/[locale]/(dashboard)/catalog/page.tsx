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
const LENS_KINDS = ['SINGLE_VISION', 'BIFOCAL', 'PROGRESSIVE', 'OFFICE', 'READING', 'PLANO'];
const TREATMENT_CATEGORIES = ['ANTI_REFLECTIVE', 'BLUE_LIGHT', 'PHOTOCHROMIC', 'POLARIZED', 'TINT', 'HARD_COAT', 'UV', 'OTHER'];

export default function CatalogPage() {
  const t = useTranslations('catalog');
  const c = useTranslations('common');
  const { can } = useAuth();
  const f = useFormat();
  const [tab, setTab] = useState('brands');

  const active = (r: Row) => (r.isActive ? <Check className="size-4 text-emerald-600" aria-label={c('active')} /> : <X className="size-4 text-muted-foreground" aria-label={c('inactive')} />);
  const name: Column<Row> = { header: c('name'), cell: (r) => <span className="font-medium">{r.name}</span> };
  const act: Column<Row> = { header: c('status'), cell: active, className: 'w-20' };
  const trans = (d: string): FieldDef => ({ name: 'description', label: d, type: 'textarea' });
  const common: FieldDef[] = [{ name: 'sortOrder', label: c('sortOrder'), type: 'number', step: '1' }, { name: 'isActive', label: c('status'), type: 'checkbox', hint: c('active') }];
  const kindOptions = (ns: string, list: string[]) => list.map((k) => ({ value: k, label: t(`${ns}.${k}`) }));

  const tabs = [
    { value: 'brands', label: t('tabs.brands'), perm: 'catalog', node: (
      <ResourcePage queryKey="brands" endpoint="/brands" module="catalog" title={t('tabs.brands')}
        columns={[name, { header: t('featured'), cell: (r) => (r.isFeatured ? <Badge>{t('featured')}</Badge> : '—') }, act]}
        fields={[{ name: 'name', label: c('name'), required: true }, { name: 'website', label: t('website') }, { name: 'logoUrl', label: t('logoUrl'), span: 2 }, trans(c('description')), { name: 'isFeatured', label: t('featured'), type: 'checkbox', hint: t('featured') }, ...common]} />) },
    { value: 'categories', label: t('tabs.categories'), perm: 'catalog', node: (
      <ResourcePage queryKey="categories" endpoint="/categories" module="catalog" title={t('tabs.categories')}
        columns={[name, { header: t('parent'), cell: (r) => r.parent?.name ?? '—' }, act]}
        fields={[{ name: 'name', label: c('name'), required: true }, { name: 'parentId', label: t('parent'), type: 'select', optionsFrom: { endpoint: '/categories' } }, trans(c('description')), ...common]} />) },
    { value: 'shapes', label: t('tabs.shapes'), perm: 'catalog', node: (
      <ResourcePage queryKey="shapes" endpoint="/frame-shapes" module="catalog" title={t('tabs.shapes')} columns={[name, act]} fields={[{ name: 'name', label: c('name'), required: true }, ...common]} />) },
    { value: 'materials', label: t('tabs.materials'), perm: 'catalog', node: (
      <ResourcePage queryKey="materials" endpoint="/frame-materials" module="catalog" title={t('tabs.materials')} columns={[name, act]} fields={[{ name: 'name', label: c('name'), required: true }, ...common]} />) },
    { value: 'lensTypes', label: t('tabs.lensTypes'), perm: 'catalog', node: (
      <ResourcePage queryKey="lens-types" endpoint="/lens-types" module="catalog" title={t('tabs.lensTypes')}
        columns={[name, { header: t('kind'), cell: (r) => t(`kinds.${r.kind}`) }, { header: c('price'), cell: (r) => f.money(r.basePrice) }, { header: t('tabs.treatments'), cell: (r) => r.treatments?.length ?? 0 }, act]}
        fields={[{ name: 'code', label: c('code'), required: true, createOnly: true, hint: 'a-z 0-9 _' }, { name: 'kind', label: t('kind'), type: 'select', required: true, options: kindOptions('kinds', LENS_KINDS) }, { name: 'name', label: c('name'), required: true }, { name: 'basePrice', label: c('price'), type: 'number', step: '0.01' },
          { name: 'requiresAdd', label: t('requiresAdd'), type: 'checkbox', hint: t('requiresAdd') }, trans(c('description')),
          { name: 'treatmentIds', label: t('tabs.treatments'), type: 'multiselect', optionsFrom: { endpoint: '/lens-treatments' }, initial: (r) => (r.treatments ?? []).map((x: any) => x.treatmentId) }, ...common]} />) },
    { value: 'treatments', label: t('tabs.treatments'), perm: 'catalog', node: (
      <ResourcePage queryKey="lens-treatments" endpoint="/lens-treatments" module="catalog" title={t('tabs.treatments')}
        columns={[name, { header: t('category'), cell: (r) => t(`categories.${r.category}`) }, { header: c('price'), cell: (r) => f.money(r.price) }, act]}
        fields={[{ name: 'code', label: c('code'), required: true, createOnly: true }, { name: 'category', label: t('category'), type: 'select', required: true, options: kindOptions('categories', TREATMENT_CATEGORIES) }, { name: 'name', label: c('name'), required: true }, { name: 'price', label: c('price'), type: 'number', step: '0.01' }, trans(c('description')), ...common]} />) },
    { value: 'lensEntries', label: t('tabs.lensEntries'), perm: 'catalog', node: (
      <ResourcePage queryKey="lens-entries" endpoint="/lens-entries" module="catalog" title={t('tabs.lensEntries')}
        columns={[{ header: c('sku'), cell: (r) => <span className="font-mono text-xs">{r.sku}</span> }, name, { header: t('lensType'), cell: (r) => r.lensType?.name }, { header: t('index'), cell: (r) => Number(r.refractiveIndex).toFixed(2) }, { header: c('price'), cell: (r) => f.money(r.price) }, act]}
        fields={[{ name: 'lensTypeId', label: t('lensType'), type: 'select', required: true, optionsFrom: { endpoint: '/lens-types' } }, { name: 'sku', label: c('sku'), required: true }, { name: 'name', label: c('name'), required: true }, { name: 'refractiveIndex', label: t('index'), type: 'number', step: '0.01', required: true },
          { name: 'material', label: t('material') }, { name: 'diameterMm', label: t('diameter'), type: 'number', step: '1' }, { name: 'sphMin', label: 'SPH min', type: 'number', step: '0.25' }, { name: 'sphMax', label: 'SPH max', type: 'number', step: '0.25' }, { name: 'cylMin', label: 'CYL min', type: 'number', step: '0.25' }, { name: 'cylMax', label: 'CYL max', type: 'number', step: '0.25' },
          { name: 'price', label: c('price'), type: 'number', step: '0.01', required: true }, { name: 'cost', label: c('cost'), type: 'number', step: '0.01' }, { name: 'leadTimeDays', label: t('leadTime'), type: 'number', step: '1' }, { name: 'isActive', label: c('status'), type: 'checkbox', hint: c('active') }]} />) },
  ].filter((x) => can(`${x.perm}:read`));

  return (
    <RequirePermission permission="catalog:read">
      <div className="space-y-4">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <Tabs value={tab} onChange={setTab} items={tabs.map(({ value, label }) => ({ value, label }))} />
        <div key={tab}>{tabs.find((x) => x.value === tab)?.node}</div>
      </div>
    </RequirePermission>
  );
}
