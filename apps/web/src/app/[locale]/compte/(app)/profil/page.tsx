'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/client-api';
import { errorText } from '@/lib/errors';
import { notify } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

interface Profile { firstName: string; lastName: string; email: string; phone: string | null; marketingOptIn: boolean }

export default function ProfilePage() {
  const t = useTranslations('account');
  const a = useTranslations('auth');
  const c = useTranslations('common');
  const [p, setP] = useState<Profile | null>(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  useEffect(() => { let alive = true; api<Profile>('/account/profile').then((r) => alive && setP(r)).catch(() => undefined); return () => { alive = false; }; }, []);
  if (!p) return <p className="text-muted-foreground">…</p>;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/account/profile', { method: 'PATCH', body: { firstName: p.firstName, lastName: p.lastName, phone: p.phone || undefined, marketingOptIn: p.marketingOptIn } }); notify(c('saved')); }
    catch (err) { notify(errorText(err, (k, x) => c(k, x as never)), 'error'); }
  };
  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/account/password', { method: 'POST', body: pw }); setPw({ currentPassword: '', newPassword: '' }); notify(t('passwordChanged')); }
    catch (err) { notify(errorText(err, (k, x) => c(k, x as never)), 'error'); }
  };
  return (
    <section className="max-w-xl space-y-8">
      <form onSubmit={save} className="space-y-4"><h1 className="text-2xl font-bold">{t('nav.profile')}</h1>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="p-fn" label={a('firstName')}><Input id="p-fn" required value={p.firstName} onChange={(e) => setP({ ...p, firstName: e.target.value })} /></Field>
          <Field id="p-ln" label={a('lastName')}><Input id="p-ln" required value={p.lastName} onChange={(e) => setP({ ...p, lastName: e.target.value })} /></Field>
          <Field id="p-em" label={a('email')}><Input id="p-em" value={p.email} disabled /></Field>
          <Field id="p-ph" label={a('phone')}><Input id="p-ph" type="tel" value={p.phone ?? ''} onChange={(e) => setP({ ...p, phone: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={p.marketingOptIn} onChange={(e) => setP({ ...p, marketingOptIn: e.target.checked })} />{a('marketing')}</label>
        <Button type="submit">{c('save')}</Button></form>
      <form onSubmit={changePw} className="space-y-4 border-t pt-6"><h2 className="text-lg font-semibold">{t('changePassword')}</h2>
        <Field id="pw-cur" label={t('currentPassword')}><Input id="pw-cur" type="password" required autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
        <Field id="pw-new" label={a('newPassword')} hint={a('passwordHint')}><Input id="pw-new" type="password" required minLength={8} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
        <Button type="submit" variant="outline">{t('changePassword')}</Button></form>
    </section>
  );
}
