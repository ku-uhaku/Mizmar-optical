'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiError, api } from '@/lib/client-api';
import { errorText } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

export interface Rx {
  id: string; source: string; issuedAt: string; prescriberName: string | null; attachmentUrl: string | null; verifiedAt: string | null;
  odSph: number | null; odCyl: number | null; odAxis: number | null; odAdd: number | null; odPd: number | null; osSph: number | null; osCyl: number | null; osAxis: number | null; osAdd: number | null; osPd: number | null; pdTotal: number | null;
}
export const dioptre = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}`);

const FIELDS = [['Sph', 'sph', '0.25'], ['Cyl', 'cyl', '0.25'], ['Axis', 'axis', '1'], ['Add', 'add', '0.25'], ['Pd', 'pd', '0.5']] as const;

/** Type your prescription, or upload a photo/scan of it. Saved to the signed-in customer's account. */
export function PrescriptionForm({ onSaved }: { onSaved: (rx: Rx) => void }) {
  const t = useTranslations('rx');
  const c = useTranslations('common');
  const [mode, setMode] = useState<'type' | 'upload'>('type');
  const [v, setV] = useState<Record<string, string>>({});
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = { issuedAt };
      if (mode === 'upload') {
        if (!file) throw new ApiError(400, 'PRESCRIPTION_EMPTY', '');
        const fd = new FormData(); fd.append('file', file);
        body.attachmentUrl = (await api<{ url: string }>('/account/prescriptions/upload', { method: 'POST', formData: fd })).url;
      } else {
        for (const [k, val] of Object.entries(v)) if (val.trim() !== '') body[k] = Number(val);
        if (v.prescriberName?.trim()) body.prescriberName = v.prescriberName.trim();
      }
      onSaved(await api<Rx>('/account/prescriptions', { method: 'POST', body }));
    } catch (err) { setError(errorText(err, (k, x) => (k.startsWith('errors.') ? c(k, x as never) : k))); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div role="tablist" className="flex gap-1 border-b">
        {(['type', 'upload'] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${mode === m ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>{t(`mode.${m}`)}</button>)}
      </div>
      {mode === 'type' ? (
        <>
          <div className="overflow-x-auto" dir="ltr">
            <table className="w-full min-w-[26rem] text-sm">
              <thead><tr><th className="w-12" />{FIELDS.map(([l]) => <th key={l} className="px-1 pb-1 text-center font-medium">{l.toUpperCase()}</th>)}</tr></thead>
              <tbody>
                {(['od', 'os'] as const).map((eye) => (
                  <tr key={eye}>
                    <th scope="row" className="pe-2 text-start font-medium">{t(`eye.${eye}`)}</th>
                    {FIELDS.map(([l, f, step]) => <td key={f} className="p-1"><Input type="number" step={step} inputMode="decimal" aria-label={`${t(`eye.${eye}`)} ${l.toUpperCase()}`} value={v[`${eye}${l}`] ?? ''} onChange={(e) => setV({ ...v, [`${eye}${l}`]: e.target.value })} className="h-9 px-2 text-center" /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="rx-pd" label={t('pdTotal')}><Input id="rx-pd" type="number" step="0.5" value={v.pdTotal ?? ''} onChange={(e) => setV({ ...v, pdTotal: e.target.value })} /></Field>
            <Field id="rx-date" label={t('issuedAt')}><Input id="rx-date" type="date" value={issuedAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setIssuedAt(e.target.value)} /></Field>
            <Field id="rx-by" label={t('prescriber')}><Input id="rx-by" value={v.prescriberName ?? ''} onChange={(e) => setV({ ...v, prescriberName: e.target.value })} /></Field>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <Field id="rx-file" label={t('file')} hint={t('fileHint')}><Input id="rx-file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-auto py-2" /></Field>
          <Field id="rx-date2" label={t('issuedAt')}><Input id="rx-date2" type="date" value={issuedAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setIssuedAt(e.target.value)} /></Field>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('verifyNote')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>{t('save')}</Button>
    </form>
  );
}
