'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/client-api';
import { errorText } from '@/lib/errors';
import { useFormat } from '@/lib/format';
import { notify } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { dioptre, PrescriptionForm, type Rx } from '@/components/shop/prescription-form';

export default function PrescriptionsPage() {
  const t = useTranslations('account');
  const x = useTranslations('rx');
  const c = useTranslations('common');
  const f = useFormat();
  const [rows, setRows] = useState<Rx[] | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { let alive = true; api<Rx[]>('/account/prescriptions').then((r) => alive && setRows(r)).catch(() => alive && setRows([])); return () => { alive = false; }; }, []);
  const remove = async (id: string) => {
    if (!confirm(t('confirmDelete'))) return;
    try { await api(`/account/prescriptions/${id}`, { method: 'DELETE' }); setRows((r) => (r ?? []).filter((y) => y.id !== id)); }
    catch (e) { notify(errorText(e, (k, v) => c(k, v as never)), 'error'); }
  };
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">{t('nav.prescriptions')}</h1>{!adding && <Button onClick={() => setAdding(true)}>{t('addPrescription')}</Button>}</div>
      {adding && <div className="rounded-lg border bg-card p-5"><PrescriptionForm onSaved={(r) => { setRows([r, ...(rows ?? [])]); setAdding(false); notify(c('saved')); }} /></div>}
      {rows === null ? <p className="text-muted-foreground">…</p> : rows.length === 0 && !adding ? <p className="rounded-lg border bg-card p-8 text-center text-muted-foreground">{t('noPrescriptions')}</p> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border bg-card p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-medium">{f.date(r.issuedAt)}{r.prescriberName ? ` · ${r.prescriberName}` : ''}</p>
                  <p className="text-xs text-muted-foreground">{r.verifiedAt ? <span className="text-emerald-600 dark:text-emerald-400">{x('verified')}</span> : x('notVerified')}{r.attachmentUrl && <> · <a href={r.attachmentUrl} target="_blank" rel="noreferrer noopener" className="underline">{x('viewScan')}</a></>}</p></div>
                {!r.verifiedAt && <Button variant="ghost" size="icon" aria-label={c('remove')} onClick={() => remove(r.id)}><Trash2 className="size-4 text-destructive" /></Button>}
              </div>
              {r.odSph != null || r.osSph != null ? (
                <table className="mt-3 w-full text-center" dir="ltr"><thead><tr className="text-xs text-muted-foreground"><th /><th>SPH</th><th>CYL</th><th>AXIS</th><th>ADD</th><th>PD</th></tr></thead>
                  <tbody>{(['od', 'os'] as const).map((e) => <tr key={e}><th scope="row" className="text-start">{x(`eye.${e}`)}</th><td>{dioptre(r[`${e}Sph`])}</td><td>{dioptre(r[`${e}Cyl`])}</td><td>{r[`${e}Axis`] ?? '—'}</td><td>{dioptre(r[`${e}Add`])}</td><td>{r[`${e}Pd`] ?? '—'}</td></tr>)}</tbody></table>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
