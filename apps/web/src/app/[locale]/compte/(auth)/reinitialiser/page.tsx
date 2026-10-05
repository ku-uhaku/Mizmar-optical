'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

function Reset() {
  const t = useTranslations('auth');
  const token = useSearchParams().get('token') ?? '';
  const [pw, setPw] = useState('');
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/auth/reset-password', { method: 'POST', body: { token, password: pw } }); setState('done'); } catch { setState('error'); }
  };
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{t('resetTitle')}</h1>
      {state === 'done' ? <p role="status" className="rounded-lg border bg-card p-5 text-sm">{t('resetDone')} <Link href={'/compte/connexion' as '/'} className="font-medium underline">{t('signIn')}</Link></p> : (
        <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-6">
          <Field id="n-pw" label={t('newPassword')} hint={t('passwordHint')}><Input id="n-pw" type="password" minLength={8} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          {state === 'error' && <p role="alert" className="text-sm text-destructive">{t('resetInvalid')}</p>}
          <Button type="submit" className="w-full" disabled={!token}>{t('resetTitle')}</Button>
        </form>
      )}
    </div>
  );
}
export default function ResetPage() { return <Suspense><Reset /></Suspense>; }
