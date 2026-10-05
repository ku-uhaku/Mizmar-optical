'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateInventory } from '@/lib/query';
import { useWarehouseLabel, useWarehouses, type Warehouse } from '@/lib/warehouses';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { DataTable, type Column } from '@/components/data-table';
import { Field } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { VariantPicker, type PickedVariant } from './variant-picker';

export { useWarehouses };
const whLabel = (w: Warehouse) => `${w.store.name} — ${w.name}`;
const errText = (e: unknown, t: (k: string, v?: any) => string) => {
  if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') return t('insufficient', { available: (e.details as any)?.available ?? 0 });
  if (e instanceof ApiError && Array.isArray(e.details)) return (e.details as string[]).join(' · ');
  return (e as Error).message;
};

interface Line extends PickedVariant { qty: number }
function Lines({ lines, setLines, warehouseId, signed }: { lines: Line[]; setLines: (l: Line[]) => void; warehouseId?: string; signed?: boolean }) {
  const t = useTranslations('inventory');
  const c = useTranslations('common');
  const add = (v: PickedVariant) => lines.some((l) => l.id === v.id) ? toast.info(t('alreadyAdded')) : setLines([...lines, { ...v, qty: signed ? 1 : 1 }]);
  return (
    <div className="space-y-2">
      <VariantPicker warehouseId={warehouseId} onPick={add} />
      {lines.length > 0 && (
        <ul className="divide-y rounded-md border">
          {lines.map((l, i) => (
            <li key={l.id} className="flex items-center gap-3 p-2 text-sm">
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{l.label}</div><div className="font-mono text-xs text-muted-foreground">{l.sku}{l.stock != null && ` · ${t('onHand')}: ${l.stock}`}</div></div>
              <Input type="number" className="w-24" aria-label={c('quantity')} value={l.qty} min={signed ? undefined : 1} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
              <Button type="button" variant="ghost" size="icon" aria-label={c('remove')} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="text-destructive" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------- adjustments
const REASONS = ['DAMAGED', 'LOST', 'FOUND', 'EXPIRED', 'CORRECTION', 'OTHER'];

export function AdjustmentsTab() {
  const whName = useWarehouseLabel();
  const t = useTranslations('inventory');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const wh = useWarehouses();
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('CORRECTION');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const wid = warehouseId || wh.data?.[0]?.id || '';

  const create = useMutation({
    mutationFn: () => api('/inventory/adjustments', { method: 'POST', body: { warehouseId: wid, reason, note: note || undefined, lines: lines.map((l) => ({ variantId: l.id, quantityDelta: l.qty })) } }),
    onSuccess: () => { toast.success(c('saved')); invalidateInventory(qc); setOpen(false); setLines([]); setNote(''); },
    onError: (e) => toast.error(errText(e, t)),
  });

  const columns: Column<any>[] = [
    { header: t('number'), cell: (a) => <span className="font-mono text-xs">{a.number}</span> },
    { header: c('date'), cell: (a) => f.dateTime(a.createdAt) },
    { header: t('warehouse'), cell: (a) => whName(a.warehouse) },
    { header: c('reason'), cell: (a) => <Badge variant="secondary">{t(`reasons.${a.reason}`)}</Badge> },
    { header: t('lines'), cell: (a) => a._count.lines },
  ];
  return (
    <>
      <DataTable<any> queryKey="inv-adjustments" endpoint="/inventory/adjustments" columns={columns}
        toolbar={can('inventory:adjust') && <Button onClick={() => setOpen(true)}><Plus /> {t('newAdjustment')}</Button>} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>{t('newAdjustment')}</DialogTitle>
          <DialogDescription>{t('adjustmentHint')}</DialogDescription>
          <div className="grid grid-cols-2 gap-3">
            <Field id="adj-wh" label={t('warehouse')}><NativeSelect id="adj-wh" value={wid} onChange={(e) => { setWarehouseId(e.target.value); setLines([]); }}>{wh.data?.map((w) => <option key={w.id} value={w.id}>{whLabel(w)}</option>)}</NativeSelect></Field>
            <Field id="adj-reason" label={c('reason')}><NativeSelect id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{t(`reasons.${r}`)}</option>)}</NativeSelect></Field>
          </div>
          <Field id="adj-note" label={c('notes')}><Textarea id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <p className="text-xs text-muted-foreground">{t('deltaHint')}</p>
          <Lines lines={lines} setLines={setLines} warehouseId={wid} signed />
          <Button disabled={create.isPending || lines.length === 0 || lines.some((l) => !l.qty)} onClick={() => create.mutate()}>{c('save')}</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ----------------------------------------------------------------------------------------------- transfers
const TRANSFER_TONE: Record<string, 'secondary' | 'default' | 'success' | 'danger'> = { DRAFT: 'secondary', IN_TRANSIT: 'default', RECEIVED: 'success', CANCELLED: 'danger' };

export function TransfersTab() {
  const whName = useWarehouseLabel();
  const t = useTranslations('inventory');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const wh = useWarehouses();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [shipNow, setShipNow] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const fromId = from || wh.data?.[0]?.id || '';
  const toId = to || wh.data?.find((w) => w.id !== fromId)?.id || '';

  const refresh = () => invalidateInventory(qc);
  const create = useMutation({
    mutationFn: () => api('/inventory/transfers', { method: 'POST', body: { fromWarehouseId: fromId, toWarehouseId: toId, ship: shipNow, lines: lines.map((l) => ({ variantId: l.id, quantity: l.qty })) } }),
    onSuccess: () => { toast.success(c('saved')); refresh(); setOpen(false); setLines([]); },
    onError: (e) => toast.error(errText(e, t)),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'ship' | 'receive' | 'cancel' }) => api(`/inventory/transfers/${id}/${action}`, { method: 'POST', body: action === 'receive' ? {} : undefined }),
    onSuccess: () => { toast.success(c('saved')); refresh(); },
    onError: (e) => toast.error(errText(e, t)),
  });

  const columns: Column<any>[] = [
    { header: t('number'), cell: (x) => <span className="font-mono text-xs">{x.number}</span> },
    { header: c('date'), cell: (x) => f.dateTime(x.createdAt), className: 'hidden md:table-cell' },
    { header: `${c('from')} → ${c('to')}`, cell: (x) => <span>{whName(x.fromWarehouse)} → {whName(x.toWarehouse)}</span> },
    { header: c('status'), cell: (x) => <Badge variant={TRANSFER_TONE[x.status]}>{t(`transferStatus.${x.status}`)}</Badge> },
    { header: t('lines'), cell: (x) => x._count.lines, className: 'hidden sm:table-cell' },
    { header: '', className: 'text-end', cell: (x) => can('inventory:transfer') && (
      <div className="flex justify-end gap-1">
        {x.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: x.id, action: 'ship' })}>{t('ship')}</Button>}
        {x.status === 'IN_TRANSIT' && <Button size="sm" onClick={() => act.mutate({ id: x.id, action: 'receive' })}>{t('receive')}</Button>}
        {(x.status === 'DRAFT' || x.status === 'IN_TRANSIT') && <Button size="sm" variant="ghost" onClick={() => confirm(t('confirmCancel')) && act.mutate({ id: x.id, action: 'cancel' })}>{c('cancel')}</Button>}
      </div>
    ) },
  ];
  return (
    <>
      <DataTable<any> queryKey="inv-transfers" endpoint="/inventory/transfers" columns={columns} toolbar={can('inventory:transfer') && <Button onClick={() => setOpen(true)}><Plus /> {t('newTransfer')}</Button>} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>{t('newTransfer')}</DialogTitle>
          <DialogDescription>{t('transferHint')}</DialogDescription>
          <div className="grid grid-cols-2 gap-3">
            <Field id="tr-from" label={c('from')}><NativeSelect id="tr-from" value={fromId} onChange={(e) => { setFrom(e.target.value); setLines([]); }}>{wh.data?.map((w) => <option key={w.id} value={w.id}>{whLabel(w)}</option>)}</NativeSelect></Field>
            <Field id="tr-to" label={c('to')}><NativeSelect id="tr-to" value={toId} onChange={(e) => setTo(e.target.value)}>{wh.data?.filter((w) => w.id !== fromId).map((w) => <option key={w.id} value={w.id}>{whLabel(w)}</option>)}</NativeSelect></Field>
          </div>
          <Lines lines={lines} setLines={setLines} warehouseId={fromId} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={shipNow} onChange={(e) => setShipNow(e.target.checked)} /> {t('shipNow')}</label>
          <Button disabled={create.isPending || lines.length === 0 || !toId} onClick={() => create.mutate()}>{c('save')}</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ----------------------------------------------------------------------------------------------- counts
const COUNT_TYPES = ['', 'FRAME', 'SUNGLASSES', 'CONTACT_LENS', 'LENS', 'ACCESSORY'];

function CountDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('inventory');
  const c = useTranslations('common');
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['inv-count', id], queryFn: () => api<any>(`/inventory/counts/${id}`) });
  const [vals, setVals] = useState<Record<string, string>>({});
  const editable = data?.status === 'IN_PROGRESS' && can('inventory:count');
  const valueOf = (l: any) => (l.variantId in vals ? vals[l.variantId] : (l.countedQty ?? '').toString());
  const refresh = () => { invalidateInventory(qc); qc.invalidateQueries({ queryKey: ['inv-count', id] }); };
  const body = () => ({ lines: Object.entries(vals).map(([variantId, v]) => ({ variantId, countedQty: v === '' ? null : Number(v) })) });
  const save = useMutation({ mutationFn: async (complete: boolean) => {
    if (Object.keys(vals).length) await api(`/inventory/counts/${id}/lines`, { method: 'PUT', body: body() });
    if (complete) await api(`/inventory/counts/${id}/complete`, { method: 'POST' });
  }, onSuccess: (_r, complete) => { toast.success(complete ? t('countCompleted') : c('saved')); setVals({}); refresh(); if (complete) onClose(); }, onError: (e) => toast.error(errText(e, t)) });
  const cancel = useMutation({ mutationFn: () => api(`/inventory/counts/${id}/cancel`, { method: 'POST' }), onSuccess: () => { refresh(); onClose(); } });
  const counted = data?.lines.filter((l: any) => valueOf(l) !== '').length ?? 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogTitle>{data?.number}</DialogTitle>
        <DialogDescription>{t('countHint')}</DialogDescription>
        {data && (<>
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card"><tr className="border-b text-xs uppercase text-muted-foreground"><th className="p-2 text-start">{c('sku')}</th><th className="p-2 text-start">{c('name')}</th><th className="p-2 text-end">{t('expected')}</th><th className="p-2 text-end">{t('counted')}</th><th className="p-2 text-end">{t('difference')}</th></tr></thead>
              <tbody>
                {data.lines.map((l: any) => {
                  const v = valueOf(l);
                  const diff = v === '' ? null : Number(v) - l.expectedQty;
                  return (
                    <tr key={l.id} className="border-b">
                      <td className="p-2 font-mono text-xs">{l.variant.sku}</td>
                      <td className="p-2">{l.variant.product.name} <span className="text-xs text-muted-foreground">{l.variant.color}</span></td>
                      <td className="p-2 text-end">{l.expectedQty}</td>
                      <td className="p-2 text-end">{editable ? <Input type="number" min={0} className="ms-auto h-8 w-20 text-end" aria-label={`${t('counted')} ${l.variant.sku}`} value={v} onChange={(e) => setVals({ ...vals, [l.variantId]: e.target.value })} /> : (l.countedQty ?? '—')}</td>
                      <td className={`p-2 text-end font-medium ${diff ? (diff < 0 ? 'text-destructive' : 'text-emerald-600') : ''}`}>{diff == null ? '' : diff > 0 ? `+${diff}` : diff}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">{t('countProgress', { counted, total: data.lines.length })}</p>
          {editable && <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={save.isPending || !Object.keys(vals).length} onClick={() => save.mutate(false)}>{t('saveProgress')}</Button>
            <Button disabled={save.isPending} onClick={() => confirm(t('confirmComplete')) && save.mutate(true)}>{t('complete')}</Button>
            <Button variant="ghost" className="ms-auto" onClick={() => confirm(t('confirmCancel')) && cancel.mutate()}>{c('cancel')}</Button>
          </div>}
        </>)}
      </DialogContent>
    </Dialog>
  );
}

export function CountsTab() {
  const whName = useWarehouseLabel();
  const t = useTranslations('inventory');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const wh = useWarehouses();
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [productType, setProductType] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const wid = warehouseId || wh.data?.[0]?.id || '';
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/inventory/counts', { method: 'POST', body: { warehouseId: wid, productType: productType || undefined } }),
    onSuccess: (r) => { invalidateInventory(qc); setOpen(false); setDetail(r.id); },
    onError: (e) => toast.error(errText(e, t)),
  });
  const columns: Column<any>[] = [
    { header: t('number'), cell: (x) => <button className="font-mono text-xs underline" onClick={() => setDetail(x.id)}>{x.number}</button> },
    { header: c('date'), cell: (x) => f.dateTime(x.createdAt) },
    { header: t('warehouse'), cell: (x) => whName(x.warehouse) },
    { header: c('status'), cell: (x) => <Badge variant={x.status === 'COMPLETED' ? 'success' : x.status === 'CANCELLED' ? 'danger' : 'default'}>{t(`countStatus.${x.status}`)}</Badge> },
    { header: t('lines'), cell: (x) => x._count.lines },
  ];
  return (
    <>
      <DataTable<any> queryKey="inv-counts" endpoint="/inventory/counts" columns={columns} toolbar={can('inventory:count') && <Button onClick={() => setOpen(true)}><Plus /> {t('newCount')}</Button>} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{t('newCount')}</DialogTitle>
          <DialogDescription>{t('newCountHint')}</DialogDescription>
          <Field id="cnt-wh" label={t('warehouse')}><NativeSelect id="cnt-wh" value={wid} onChange={(e) => setWarehouseId(e.target.value)}>{wh.data?.map((w) => <option key={w.id} value={w.id}>{whLabel(w)}</option>)}</NativeSelect></Field>
          <Field id="cnt-type" label={c('type')}><NativeSelect id="cnt-type" value={productType} onChange={(e) => setProductType(e.target.value)}>{COUNT_TYPES.map((x) => <option key={x} value={x}>{x ? t(`types.${x}`) : c('all')}</option>)}</NativeSelect></Field>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>{t('startCount')}</Button>
        </DialogContent>
      </Dialog>
      {detail && <CountDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
