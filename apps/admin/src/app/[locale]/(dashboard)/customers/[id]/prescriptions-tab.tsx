'use client';
import { useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { BadgeCheck, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiUpload, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dioptre, useFormat } from '@/lib/format';
import { Field } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface Rx { id: string; source: string; prescriberName: string | null; issuedAt: string; expiresAt: string | null; isActive: boolean; isExpired: boolean; verifiedAt: string | null; attachmentUrl: string | null; notes: string | null; pdTotal: number | null;
  odSph: number | null; odCyl: number | null; odAxis: number | null; odAdd: number | null; odPd: number | null; odPrism: number | null; odBase: string | null;
  osSph: number | null; osCyl: number | null; osAxis: number | null; osAdd: number | null; osPd: number | null; osPrism: number | null; osBase: string | null }

const EYE_FIELDS = ['Sph', 'Cyl', 'Axis', 'Add', 'Pd', 'Prism', 'Base'] as const;
const STEP: Record<string, string> = { Sph: '0.25', Cyl: '0.25', Axis: '1', Add: '0.25', Pd: '0.5', Prism: '0.25' };
const date = (d?: string | null) => (d ? d.slice(0, 10) : '');
const num = (v: unknown) => (v === '' || v == null || Number.isNaN(v) ? undefined : Number(v));

type FormValues = Record<string, any>;
const toForm = (r?: Rx): FormValues => ({
  source: r?.source ?? 'STORE', prescriberName: r?.prescriberName ?? '', issuedAt: date(r?.issuedAt) || new Date().toISOString().slice(0, 10), expiresAt: date(r?.expiresAt),
  pdTotal: r?.pdTotal ?? '', notes: r?.notes ?? '', attachmentUrl: r?.attachmentUrl ?? '', makeCurrent: true,
  ...Object.fromEntries(['od', 'os'].flatMap((e) => EYE_FIELDS.map((f) => [`${e}${f}`, (r as any)?.[`${e}${f}`] ?? '']))),
});

function RxDialog({ customerId, rx, onClose }: { customerId: string; rx?: Rx; onClose: () => void }) {
  const t = useTranslations('rx');
  const c = useTranslations('common');
  const qc = useQueryClient();
  const [problems, setProblems] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const { register, handleSubmit, setValue, control } = useForm<FormValues>({ defaultValues: toForm(rx) });
  const attachment = useWatch({ control, name: 'attachmentUrl' });

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body: Record<string, unknown> = { source: v.source, prescriberName: v.prescriberName || undefined, issuedAt: v.issuedAt, expiresAt: v.expiresAt || undefined, pdTotal: num(v.pdTotal), notes: v.notes || undefined, attachmentUrl: v.attachmentUrl || undefined };
      for (const e of ['od', 'os']) for (const f of EYE_FIELDS) { const k = `${e}${f}`; body[k] = f === 'Base' ? (v[k] || undefined) : num(v[k]); }
      if (!rx) body.makeCurrent = v.makeCurrent;
      return rx ? api(`/prescriptions/${rx.id}`, { method: 'PATCH', body }) : api(`/customers/${customerId}/prescriptions`, { method: 'POST', body });
    },
    onSuccess: () => { toast.success(c('saved')); qc.invalidateQueries({ queryKey: ['customer', customerId] }); qc.invalidateQueries({ queryKey: ['rx', customerId] }); onClose(); },
    onError: (e) => {
      if (e instanceof ApiError && Array.isArray(e.details)) setProblems(e.details as string[]);
      else toast.error((e as Error).message);
    },
  });
  const upload = useMutation({
    mutationFn: (f: File) => apiUpload<{ url: string }>('/media', f, { folder: 'prescriptions' }),
    onSuccess: (m) => setValue('attachmentUrl', m.url), onError: (e) => toast.error((e as Error).message),
  });

  const eye = (e: 'od' | 'os') => (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-semibold">{e === 'od' ? t('od') : t('os')}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        {EYE_FIELDS.map((f) => f === 'Base' ? (
          <Field key={f} id={`${e}${f}`} label={t('base')}><NativeSelect id={`${e}${f}`} {...register(`${e}${f}`)}><option value="">—</option>{['UP', 'DOWN', 'IN', 'OUT'].map((b) => <option key={b} value={b}>{b}</option>)}</NativeSelect></Field>
        ) : (
          <Field key={f} id={`${e}${f}`} label={t(f.toLowerCase())}><Input id={`${e}${f}`} type="number" step={STEP[f]} dir="ltr" {...register(`${e}${f}`)} /></Field>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogTitle>{rx ? t('edit') : t('new')}</DialogTitle>
        <DialogDescription>{t('hint')}</DialogDescription>
        <form onSubmit={handleSubmit((v) => { setProblems([]); save.mutate(v); })} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field id="rx-issued" label={t('issuedAt')} required><Input id="rx-issued" type="date" {...register('issuedAt', { required: true })} /></Field>
            <Field id="rx-exp" label={t('expiresAt')}><Input id="rx-exp" type="date" {...register('expiresAt')} /></Field>
            <Field id="rx-by" label={t('prescriber')} className="sm:col-span-2"><Input id="rx-by" {...register('prescriberName')} /></Field>
          </div>
          {eye('od')}{eye('os')}
          <div className="grid gap-3 sm:grid-cols-4">
            <Field id="rx-pd" label={t('pdTotal')} hint="mm"><Input id="rx-pd" type="number" step="0.5" dir="ltr" {...register('pdTotal')} /></Field>
            <Field id="rx-src" label={t('source')}><NativeSelect id="rx-src" {...register('source')}>{['STORE', 'EXTERNAL', 'UPLOAD', 'SELF'].map((s) => <option key={s} value={s}>{t(`sources.${s}`)}</option>)}</NativeSelect></Field>
            <div className="sm:col-span-2">
              <Field id="rx-file" label={t('attachment')}>
                <div className="flex items-center gap-2">
                  <input ref={file} id="rx-file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(f); }} />
                  <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => file.current?.click()}><Paperclip /> {t('upload')}</Button>
                  {attachment && <a href={attachment} target="_blank" rel="noreferrer" className="truncate text-sm underline">{t('viewAttachment')}</a>}
                </div>
              </Field>
            </div>
          </div>
          <Field id="rx-notes" label={c('notes')}><Textarea id="rx-notes" {...register('notes')} /></Field>
          {!rx && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" {...register('makeCurrent')} /> {t('makeCurrent')}</label>}
          {problems.length > 0 && <ul role="alert" className="list-disc space-y-0.5 rounded-md border border-destructive/40 bg-destructive/10 p-3 ps-8 text-sm text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <Button type="submit" disabled={save.isPending}>{c('save')}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RxCard({ rx, customerId }: { rx: Rx; customerId: string }) {
  const t = useTranslations('rx');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['rx', customerId] }); qc.invalidateQueries({ queryKey: ['customer', customerId] }); };
  const verify = useMutation({ mutationFn: () => api(`/prescriptions/${rx.id}/verify`, { method: 'POST' }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api(`/prescriptions/${rx.id}`, { method: 'DELETE' }), onSuccess: () => { toast.success(c('deleted')); refresh(); } });
  const rows = [['od', t('od')], ['os', t('os')]] as const;
  return (
    <Card className={rx.isActive ? 'border-primary/50' : ''}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{f.date(rx.issuedAt)}</span>
          {rx.prescriberName && <span className="text-sm text-muted-foreground">{rx.prescriberName}</span>}
          {rx.isActive && <Badge>{t('current')}</Badge>}
          {rx.isExpired && <Badge variant="danger">{t('expired')}</Badge>}
          {rx.verifiedAt && <Badge variant="success"><BadgeCheck className="me-1 size-3" />{t('verified')}</Badge>}
          <Badge variant="secondary">{t(`sources.${rx.source}`)}</Badge>
          <div className="ms-auto flex gap-1">
            {rx.attachmentUrl && <Button asChild variant="ghost" size="icon" aria-label={t('viewAttachment')}><a href={rx.attachmentUrl} target="_blank" rel="noreferrer"><Paperclip /></a></Button>}
            {can('prescriptions:update') && !rx.verifiedAt && <Button variant="outline" size="sm" onClick={() => verify.mutate()}>{t('verify')}</Button>}
            {can('prescriptions:update') && <Button variant="ghost" size="icon" aria-label={c('edit')} onClick={() => setEditing(true)}><Pencil /></Button>}
            {can('prescriptions:delete') && <Button variant="ghost" size="icon" aria-label={c('delete')} onClick={() => confirm(c('confirmDelete')) && remove.mutate()}><Trash2 className="text-destructive" /></Button>}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-center text-sm" dir="ltr">
            <thead><tr className="text-xs uppercase text-muted-foreground"><th className="p-1 text-start" /><th>SPH</th><th>CYL</th><th>AXIS</th><th>ADD</th><th>PD</th><th>PRISM</th></tr></thead>
            <tbody>
              {rows.map(([e, label]) => (
                <tr key={e} className="border-t">
                  <th className="p-1.5 text-start font-medium" dir="auto">{label}</th>
                  <td>{dioptre((rx as any)[`${e}Sph`])}</td><td>{dioptre((rx as any)[`${e}Cyl`])}</td><td>{(rx as any)[`${e}Axis`] ?? '—'}{(rx as any)[`${e}Axis`] != null && '°'}</td>
                  <td>{dioptre((rx as any)[`${e}Add`])}</td><td>{(rx as any)[`${e}Pd`] ?? '—'}</td><td>{(rx as any)[`${e}Prism`] != null ? `${(rx as any)[`${e}Prism`]} ${(rx as any)[`${e}Base`] ?? ''}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{[rx.pdTotal != null && `${t('pdTotal')}: ${rx.pdTotal} mm`, rx.expiresAt && `${t('expiresAt')}: ${f.date(rx.expiresAt)}`, rx.notes].filter(Boolean).join(' · ')}</p>
      </CardContent>
      {editing && <RxDialog customerId={customerId} rx={rx} onClose={() => setEditing(false)} />}
    </Card>
  );
}

export function PrescriptionsTab({ customerId }: { customerId: string }) {
  const t = useTranslations('rx');
  const c = useTranslations('common');
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const { data } = useQuery({ queryKey: ['rx', customerId], queryFn: () => api<Rx[]>(`/customers/${customerId}/prescriptions`), enabled: can('prescriptions:read') });
  if (!can('prescriptions:read')) return <p className="py-8 text-center text-muted-foreground">{c('forbidden')}</p>;
  return (
    <div className="space-y-3">
      {can('prescriptions:create') && <div className="flex justify-end"><Button onClick={() => setCreating(true)}><Plus /> {t('new')}</Button></div>}
      {data?.length === 0 && <p className="py-8 text-center text-muted-foreground">{t('none')}</p>}
      {data?.map((r) => <RxCard key={r.id} rx={r} customerId={customerId} />)}
      {creating && <RxDialog customerId={customerId} onClose={() => setCreating(false)} />}
    </div>
  );
}
