'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { invalidateInventory } from '@/lib/query';
import { useWarehouses } from '@/lib/warehouses';
import { Field } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

interface Variant { id: string; sku: string; barcode: string | null; color: string | null; colorHex: string | null; size: string | null; price: number; cost: number | null; isActive: boolean; stock: { warehouse: { id: string; name: string; code: string }; quantity: number; reserved: number; reorderPoint: number }[] }
interface V { sku: string; barcode: string; color: string; colorHex: string; size: string; price: number | string; cost: number | string; isActive: boolean; openingWarehouseId: string; openingQty: number | string }
const num = (v: unknown) => (v === '' || v == null || Number.isNaN(v) ? undefined : Number(v));

export function VariantsPanel({ productId, variants }: { productId: string; variants: Variant[] }) {
  const t = useTranslations('products');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Variant | 'new' | null>(null);
  const warehouses = useWarehouses(editing === 'new');
  const form = useForm<V>();
  const { register, handleSubmit, reset, formState: { errors } } = form;
  const canWrite = can('products:update');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['product', productId] }); qc.invalidateQueries({ queryKey: ['products'] }); invalidateInventory(qc); };

  const open = (v: Variant | 'new') => {
    setEditing(v);
    reset(v === 'new' ? { sku: '', barcode: '', color: '', colorHex: '#000000', size: '', price: '', cost: '', isActive: true, openingWarehouseId: '', openingQty: '' }
      : { sku: v.sku, barcode: v.barcode ?? '', color: v.color ?? '', colorHex: v.colorHex ?? '#000000', size: v.size ?? '', price: v.price, cost: v.cost ?? '', isActive: v.isActive, openingWarehouseId: '', openingQty: '' });
  };

  const save = useMutation({
    mutationFn: (v: V) => {
      const body: Record<string, unknown> = { sku: v.sku.trim(), barcode: v.barcode.trim() || (editing === 'new' ? undefined : null), color: v.color || null, colorHex: v.colorHex || null, size: v.size || null, price: num(v.price), cost: num(v.cost) ?? null, isActive: v.isActive };
      if (editing === 'new') {
        const wh = v.openingWarehouseId || warehouses.data?.[0]?.id;
        return api(`/products/${productId}/variants`, { method: 'POST', body: { ...body, color: v.color || undefined, colorHex: v.colorHex || undefined, size: v.size || undefined, cost: num(v.cost), initialStock: num(v.openingQty) && wh ? [{ warehouseId: wh, quantity: num(v.openingQty) }] : undefined } });
      }
      return api(`/products/variants/${(editing as Variant).id}`, { method: 'PATCH', body });
    },
    onSuccess: () => { toast.success(c('saved')); refresh(); setEditing(null); },
    onError: (e) => toast.error(e instanceof ApiError && e.code === 'UNIQUE_CONSTRAINT' ? t('skuTaken') : (e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/products/variants/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success(c('deleted')); refresh(); },
    onError: (e) => toast.error(e instanceof ApiError && e.code === 'HAS_STOCK' ? t('hasStock') : (e as Error).message),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('variants')}</CardTitle>
        {canWrite && <Button variant="outline" size="sm" onClick={() => open('new')}><Plus /> {t('addVariant')}</Button>}
      </CardHeader>
      <CardContent>
        <Table>
          <THead><TR><TH>{c('sku')}</TH><TH>{t('color')}</TH><TH>{t('size')}</TH><TH>{c('price')}</TH><TH>{c('stock')}</TH><TH /></TR></THead>
          <TBody>
            {variants.map((v) => {
              const total = v.stock.reduce((n, s) => n + s.quantity, 0);
              return (
                <TR key={v.id}>
                  <TD><div className="font-mono text-xs">{v.sku}</div>{v.barcode && <div className="text-xs text-muted-foreground">{v.barcode}</div>}{!v.isActive && <Badge variant="secondary">{c('inactive')}</Badge>}</TD>
                  <TD><span className="inline-flex items-center gap-2">{v.colorHex && <span className="size-3.5 rounded-full border" style={{ background: v.colorHex }} />}{v.color ?? '—'}</span></TD>
                  <TD>{v.size ?? '—'}</TD>
                  <TD>{f.money(v.price)}{v.cost != null && <div className="text-xs text-muted-foreground">{c('cost')}: {f.money(v.cost)}</div>}</TD>
                  <TD>
                    <Badge variant={total <= 0 ? 'danger' : 'success'}>{f.int(total)}</Badge>
                    {v.stock.length > 1 && <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">{v.stock.map((s) => <div key={s.warehouse.id}>{s.warehouse.code}: {s.quantity}</div>)}</div>}
                  </TD>
                  <TD className="text-end">
                    {canWrite && <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label={c('edit')} onClick={() => open(v)}><Pencil /></Button>
                      <Button variant="ghost" size="icon" aria-label={c('delete')} onClick={() => confirm(c('confirmDelete')) && remove.mutate(v.id)}><Trash2 className="text-destructive" /></Button>
                    </div>}
                  </TD>
                </TR>
              );
            })}
            {variants.length === 0 && <TR><TD colSpan={6} className="py-8 text-center text-muted-foreground">{c('empty')}</TD></TR>}
          </TBody>
        </Table>
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogTitle>{editing === 'new' ? t('addVariant') : t('editVariant')}</DialogTitle>
          <DialogDescription className="sr-only">{t('variants')}</DialogDescription>
          <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid grid-cols-2 gap-3" noValidate>
            <Field id="vsku" label={c('sku')} required error={errors.sku?.message}><Input id="vsku" {...register('sku', { required: c('required') })} /></Field>
            <Field id="vbc" label={t('barcode')}><Input id="vbc" {...register('barcode')} /></Field>
            <Field id="vcolor" label={t('color')}><Input id="vcolor" {...register('color')} /></Field>
            <Field id="vhex" label={t('colorHex')}><Input id="vhex" type="color" className="h-9 p-1" {...register('colorHex')} /></Field>
            <Field id="vsize" label={t('size')}><Input id="vsize" placeholder="52-18-145" {...register('size')} /></Field>
            <Field id="vprice" label={c('price')} required error={errors.price?.message}><Input id="vprice" type="number" step="0.01" {...register('price', { required: c('required') })} /></Field>
            <Field id="vcost" label={c('cost')}><Input id="vcost" type="number" step="0.01" {...register('cost')} /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" {...register('isActive')} /> {c('active')}</label>
            {editing === 'new' && (<>
              {(warehouses.data?.length ?? 0) > 1 && <Field id="vwh" label={t('openingWarehouse')}><NativeSelect id="vwh" {...register('openingWarehouseId')}>{warehouses.data!.map((w) => <option key={w.id} value={w.id}>{w.store.name} — {w.name}</option>)}</NativeSelect></Field>}
              <Field id="vqty" label={t('openingStock')}><Input id="vqty" type="number" min={0} {...register('openingQty')} /></Field>
            </>)}
            <Button type="submit" className="col-span-2" disabled={save.isPending}>{c('save')}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
