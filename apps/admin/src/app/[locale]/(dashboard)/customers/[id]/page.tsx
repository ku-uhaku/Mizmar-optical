'use client';
import { use, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CUSTOMER_GENDERS } from '@mizmar/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dioptre, useFormat } from '@/lib/format';
import { Field, PageHeader, StatCard } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PrescriptionsTab } from './prescriptions-tab';
import { AddressesTab, InsuranceTab, NotesTab } from './sections';
import { PurchasesTab } from './purchases-tab';

const num = (v: unknown) => v;

function Overview({ c: cust }: { c: any }) {
  const t = useTranslations('customers');
  const r = useTranslations('rx');
  const co = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const rx = cust.currentPrescription;
  const { register, handleSubmit } = useForm({ defaultValues: { firstName: cust.firstName, lastName: cust.lastName, phone: cust.phone ?? '', whatsapp: cust.whatsapp ?? '', email: cust.email ?? '', gender: cust.gender ?? '', dateOfBirth: cust.dateOfBirth?.slice(0, 10) ?? '', nationalId: cust.nationalId ?? '', marketingOptIn: cust.marketingOptIn, notes: cust.notes ?? '' } });
  const save = useMutation({
    mutationFn: (v: any) => api(`/customers/${cust.id}`, { method: 'PATCH', body: { firstName: v.firstName.trim(), lastName: v.lastName.trim(), phone: v.phone.trim() || null, whatsapp: v.whatsapp.trim() || null, email: v.email.trim() || null, gender: v.gender || null, dateOfBirth: v.dateOfBirth || null, nationalId: v.nationalId.trim() || null, marketingOptIn: v.marketingOptIn, notes: v.notes || null } }),
    onSuccess: () => { toast.success(co('saved')); qc.invalidateQueries({ queryKey: ['customer', cust.id] }); qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (e) => toast.error(e instanceof ApiError && e.code === 'DUPLICATE_CUSTOMER' ? t('duplicateOnEdit') : (e as Error).message),
  });
  const w = !can('customers:update');
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-3 sm:grid-cols-2" noValidate>
            <Field id="o-fn" label={t('firstName')} required><Input id="o-fn" disabled={w} {...register('firstName', { required: true })} /></Field>
            <Field id="o-ln" label={t('lastName')} required><Input id="o-ln" disabled={w} {...register('lastName', { required: true })} /></Field>
            <Field id="o-ph" label={t('phone')}><Input id="o-ph" type="tel" disabled={w} {...register('phone')} /></Field>
            <Field id="o-wa" label="WhatsApp"><Input id="o-wa" type="tel" disabled={w} {...register('whatsapp')} /></Field>
            <Field id="o-em" label={t('email')}><Input id="o-em" type="email" disabled={w} {...register('email')} /></Field>
            <Field id="o-g" label={t('gender')}><NativeSelect id="o-g" disabled={w} {...register('gender')}><option value="">—</option>{CUSTOMER_GENDERS.map((g) => <option key={g} value={g}>{t(`genders.${g}`)}</option>)}</NativeSelect></Field>
            <Field id="o-dob" label={t('dateOfBirth')}><Input id="o-dob" type="date" disabled={w} {...register('dateOfBirth')} /></Field>
            <Field id="o-nid" label={t('nationalId')}><Input id="o-nid" disabled={w} {...register('nationalId')} /></Field>
            <Field id="o-notes" label={co('notes')} className="sm:col-span-2"><Textarea id="o-notes" disabled={w} {...register('notes')} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" disabled={w} {...register('marketingOptIn')} /> {t('marketingOptIn')}</label>
            {!w && <Button type="submit" className="sm:col-span-2 sm:w-fit" disabled={save.isPending}>{co('save')}</Button>}
          </form>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3"><StatCard label={t('loyalty')} value={f.int(cust.loyaltyPoints)} /><StatCard label={r('title')} value={cust.prescriptionCount} /></div>
        <Card>
          <CardHeader><CardTitle>{r('current')}</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {!rx ? <p className="text-muted-foreground">{r('none')}</p> : (
              <div className="space-y-2">
                <p className="text-muted-foreground">{f.date(rx.issuedAt)} {rx.isExpired && <Badge variant="danger">{r('expired')}</Badge>}</p>
                <table className="w-full text-center" dir="ltr"><thead><tr className="text-xs text-muted-foreground"><th /><th>SPH</th><th>CYL</th><th>AXIS</th><th>ADD</th></tr></thead>
                  <tbody>{(['od', 'os'] as const).map((e) => <tr key={e} className="border-t"><th className="p-1 text-start" dir="auto">{r(e)}</th><td>{dioptre(rx[`${e}Sph`])}</td><td>{dioptre(rx[`${e}Cyl`])}</td><td>{rx[`${e}Axis`] ?? '—'}</td><td>{dioptre(rx[`${e}Add`])}</td></tr>)}</tbody></table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('customers');
  const r = useTranslations('rx');
  const c = useTranslations('common');
  const router = useRouter();
  const { can } = useAuth();
  const [tab, setTab] = useState('overview');
  const { data: cust, isLoading, error } = useQuery({ queryKey: ['customer', id], queryFn: () => api<any>(`/customers/${id}`) });
  const del = useMutation({ mutationFn: () => api(`/customers/${id}`, { method: 'DELETE' }), onSuccess: () => { toast.success(c('deleted')); router.replace('/customers' as '/'); }, onError: (e) => toast.error((e as Error).message) });
  void num;

  return (
    <RequirePermission permission="customers:read">
      <div className="space-y-4">
        <Link href={'/customers' as '/'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" /> {t('title')}</Link>
        {isLoading && <p className="text-muted-foreground">{c('loading')}</p>}
        {error && <p className="text-destructive">{(error as Error).message}</p>}
        {cust && (<>
          <PageHeader title={`${cust.firstName} ${cust.lastName}`} subtitle={[cust.code, cust.phone, cust.email].filter(Boolean).join(' · ')}
            actions={can('customers:delete') && <Button variant="outline" onClick={() => confirm(t('confirmDelete', { name: cust.firstName })) && del.mutate()}><Trash2 className="text-destructive" /> {c('delete')}</Button>} />
          <Tabs value={tab} onChange={setTab} items={[{ value: 'overview', label: t('tabs.overview') }, { value: 'rx', label: r('title') }, { value: 'addresses', label: `${t('tabs.addresses')} (${cust.addresses.length})` }, { value: 'notes', label: `${t('tabs.notes')} (${cust.noteItems.length})` }, { value: 'insurance', label: `${t('tabs.insurance')} (${cust.insurances.length})` }, ...(can('orders:read') ? [{ value: 'purchases', label: t('tabs.purchases') }] : [])]} />
          {tab === 'overview' && <Overview c={cust} />}
          {tab === 'rx' && <PrescriptionsTab customerId={id} />}
          {tab === 'addresses' && <AddressesTab customerId={id} addresses={cust.addresses} />}
          {tab === 'notes' && <NotesTab customerId={id} notes={cust.noteItems} />}
          {tab === 'insurance' && <InsuranceTab customerId={id} insurances={cust.insurances} />}
          {tab === 'purchases' && <PurchasesTab customerId={id} />}
        </>)}
      </div>
    </RequirePermission>
  );
}
