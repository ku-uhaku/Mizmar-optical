'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/client-api';
import { errorText } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

export default function ForgotPage() {
  const t = useTranslations('auth');
  const c = useTranslations('common');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try { await api('/auth/forgot-password', { method: 'POST', body: { email } }); setSent(true); } catch (ex) { setError(errorText(ex, (k, x) => c(k, x as never))); }
  };
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{t('forgot')}</h1>
      {sent ? <p role="status" className="rounded-lg border bg-card p-5 text-sm">{t('resetSent')}</p> : (
        <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-6">
          <Field id="f-email" label={t('email')}><Input id="f-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full">{t('sendLink')}</Button>
        </form>
      )}
    </div>
  );
}
