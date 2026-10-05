'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { dioptre, useFormat } from '@/lib/format';
import { Field } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { CustomerLite, LensInput } from './types';

interface Entry { id: string; name: string; refractiveIndex: number; price: number; leadTimeDays: number | null; sphMin: number | null; sphMax: number | null; cylMin: number | null; cylMax: number | null; addMin: number | null; addMax: number | null }
interface LensType { id: string; name: string; kind: string; requiresAdd: boolean; basePrice: number; treatments: { id: string; name: string; price: number }[]; entries: Entry[] }
interface Rx { id: string; issuedAt: string; isActive: boolean; isExpired: boolean; odSph: number | null; odCyl: number | null; odAdd: number | null; osSph: number | null; osCyl: number | null; osAdd: number | null; prescriberName: string | null }

const within = (v: number | null, min: number | null, max: number | null) => v == null || ((min == null || v >= min) && (max == null || v <= max));
const fitsRx = (e: Entry, rx?: Rx) => !rx || (['od', 'os'] as const).every((eye) => within(rx[`${eye}Sph`], e.sphMin, e.sphMax) && within(rx[`${eye}Cyl`], e.cylMin, e.cylMax) && within(rx[`${eye}Add`], e.addMin, e.addMax));

/** Choose lens type, a concrete lens, treatments and the prescription for a frame. Mirrors the server's rules to guide the cashier; the server still decides. */
export function LensDialog({ open, onClose, customer, initial, onSave }: { open: boolean; onClose: () => void; customer: CustomerLite | null; initial?: LensInput; onSave: (lens: LensInput, label: string) => void }) {
  const t = useTranslations('pos');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>{t('lens.title')}</DialogTitle>
        <DialogDescription>{customer ? `${customer.firstName} ${customer.lastName}` : t('lens.needCustomer')}</DialogDescription>
        {/* content unmounts when closed, so the form starts from `initial` on every open */}
        <LensForm customer={customer} initial={initial} onClose={onClose} onSave={onSave} />
      </DialogContent>
    </Dialog>
  );
}

function LensForm({ onClose, customer, initial, onSave }: { onClose: () => void; customer: CustomerLite | null; initial?: LensInput; onSave: (lens: LensInput, label: string) => void }) {
  const t = useTranslations('pos');
  const r = useTranslations('rx');
  const c = useTranslations('common');
  const f = useFormat();
  const [typeId, setTypeId] = useState(initial?.lensTypeId ?? '');
  const [entryId, setEntryId] = useState(initial?.lensEntryId ?? '');
  const [treatments, setTreatments] = useState<string[]>(initial?.treatmentIds ?? []);
  const [rxChoice, setRxChoice] = useState<string | undefined>(initial?.prescriptionId);
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const types = useQuery({ queryKey: ['pos-lens-options'], queryFn: () => api<LensType[]>('/pos/lens-options'), staleTime: 300_000 });
  const prescriptions = useQuery({ queryKey: ['rx', customer?.id], queryFn: () => api<Rx[]>(`/customers/${customer!.id}/prescriptions`), enabled: !!customer });
  const type = types.data?.find((x) => x.id === typeId);
  // until the cashier picks one, default to the customer's current (non-expired) prescription: derived, not stored
  const defaultRx = prescriptions.data?.find((p) => p.isActive && !p.isExpired) ?? prescriptions.data?.find((p) => !p.isExpired);
  const rxId = rxChoice ?? defaultRx?.id ?? '';
  const rx = prescriptions.data?.find((x) => x.id === rxId);

  const price = useMemo(() => {
    if (!type) return 0;
    const entry = type.entries.find((e) => e.id === entryId);
    return (entry ? entry.price : type.basePrice) + type.treatments.filter((x) => treatments.includes(x.id)).reduce((n, x) => n + x.price, 0);
  }, [type, entryId, treatments]);

  const problems: string[] = [];
  const plano = type?.kind === 'PLANO';
  if (type && !plano && !rxId) problems.push(t('lens.needRx'));
  if (rx?.isExpired) problems.push(t('lens.rxExpired'));
  if (type?.requiresAdd && rx && rx.odAdd == null && rx.osAdd == null) problems.push(t('lens.needAdd', { type: type.name }));
  const entry = type?.entries.find((e) => e.id === entryId);
  if (entry && !fitsRx(entry, rx)) problems.push(t('lens.outOfRange'));
  const valid = !!type && problems.length === 0;

  return (
        <div className="space-y-3">
          <Field id="lens-type" label={t('lens.type')}>
            <NativeSelect id="lens-type" value={typeId} onChange={(e) => { setTypeId(e.target.value); setEntryId(''); setTreatments([]); }}><option value="">—</option>{types.data?.map((x) => <option key={x.id} value={x.id}>{x.name} · {f.money(x.basePrice)}</option>)}</NativeSelect>
          </Field>
          {type && type.entries.length > 0 && (
            <Field id="lens-entry" label={t('lens.entry')} hint={t('lens.entryHint')}>
              <NativeSelect id="lens-entry" value={entryId} onChange={(e) => setEntryId(e.target.value)}>
                <option value="">{t('lens.standard')} · {f.money(type.basePrice)}</option>
                {type.entries.map((e) => <option key={e.id} value={e.id} disabled={!fitsRx(e, rx)}>{e.name} (n={e.refractiveIndex.toFixed(2)}) · {f.money(e.price)}{!fitsRx(e, rx) ? ` — ${t('lens.cannotMake')}` : ''}</option>)}
              </NativeSelect>
            </Field>
          )}
          {type && type.treatments.length > 0 && (
            <fieldset className="space-y-1.5"><legend className="text-sm font-medium">{t('lens.treatments')}</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">{type.treatments.map((x) => (
                <label key={x.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"><span className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={treatments.includes(x.id)} onChange={(e) => setTreatments(e.target.checked ? [...treatments, x.id] : treatments.filter((i) => i !== x.id))} />{x.name}</span><span className="text-muted-foreground">{f.money(x.price)}</span></label>
              ))}</div>
            </fieldset>
          )}
          {customer && (
            <Field id="lens-rx" label={r('title')}>
              <NativeSelect id="lens-rx" value={rxId} onChange={(e) => setRxChoice(e.target.value)}>
                <option value="">—</option>
                {prescriptions.data?.map((p) => <option key={p.id} value={p.id}>{f.date(p.issuedAt)} · OD {dioptre(p.odSph)} / OS {dioptre(p.osSph)}{p.isActive ? ` · ${r('current')}` : ''}{p.isExpired ? ` · ${r('expired')}` : ''}</option>)}
              </NativeSelect>
              {prescriptions.data?.length === 0 && <p className="mt-1 text-xs text-muted-foreground">{r('none')}</p>}
            </Field>
          )}
          <Field id="lens-notes" label={c('notes')}><Textarea id="lens-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {problems.length > 0 && <ul role="alert" className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{problems.map((p) => <li key={p} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />{p}</li>)}</ul>}
          <div className="flex items-center justify-between border-t pt-3"><span className="text-sm text-muted-foreground">{t('lens.addsToFrame')}</span><span className="text-lg font-semibold">+ {f.money(price)}</span></div>
          <div className="flex gap-2">
            {initial && <Button variant="ghost" onClick={() => { onSave(undefined as never, ''); onClose(); }}>{t('lens.remove')}</Button>}
            <Button className="flex-1" disabled={!valid || !customer} onClick={() => { onSave({ lensTypeId: typeId, lensEntryId: entryId || undefined, treatmentIds: treatments, prescriptionId: rxId || undefined, notes: notes || undefined }, [type!.name, entry?.name].filter(Boolean).join(' · ')); onClose(); }}>{c('save')}</Button>
          </div>
        </div>
  );
}
