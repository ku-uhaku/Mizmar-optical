'use client';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { api } from '@/lib/client-api';
import { errorText } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function NewsletterForm({ title }: { title: string }) {
  const t = useTranslations('newsletter');
  const c = useTranslations('common');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try { await api('/public/newsletter', { method: 'POST', body: { email, locale } }); setState('done'); } catch (ex) { setError(errorText(ex, (k, x) => c(k, x as never))); }
  };
  return (
    <div className="rounded-xl bg-muted p-8 text-center">
      <h2 className="text-xl font-semibold">{title}</h2>
      {state === 'done' ? <p role="status" className="mt-3 text-sm">{t('thanks')}</p> : (
        <form onSubmit={submit} className="mx-auto mt-4 flex max-w-md gap-2">
          <Input type="email" required aria-label={t('email')} placeholder={t('email')} value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit">{t('subscribe')}</Button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
