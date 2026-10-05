'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Download, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CUSTOMER_GENDERS } from '@mizmar/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { api, apiDownload, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { DataTable, type Column } from '@/components/data-table';
import { Field, PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';

interface Row { id: string; code: string | null; firstName: string; lastName: string; phone: string | null; email: string | null; gender: string | null; loyaltyPoints: number; createdAt: string }
interface FormValues { firstName: string; lastName: string; phone: string; email: string; gender: string; dateOfBirth: string; marketingOptIn: boolean }
interface Dupe { id: string; code: string; firstName: string; lastName: string; phone: string | null; email: string | null }

function CreateCustomer() {
  const t = useTranslations('customers');
  const c = useTranslations('common');
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dupes, setDupes] = useState<Dupe[]>([]);
  const { register, handleSubmit, reset, getValues, formState: { errors } } = useForm<FormValues>();

  const create = useMutation({
    mutationFn: (v: FormValues & { allowDuplicate?: boolean }) => api<{ id: string }>('/customers', { method: 'POST', body: {
      firstName: v.firstName.trim(), lastName: v.lastName.trim(), phone: v.phone.trim() || undefined, email: v.email.trim() || undefined, gender: v.gender || undefined,
      dateOfBirth: v.dateOfBirth || undefined, marketingOptIn: v.marketingOptIn, allowDuplicate: v.allowDuplicate || undefined } }),
    onSuccess: (r) => { toast.success(t('created')); qc.invalidateQueries({ queryKey: ['customers'] }); reset(); setDupes([]); setOpen(false); router.push(`/customers/${r.id}` as '/'); },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'DUPLICATE_CUSTOMER') setDupes(((e.details as any)?.matches ?? []) as Dupe[]);
      else toast.error(e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]).join(' · ') : (e as Error).message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setDupes([]); }}>
      <Button onClick={() => setOpen(true)}><Plus /> {t('new')}</Button>
      <DialogContent>
        <DialogTitle>{t('new')}</DialogTitle>
        <DialogDescription>{t('newHint')}</DialogDescription>
        <form onSubmit={handleSubmit((v) => create.mutate(v))} className="grid grid-cols-2 gap-3" noValidate>
          <Field id="c-fn" label={t('firstName')} required error={errors.firstName?.message}><Input id="c-fn" {...register('firstName', { required: c('required') })} /></Field>
          <Field id="c-ln" label={t('lastName')} required error={errors.lastName?.message}><Input id="c-ln" {...register('lastName', { required: c('required') })} /></Field>
          <Field id="c-ph" label={t('phone')}><Input id="c-ph" type="tel" inputMode="tel" {...register('phone')} /></Field>
          <Field id="c-em" label={t('email')}><Input id="c-em" type="email" {...register('email')} /></Field>
          <Field id="c-g" label={t('gender')}><NativeSelect id="c-g" {...register('gender')}><option value="">—</option>{CUSTOMER_GENDERS.map((g) => <option key={g} value={g}>{t(`genders.${g}`)}</option>)}</NativeSelect></Field>
          <Field id="c-dob" label={t('dateOfBirth')}><Input id="c-dob" type="date" {...register('dateOfBirth')} /></Field>
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" {...register('marketingOptIn')} /> {t('marketingOptIn')}</label>
          {dupes.length > 0 && (
            <div role="alert" className="col-span-2 space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">{t('duplicateTitle')}</p>
              <ul className="space-y-1">{dupes.map((d) => <li key={d.id}><Link href={`/customers/${d.id}` as '/'} className="underline">{d.firstName} {d.lastName}</Link> <span className="text-muted-foreground">{[d.code, d.phone, d.email].filter(Boolean).join(' · ')}</span></li>)}</ul>
              <Button type="button" variant="outline" size="sm" onClick={() => create.mutate({ ...getValues(), allowDuplicate: true })}>{t('createAnyway')}</Button>
            </div>
          )}
          <Button type="submit" className="col-span-2" disabled={create.isPending}>{c('save')}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CustomersPage() {
  const t = useTranslations('customers');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const [gender, setGender] = useState('');
  const columns: Column<Row>[] = [
    { header: c('code'), cell: (r) => <span className="font-mono text-xs">{r.code}</span>, className: 'hidden md:table-cell' },
    { header: c('name'), cell: (r) => <Link href={`/customers/${r.id}` as '/'} className="block hover:underline"><div className="font-medium">{r.firstName} {r.lastName}</div><div className="text-xs text-muted-foreground" dir="ltr">{[r.phone, r.email].filter(Boolean).join(' · ')}</div></Link> },
    { header: t('gender'), cell: (r) => (r.gender ? <Badge variant="secondary">{t(`genders.${r.gender}`)}</Badge> : '—'), className: 'hidden sm:table-cell' },
    { header: t('loyalty'), cell: (r) => f.int(r.loyaltyPoints), className: 'hidden lg:table-cell' },
    { header: t('since'), cell: (r) => f.date(r.createdAt), className: 'hidden lg:table-cell' },
  ];
  return (
    <RequirePermission permission="customers:read">
      <div className="space-y-4">
        <PageHeader title={t('title')} actions={<>
          {can('customers:export') && <Button variant="outline" onClick={() => apiDownload('/customers/export.csv', 'customers.csv').catch((e) => toast.error(e.message))}><Download /> {t('export')}</Button>}
          {can('customers:create') && <CreateCustomer />}
        </>} />
        <NativeSelect className="w-44" aria-label={t('gender')} value={gender} onChange={(e) => setGender(e.target.value)}><option value="">{t('gender')}: {c('all')}</option>{CUSTOMER_GENDERS.map((g) => <option key={g} value={g}>{t(`genders.${g}`)}</option>)}</NativeSelect>
        <DataTable<Row> queryKey="customers" endpoint="/customers" columns={columns} extraQuery={{ gender: gender || undefined }} />
      </div>
    </RequirePermission>
  );
}
