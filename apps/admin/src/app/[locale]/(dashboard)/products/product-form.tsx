'use client';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { api, ApiError, type Paginated } from '@/lib/api';
import { Field } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useWarehouses } from '@/lib/warehouses';
import { PRODUCT_TYPES } from './page';

type Opt = { id: string; name: string };
const useOptions = (endpoint: string) => useQuery({ queryKey: ['options', endpoint], queryFn: () => api<Paginated<Opt>>(endpoint, { query: { limit: 100 } }), staleTime: 60_000 });
const num = (v: unknown) => (v === '' || v == null || Number.isNaN(v) ? undefined : Number(v));
const FRAME_TYPES = ['FRAME', 'SUNGLASSES'];

interface VariantForm { sku: string; barcode: string; color: string; colorHex: string; size: string; price: number | string; cost: number | string; openingQty: number | string }
export interface ProductFormValues {
  type: string; name: string; brandId: string; categoryId: string; gender: string; status: string; shortDescription: string; description: string; tags: string;
  isPublished: boolean; isFeatured: boolean; requiresPrescription: boolean; isLensConfigurable: boolean; seoTitle: string; seoDescription: string;
  shapeId: string; materialId: string; rimType: string; lensWidthMm: number | string; bridgeMm: number | string; templeMm: number | string; isPolarized: boolean;
  openingWarehouseId: string; variants: VariantForm[];
}

const emptyVariant: VariantForm = { sku: '', barcode: '', color: '', colorHex: '', size: '', price: '', cost: '', openingQty: '' };

export function toFormValues(p?: any): ProductFormValues {
  return {
    type: p?.type ?? 'FRAME', name: p?.name ?? '', brandId: p?.brandId ?? '', categoryId: p?.categoryId ?? '', gender: p?.gender ?? '', status: p?.status ?? 'DRAFT',
    shortDescription: p?.shortDescription ?? '', description: p?.description ?? '', tags: (p?.tags ?? []).join(', '), isPublished: p?.isPublished ?? false, isFeatured: p?.isFeatured ?? false,
    requiresPrescription: p?.requiresPrescription ?? false, isLensConfigurable: p?.isLensConfigurable ?? false, seoTitle: p?.seoTitle ?? '', seoDescription: p?.seoDescription ?? '',
    shapeId: p?.frameSpec?.shapeId ?? '', materialId: p?.frameSpec?.materialId ?? '', rimType: p?.frameSpec?.rimType ?? '', lensWidthMm: p?.frameSpec?.lensWidthMm ?? '', bridgeMm: p?.frameSpec?.bridgeMm ?? '',
    templeMm: p?.frameSpec?.templeMm ?? '', isPolarized: p?.frameSpec?.isPolarized ?? false, openingWarehouseId: '', variants: p ? [] : [{ ...emptyVariant }],
  };
}

/** Product details form, used for both "new" (with variants + opening stock) and "edit" (variants are managed separately). */
export function ProductForm({ product }: { product?: any }) {
  const t = useTranslations('products');
  const c = useTranslations('common');
  const router = useRouter();
  const qc = useQueryClient();
  const isNew = !product;
  const form = useForm<ProductFormValues>({ defaultValues: toFormValues(product) });
  const { register, control, handleSubmit, formState: { errors } } = form;
  const variants = useFieldArray({ control, name: 'variants' });
  const type = useWatch({ control, name: 'type' });
  const isFrame = FRAME_TYPES.includes(type);
  const brands = useOptions('/brands'), categories = useOptions('/categories'), shapes = useOptions('/frame-shapes'), materials = useOptions('/frame-materials');
  const warehouses = useWarehouses();

  const save = useMutation({
    mutationFn: async (v: ProductFormValues) => {
      const frameSpec = isFrame ? { shapeId: v.shapeId || undefined, materialId: v.materialId || undefined, rimType: v.rimType || undefined, lensWidthMm: num(v.lensWidthMm), bridgeMm: num(v.bridgeMm), templeMm: num(v.templeMm), isPolarized: v.isPolarized } : undefined;
      const body: Record<string, unknown> = {
        name: v.name, brandId: v.brandId || undefined, categoryId: v.categoryId || undefined, gender: v.gender || undefined, status: v.status, shortDescription: v.shortDescription || undefined, description: v.description || undefined,
        tags: v.tags.split(',').map((x) => x.trim()).filter(Boolean), isPublished: v.isPublished, isFeatured: v.isFeatured, requiresPrescription: v.requiresPrescription, isLensConfigurable: v.isLensConfigurable,
        seoTitle: v.seoTitle || undefined, seoDescription: v.seoDescription || undefined, frameSpec,
      };
      if (!isNew) return api(`/products/${product.id}`, { method: 'PATCH', body });
      const wh = v.openingWarehouseId || warehouses.data?.[0]?.id;
      return api<{ id: string }>('/products', { method: 'POST', body: {
        ...body, type: v.type,
        variants: v.variants.map((x) => ({ sku: x.sku.trim(), barcode: x.barcode.trim() || undefined, color: x.color || undefined, colorHex: x.colorHex || undefined, size: x.size || undefined, price: num(x.price), cost: num(x.cost),
          initialStock: num(x.openingQty) && wh ? [{ warehouseId: wh, quantity: num(x.openingQty) }] : undefined })),
      } });
    },
    onSuccess: (res: any) => {
      toast.success(c('saved')); qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['product'] });
      if (isNew) router.replace(`/products/${res.id}` as '/');
    },
    onError: (e) => toast.error(e instanceof ApiError && e.code === 'UNIQUE_CONSTRAINT' ? t('skuTaken') : e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]).join(' · ') : (e as Error).message),
  });

  const sel = (name: keyof ProductFormValues, label: string, opts: { value: string; label: string }[], disabled = false) => (
    <Field id={name} label={label}><NativeSelect id={name} disabled={disabled} {...register(name as any)}><option value="">—</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect></Field>
  );
  const check = (name: keyof ProductFormValues, label: string) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" {...register(name as any)} /> {label}</label>
  );

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sel('type', c('type'), PRODUCT_TYPES.map((x) => ({ value: x, label: t(`types.${x}`) })), !isNew)}
          <Field id="name" label={c('name')} required error={errors.name?.message} className="lg:col-span-2"><Input id="name" aria-invalid={!!errors.name} {...register('name', { required: c('required') })} /></Field>
          {sel('brandId', t('brand'), brands.data?.data.map((b) => ({ value: b.id, label: b.name })) ?? [])}
          {sel('categoryId', t('category'), categories.data?.data.map((b) => ({ value: b.id, label: b.name })) ?? [])}
          {sel('gender', t('gender'), ['MEN', 'WOMEN', 'UNISEX', 'KIDS'].map((g) => ({ value: g, label: t(`genders.${g}`) })))}
          {sel('status', c('status'), ['DRAFT', 'ACTIVE', 'ARCHIVED'].map((s) => ({ value: s, label: t(`statuses.${s}`) })))}
          <Field id="shortDescription" label={t('shortDescription')} className="sm:col-span-2 lg:col-span-3"><Input id="shortDescription" {...register('shortDescription')} /></Field>
          <Field id="description" label={c('description')} className="sm:col-span-2 lg:col-span-3"><Textarea id="description" {...register('description')} /></Field>
          <Field id="tags" label={t('tags')} hint={t('tagsHint')} className="sm:col-span-2 lg:col-span-3"><Input id="tags" {...register('tags')} /></Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2 lg:col-span-3">
            {check('isPublished', t('published'))}{check('isFeatured', t('featured'))}{check('requiresPrescription', t('requiresPrescription'))}{isFrame && check('isLensConfigurable', t('lensConfigurable'))}
          </div>
        </CardContent>
      </Card>

      {isFrame && (
        <Card>
          <CardHeader><CardTitle>{t('frameSpec')}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {sel('shapeId', t('shape'), shapes.data?.data.map((b) => ({ value: b.id, label: b.name })) ?? [])}
            {sel('materialId', t('material'), materials.data?.data.map((b) => ({ value: b.id, label: b.name })) ?? [])}
            {sel('rimType', t('rimType'), ['FULL_RIM', 'SEMI_RIMLESS', 'RIMLESS'].map((r) => ({ value: r, label: t(`rims.${r}`) })))}
            <div className="flex items-end pb-2">{check('isPolarized', t('polarized'))}</div>
            <Field id="lensWidthMm" label={t('lensWidth')} hint="mm"><Input id="lensWidthMm" type="number" {...register('lensWidthMm')} /></Field>
            <Field id="bridgeMm" label={t('bridge')} hint="mm"><Input id="bridgeMm" type="number" {...register('bridgeMm')} /></Field>
            <Field id="templeMm" label={t('temple')} hint="mm"><Input id="templeMm" type="number" {...register('templeMm')} /></Field>
          </CardContent>
        </Card>
      )}

      {isNew && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{t('variants')}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {(warehouses.data?.length ?? 0) > 1 && <NativeSelect className="w-full sm:w-56" aria-label={t('openingWarehouse')} {...register('openingWarehouseId')}>{warehouses.data!.map((w) => <option key={w.id} value={w.id}>{w.store.name} — {w.name}</option>)}</NativeSelect>}
              <Button type="button" variant="outline" size="sm" onClick={() => variants.append({ ...emptyVariant })}><Plus /> {t('addVariant')}</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {variants.fields.map((field, i) => (
              <div key={field.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-4 lg:grid-cols-8">
                <Field id={`v${i}sku`} label={c('sku')} required error={errors.variants?.[i]?.sku?.message}><Input id={`v${i}sku`} {...register(`variants.${i}.sku`, { required: c('required') })} /></Field>
                <Field id={`v${i}bc`} label={t('barcode')}><Input id={`v${i}bc`} {...register(`variants.${i}.barcode`)} /></Field>
                <Field id={`v${i}color`} label={t('color')}><Input id={`v${i}color`} {...register(`variants.${i}.color`)} /></Field>
                <Field id={`v${i}hex`} label={t('colorHex')}><Input id={`v${i}hex`} type="color" className="h-9 p-1" {...register(`variants.${i}.colorHex`)} /></Field>
                <Field id={`v${i}size`} label={t('size')}><Input id={`v${i}size`} placeholder="52-18-145" {...register(`variants.${i}.size`)} /></Field>
                <Field id={`v${i}price`} label={c('price')} required error={errors.variants?.[i]?.price?.message}><Input id={`v${i}price`} type="number" step="0.01" {...register(`variants.${i}.price`, { required: c('required') })} /></Field>
                <Field id={`v${i}cost`} label={c('cost')}><Input id={`v${i}cost`} type="number" step="0.01" {...register(`variants.${i}.cost`)} /></Field>
                <div className="flex items-end gap-1">
                  <Field id={`v${i}qty`} label={t('openingStock')}><Input id={`v${i}qty`} type="number" min={0} {...register(`variants.${i}.openingQty`)} /></Field>
                  {variants.fields.length > 1 && <Button type="button" variant="ghost" size="icon" aria-label={c('remove')} onClick={() => variants.remove(i)}><Trash2 className="text-destructive" /></Button>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <div className="flex gap-2"><Button type="submit" disabled={save.isPending}>{c('save')}</Button></div>
    </form>
  );
}
