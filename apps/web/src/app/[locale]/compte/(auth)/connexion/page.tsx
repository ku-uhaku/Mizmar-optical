'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/client-api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

/** Only same-site paths: `?next=//evil.example` or a full URL must never become a redirect target. */
const safeNext = (n: string | null) => (n && /^\/[a-z0-9\-/_?=&]*$/i.test(n) && !n.startsWith('//') ? n : '/compte');

function AuthForms() {
  const t = useTranslations('auth');
  const c = useTranslations('common');
  const router = useRouter();
  const { login, register } = useAuth();
  const next = safeNext(useSearchParams().get('next'));
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [v, setV] = useState({ email: '', password: '', firstName: '', lastName: '', phone: '', marketingOptIn: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: string | boolean) => setV({ ...v, [k]: val });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(v.email)) err.email = t('invalidEmail');
    if (v.password.length < 8) err.password = t('passwordShort');
    if (mode === 'register') { if (!v.firstName.trim()) err.firstName = c('required'); if (!v.lastName.trim()) err.lastName = c('required'); if (v.phone && !/^\+?[0-9 ().-]{6,20}$/.test(v.phone)) err.phone = t('invalidPhone'); }
    setErrors(err); setFailure(null);
    if (Object.keys(err).length) return;
    setBusy(true);
    try {
      if (mode === 'login') await login(v.email.trim(), v.password);
      else await register({ email: v.email.trim(), password: v.password, firstName: v.firstName.trim(), lastName: v.lastName.trim(), phone: v.phone || undefined, marketingOptIn: v.marketingOptIn, locale: document.documentElement.lang });
      router.push(next as '/');
    } catch (ex) {
      setFailure(ex instanceof Error && ex.message === 'staff-account' ? t('staffAccount') : errorText(ex, (k, x) => c(k, x as never)));
      if (ex instanceof ApiError && ex.status === 401) setV((s) => ({ ...s, password: '' }));
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{mode === 'login' ? t('signIn') : t('createAccount')}</h1>
      <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border bg-card p-6">
        {mode === 'register' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="r-fn" label={t('firstName')} error={errors.firstName}><Input id="r-fn" autoComplete="given-name" value={v.firstName} aria-invalid={!!errors.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
            <Field id="r-ln" label={t('lastName')} error={errors.lastName}><Input id="r-ln" autoComplete="family-name" value={v.lastName} aria-invalid={!!errors.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
          </div>
        )}
        <Field id="a-email" label={t('email')} error={errors.email}><Input id="a-email" type="email" autoComplete="email" value={v.email} aria-invalid={!!errors.email} onChange={(e) => set('email', e.target.value)} /></Field>
        {mode === 'register' && <Field id="r-phone" label={t('phone')} error={errors.phone}><Input id="r-phone" type="tel" autoComplete="tel" value={v.phone} aria-invalid={!!errors.phone} onChange={(e) => set('phone', e.target.value)} /></Field>}
        <Field id="a-pw" label={t('password')} error={errors.password} hint={mode === 'register' ? t('passwordHint') : undefined}><Input id="a-pw" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={v.password} aria-invalid={!!errors.password} onChange={(e) => set('password', e.target.value)} /></Field>
        {mode === 'register' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={v.marketingOptIn} onChange={(e) => set('marketingOptIn', e.target.checked)} />{t('marketing')}</label>}
        {failure && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{failure}</p>}
        <Button type="submit" className="h-11 w-full" disabled={busy}>{mode === 'login' ? t('signIn') : t('createAccount')}</Button>
        {mode === 'login' && <p className="text-center text-sm"><Link href={'/compte/mot-de-passe-oublie' as '/'} className="underline">{t('forgot')}</Link></p>}
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        {mode === 'login' ? t('noAccount') : t('haveAccount')}{' '}
        <button type="button" className="font-medium text-foreground underline" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErrors({}); setFailure(null); }}>{mode === 'login' ? t('createAccount') : t('signIn')}</button>
      </p>
    </div>
  );
}

export default function LoginPage() { return <Suspense><AuthForms /></Suspense>; }
