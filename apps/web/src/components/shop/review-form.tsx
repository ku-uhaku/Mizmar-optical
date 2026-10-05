'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';
import { notify } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';

export function ReviewForm({ productId }: { productId: string }) {
  const t = useTranslations('product');
  const c = useTranslations('common');
  const { user, ready } = useAuth();
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;
  if (!user) return <p className="text-sm text-muted-foreground"><Link href={'/compte/connexion' as '/'} className="underline">{t('signInToReview')}</Link></p>;
  if (done) return <p role="status" className="rounded-md bg-muted p-3 text-sm">{t('reviewThanks')}</p>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api('/account/reviews', { method: 'POST', body: { productId, rating, title: title || undefined, body: body || undefined } }); setDone(true); }
    catch (err) { notify(errorText(err, (k, x) => c(k, x as never)), 'error'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">{t('writeReview')}</h3>
      <div role="radiogroup" aria-label={t('rating')} className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n}/5`} onClick={() => setRating(n)} className={`text-2xl ${n <= rating ? 'text-amber-500' : 'text-muted-foreground/40'}`}>★</button>)}</div>
      <Field id="rv-title" label={t('reviewTitle')}><Input id="rv-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field id="rv-body" label={t('reviewBody')}><Textarea id="rv-body" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} /></Field>
      <Button type="submit" disabled={busy}>{t('sendReview')}</Button>
    </form>
  );
}
