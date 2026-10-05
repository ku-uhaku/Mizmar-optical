'use client';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { tr, type LensOption, type ShopVariant } from '@/lib/api';
import { api } from '@/lib/client-api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';
import { useFormat } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { dioptre, PrescriptionForm, type Rx } from './prescription-form';

export interface LensChoice { lensTypeId: string; lensEntryId?: string; treatmentIds: string[]; prescriptionId: string; summary: string }
interface Quote { total: number; lines: { lineTotal: number; lens: { lensTypeName: string; lensEntryName: string | null; treatments: string[]; lensPrice: number; treatmentsPrice: number } | null }[] }

/** Guided lens choice: type, lens, treatments, prescription. The price shown comes from the server's cart quote, never from this form. */
export function LensConfigurator({ variant, options, onConfirm, onCancel }: { variant: ShopVariant; options: LensOption[]; onConfirm: (c: LensChoice) => void; onCancel: () => void }) {
  const t = useTranslations('lens');
  const c = useTranslations('common');
  const locale = useLocale();
  const f = useFormat();
  const { user, ready } = useAuth();
  const [typeId, setTypeId] = useState('');
  const [entryId, setEntryId] = useState('');
  const [treatments, setTreatments] = useState<string[]>([]);
  const [rxId, setRxId] = useState('');
  const [rxs, setRxs] = useState<Rx[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);

  const type = options.find((o) => o.id === typeId);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    api<Rx[]>('/account/prescriptions').then((r) => alive && setRxs(r)).catch(() => alive && setRxs([]));
    return () => { alive = false; };
  }, [user]);

  const ready2 = !!type && !!rxId;
  useEffect(() => {
    if (!ready2) return;
    let alive = true;
    api<Quote>('/public/cart/quote', { method: 'POST', body: { lines: [{ variantId: variant.id, quantity: 1, lens: { lensTypeId: typeId, lensEntryId: entryId || undefined, treatmentIds: treatments, prescriptionId: rxId } }] } })
      .then((q) => { if (alive) { setQuote(q); setError(null); } })
      .catch((e) => { if (alive) { setQuote(null); setError(errorText(e, (k, x) => c(k, x as never))); } });
    return () => { alive = false; };
  }, [ready2, variant.id, typeId, entryId, treatments, rxId, c]);

  const pick = (id: string) => { setTypeId(id); setEntryId(''); setTreatments([]); setQuote(null); setError(null); };
  const summary = useMemo(() => {
    const l = quote?.lines[0]?.lens;
    return l ? [l.lensEntryName ?? l.lensTypeName, ...l.treatments].join(' · ') : type?.name ?? '';
  }, [quote, type]);

  return (
    <section aria-label={t('title')} className="space-y-6 rounded-lg border bg-card p-5">
      <header className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{t('title')}</h2><p className="text-sm text-muted-foreground">{t('subtitle')}</p></div><Button variant="ghost" size="sm" onClick={onCancel}>{c('cancel')}</Button></header>

      <fieldset className="space-y-2"><legend className="font-medium">1. {t('type')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <label key={o.id} className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 text-sm ${typeId === o.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
              <span className="flex items-center gap-2"><input type="radio" name="lens-type" value={o.id} checked={typeId === o.id} onChange={() => pick(o.id)} className="accent-[var(--primary)]" /><span className="font-medium">{tr(o, 'name', locale)}</span><span className="ms-auto">{o.basePrice > 0 ? `+ ${f.money(o.basePrice)}` : t('included')}</span></span>
              {o.description && <span className="ps-6 text-xs text-muted-foreground">{tr(o, 'description' as never, locale) ?? o.description}</span>}
            </label>
          ))}
        </div>
      </fieldset>

      {type && type.entries.length > 0 && (
        <fieldset className="space-y-2"><legend className="font-medium">2. {t('index')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${entryId === '' ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}><input type="radio" name="lens-entry" checked={entryId === ''} onChange={() => setEntryId('')} className="accent-[var(--primary)]" />{t('standard')}</label>
            {type.entries.map((e) => (
              <label key={e.id} className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${entryId === e.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
                <input type="radio" name="lens-entry" checked={entryId === e.id} onChange={() => setEntryId(e.id)} className="accent-[var(--primary)]" />
                <span>{e.name}<span className="block text-xs text-muted-foreground">{t('indexValue', { n: e.refractiveIndex })}{e.leadTimeDays ? ` · ${t('leadTime', { days: e.leadTimeDays })}` : ''}</span></span>
                <span className="ms-auto">{f.money(e.price)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {type && type.treatments.length > 0 && (
        <fieldset className="space-y-2"><legend className="font-medium">{type.entries.length ? '3' : '2'}. {t('treatments')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {type.treatments.map((x) => (
              <label key={x.id} className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${treatments.includes(x.id) ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
                <input type="checkbox" checked={treatments.includes(x.id)} onChange={(e) => setTreatments(e.target.checked ? [...treatments, x.id] : treatments.filter((i) => i !== x.id))} className="accent-[var(--primary)]" />
                <span>{tr(x, 'name', locale)}</span><span className="ms-auto">+ {f.money(x.price)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {type && (
        <fieldset className="space-y-3"><legend className="font-medium">{t('prescription')}</legend>
          {!ready ? null : !user ? (
            <p className="rounded-md bg-muted p-3 text-sm">{t('signInNeeded')} <Link href={'/compte/connexion?next=/panier' as '/'} className="font-medium underline">{t('signIn')}</Link></p>
          ) : (
            <>
              {rxs && rxs.length > 0 && (
                <ul className="space-y-2">
                  {rxs.map((r) => (
                    <li key={r.id}>
                      <label className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 text-sm ${rxId === r.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
                        <span className="flex items-center gap-2"><input type="radio" name="rx" checked={rxId === r.id} onChange={() => setRxId(r.id)} className="accent-[var(--primary)]" /><span className="font-medium">{f.date(r.issuedAt)}</span>{r.verifiedAt && <span className="rounded bg-emerald-500/15 px-1.5 text-xs text-emerald-700 dark:text-emerald-300">{t('verified')}</span>}</span>
                        <span className="ps-6 text-xs text-muted-foreground" dir="ltr">{r.attachmentUrl && r.odSph == null ? t('scan') : `OD ${dioptre(r.odSph)} ${dioptre(r.odCyl)} ${r.odAxis ?? ''} · OS ${dioptre(r.osSph)} ${dioptre(r.osCyl)} ${r.osAxis ?? ''}`}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {adding ? <PrescriptionForm onSaved={(r) => { setRxs([r, ...(rxs ?? [])]); setRxId(r.id); setAdding(false); }} /> : <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>{t('addPrescription')}</Button>}
            </>
          )}
        </fieldset>
      )}

      {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="text-sm"><span className="text-muted-foreground">{t('totalWithLenses')}: </span><b className="text-lg" data-testid="lens-total">{quote ? f.money(quote.total) : '—'}</b></div>
        <Button disabled={!quote} onClick={() => onConfirm({ lensTypeId: typeId, lensEntryId: entryId || undefined, treatmentIds: treatments, prescriptionId: rxId, summary })}>{t('addToCart')}</Button>
      </footer>
    </section>
  );
}
