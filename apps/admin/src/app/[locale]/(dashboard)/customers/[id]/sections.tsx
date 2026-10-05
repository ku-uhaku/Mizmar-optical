'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { Field } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const num = (v: unknown) => (v === '' || v == null || Number.isNaN(v) ? undefined : Number(v));
const useRefresh = (id: string) => { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: ['customer', id] }); };
const errMsg = (e: unknown) => (e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]).join(' · ') : (e as Error).message);

// ----------------------------------------------------------------------------------------------- addresses
export function AddressesTab({ customerId, addresses }: { customerId: string; addresses: any[] }) {
  const t = useTranslations('customers');
  const c = useTranslations('common');
  const { can } = useAuth();
  const refresh = useRefresh(customerId);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<any>();
  const open = (a: any | 'new') => { setEditing(a); reset(a === 'new' ? { label: '', recipient: '', phone: '', line1: '', line2: '', city: '', region: '', postalCode: '', country: 'MA', isDefaultShipping: false, isDefaultBilling: false } : { ...a, line2: a.line2 ?? '', label: a.label ?? '', recipient: a.recipient ?? '', phone: a.phone ?? '', region: a.region ?? '', postalCode: a.postalCode ?? '' }); };
  const save = useMutation({
    mutationFn: (v: any) => {
      const body = { label: v.label || undefined, recipient: v.recipient || undefined, phone: v.phone || undefined, line1: v.line1, line2: v.line2 || undefined, city: v.city, region: v.region || undefined, postalCode: v.postalCode || undefined, country: v.country || 'MA', isDefaultShipping: !!v.isDefaultShipping, isDefaultBilling: !!v.isDefaultBilling };
      return editing === 'new' ? api(`/customers/${customerId}/addresses`, { method: 'POST', body }) : api(`/customers/addresses/${editing.id}`, { method: 'PATCH', body });
    },
    onSuccess: () => { toast.success(c('saved')); refresh(); setEditing(null); }, onError: (e) => toast.error(errMsg(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/customers/addresses/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const canWrite = can('customers:update');
  return (
    <div className="space-y-3">
      {canWrite && <div className="flex justify-end"><Button onClick={() => open('new')}><Plus /> {t('addAddress')}</Button></div>}
      {addresses.length === 0 && <p className="py-8 text-center text-muted-foreground">{c('empty')}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {addresses.map((a) => (
          <Card key={a.id}><CardContent className="space-y-1 p-4 text-sm">
            <div className="flex items-center gap-2"><span className="font-medium">{a.label || a.recipient || a.city}</span>{a.isDefaultShipping && <Badge>{t('defaultShipping')}</Badge>}{a.isDefaultBilling && <Badge variant="secondary">{t('defaultBilling')}</Badge>}
              {canWrite && <span className="ms-auto flex"><Button variant="ghost" size="icon" aria-label={c('edit')} onClick={() => open(a)}><Pencil /></Button><Button variant="ghost" size="icon" aria-label={c('delete')} onClick={() => confirm(c('confirmDelete')) && remove.mutate(a.id)}><Trash2 className="text-destructive" /></Button></span>}</div>
            <p className="text-muted-foreground">{[a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(' '), a.region, a.country].filter(Boolean).join(', ')}</p>
            {a.phone && <p dir="ltr" className="text-start">{a.phone}</p>}
          </CardContent></Card>
        ))}
      </div>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogTitle>{t('addAddress')}</DialogTitle><DialogDescription className="sr-only">{t('addAddress')}</DialogDescription>
          <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid grid-cols-2 gap-3" noValidate>
            <Field id="a-label" label={t('addressLabel')}><Input id="a-label" {...register('label')} /></Field>
            <Field id="a-rec" label={t('recipient')}><Input id="a-rec" {...register('recipient')} /></Field>
            <Field id="a-l1" label={t('line1')} required error={errors.line1?.message as string} className="col-span-2"><Input id="a-l1" {...register('line1', { required: c('required') })} /></Field>
            <Field id="a-l2" label={t('line2')} className="col-span-2"><Input id="a-l2" {...register('line2')} /></Field>
            <Field id="a-city" label={t('city')} required error={errors.city?.message as string}><Input id="a-city" {...register('city', { required: c('required') })} /></Field>
            <Field id="a-zip" label={t('postalCode')}><Input id="a-zip" {...register('postalCode')} /></Field>
            <Field id="a-reg" label={t('region')}><Input id="a-reg" {...register('region')} /></Field>
            <Field id="a-ph" label={t('phone')}><Input id="a-ph" type="tel" {...register('phone')} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" {...register('isDefaultShipping')} /> {t('defaultShipping')}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" {...register('isDefaultBilling')} /> {t('defaultBilling')}</label>
            <Button type="submit" className="col-span-2" disabled={save.isPending}>{c('save')}</Button>
          </form></DialogContent>
      </Dialog>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------- notes
export function NotesTab({ customerId, notes }: { customerId: string; notes: any[] }) {
  const t = useTranslations('customers');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const refresh = useRefresh(customerId);
  const [body, setBody] = useState('');
  const [pin, setPin] = useState(false);
  const add = useMutation({ mutationFn: () => api(`/customers/${customerId}/notes`, { method: 'POST', body: { body: body.trim(), isPinned: pin } }), onSuccess: () => { setBody(''); setPin(false); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const toggle = useMutation({ mutationFn: (n: any) => api(`/customers/notes/${n.id}`, { method: 'PATCH', body: { isPinned: !n.isPinned } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/customers/notes/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const canWrite = can('customers:update');
  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="space-y-2">
          <Textarea aria-label={t('newNote')} placeholder={t('newNote')} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={pin} onChange={(e) => setPin(e.target.checked)} /> {t('pin')}</label><Button className="ms-auto" disabled={!body.trim() || add.isPending} onClick={() => add.mutate()}>{t('addNote')}</Button></div>
        </div>
      )}
      {notes.length === 0 && <p className="py-6 text-center text-muted-foreground">{c('empty')}</p>}
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className={`rounded-md border p-3 text-sm ${n.isPinned ? 'border-amber-500/50 bg-amber-500/5' : ''}`}>
            <p className="whitespace-pre-wrap">{n.body}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">{n.isPinned && <Pin className="size-3 text-amber-600" />}{n.author ? `${n.author.firstName} ${n.author.lastName}` : '—'} · {f.dateTime(n.createdAt)}
              {canWrite && <span className="ms-auto flex"><Button variant="ghost" size="icon" className="size-7" aria-label={t('pin')} onClick={() => toggle.mutate(n)}><Pin /></Button><Button variant="ghost" size="icon" className="size-7" aria-label={c('delete')} onClick={() => confirm(c('confirmDelete')) && remove.mutate(n.id)}><Trash2 className="text-destructive" /></Button></span>}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------- insurance
export function InsuranceTab({ customerId, insurances }: { customerId: string; insurances: any[] }) {
  const t = useTranslations('customers');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const refresh = useRefresh(customerId);
  const [open, setOpen] = useState(false);
  const providers = useQuery({ queryKey: ['options', '/insurance-providers'], queryFn: () => api<Paginated<{ id: string; name: string }>>('/insurance-providers', { query: { limit: 100 } }), enabled: open, staleTime: 60_000 });
  const { register, handleSubmit, reset } = useForm<any>();
  const save = useMutation({
    mutationFn: (v: any) => api(`/customers/${customerId}/insurances`, { method: 'POST', body: { providerId: v.providerId, policyNumber: v.policyNumber || undefined, memberId: v.memberId || undefined, coveragePct: num(v.coveragePct), validFrom: v.validFrom || undefined, validTo: v.validTo || undefined } }),
    onSuccess: () => { toast.success(c('saved')); refresh(); reset(); setOpen(false); }, onError: (e) => toast.error(errMsg(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/customers/insurances/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const canWrite = can('customers:update');
  return (
    <div className="space-y-3">
      {canWrite && <div className="flex justify-end"><Button onClick={() => setOpen(true)}><Plus /> {t('addInsurance')}</Button></div>}
      {insurances.length === 0 && <p className="py-8 text-center text-muted-foreground">{c('empty')}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {insurances.map((i) => (
          <Card key={i.id}><CardContent className="space-y-1 p-4 text-sm">
            <div className="flex items-center gap-2"><span className="font-medium">{i.provider.name}</span>{i.coveragePct != null && <Badge>{i.coveragePct}%</Badge>}{canWrite && <Button variant="ghost" size="icon" className="ms-auto" aria-label={c('delete')} onClick={() => confirm(c('confirmDelete')) && remove.mutate(i.id)}><Trash2 className="text-destructive" /></Button>}</div>
            <p className="text-muted-foreground">{[i.memberId && `${t('memberId')}: ${i.memberId}`, i.policyNumber && `${t('policyNumber')}: ${i.policyNumber}`].filter(Boolean).join(' · ')}</p>
            {(i.validFrom || i.validTo) && <p className="text-xs text-muted-foreground">{f.date(i.validFrom)} → {f.date(i.validTo)}</p>}
          </CardContent></Card>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent><DialogTitle>{t('addInsurance')}</DialogTitle><DialogDescription className="sr-only">{t('addInsurance')}</DialogDescription>
          <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid grid-cols-2 gap-3" noValidate>
            <Field id="i-prov" label={t('provider')} required className="col-span-2"><NativeSelect id="i-prov" {...register('providerId', { required: true })}><option value="">—</option>{providers.data?.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
            <Field id="i-mem" label={t('memberId')}><Input id="i-mem" {...register('memberId')} /></Field>
            <Field id="i-pol" label={t('policyNumber')}><Input id="i-pol" {...register('policyNumber')} /></Field>
            <Field id="i-cov" label={t('coverage')} hint="%"><Input id="i-cov" type="number" step="0.5" min={0} max={100} {...register('coveragePct')} /></Field>
            <div />
            <Field id="i-from" label={t('validFrom')}><Input id="i-from" type="date" {...register('validFrom')} /></Field>
            <Field id="i-to" label={t('validTo')}><Input id="i-to" type="date" {...register('validTo')} /></Field>
            <Button type="submit" className="col-span-2" disabled={save.isPending}>{c('save')}</Button>
          </form></DialogContent>
      </Dialog>
    </div>
  );
}
