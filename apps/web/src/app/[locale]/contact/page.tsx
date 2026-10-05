'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/client-api';
import { errorText } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';

export default function ContactPage() {
  const t = useTranslations('contact');
  const c = useTranslations('common');
  const [v, setV] = useState({ name: '', email: '', phone: '', subject: '', message: '', website: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<'idle' | 'sent'>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: string) => setV({ ...v, [k]: val });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!v.name.trim()) err.name = c('required');
    if (!/^\S+@\S+\.\S+$/.test(v.email)) err.email = t('invalidEmail');
    if (v.message.trim().length < 5) err.message = t('messageShort');
    setErrors(err); setFailure(null);
    if (Object.keys(err).length) return;
    setBusy(true);
    try { await api('/public/contact', { method: 'POST', body: { ...v, phone: v.phone || undefined, subject: v.subject || undefined, website: v.website || undefined } }); setState('sent'); }
    catch (ex) { setFailure(errorText(ex, (k, x) => c(k, x as never))); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('subtitle')}</p>
      {state === 'sent' ? <p role="status" className="rounded-lg border bg-card p-6">{t('sent')}</p> : (
        <form onSubmit={submit} noValidate className="grid gap-4 rounded-lg border bg-card p-6 sm:grid-cols-2">
          <Field id="ct-name" label={t('name')} error={errors.name}><Input id="ct-name" autoComplete="name" value={v.name} aria-invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field id="ct-email" label={t('email')} error={errors.email}><Input id="ct-email" type="email" autoComplete="email" value={v.email} aria-invalid={!!errors.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field id="ct-phone" label={t('phone')}><Input id="ct-phone" type="tel" autoComplete="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field id="ct-subject" label={t('subject')}><Input id="ct-subject" value={v.subject} onChange={(e) => set('subject', e.target.value)} /></Field>
          <Field id="ct-msg" label={t('message')} error={errors.message} className="sm:col-span-2"><Textarea id="ct-msg" rows={6} value={v.message} aria-invalid={!!errors.message} onChange={(e) => set('message', e.target.value)} /></Field>
          {/* honeypot: hidden from people and assistive tech; bots fill it in */}
          <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden"><label>Website<input tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => set('website', e.target.value)} /></label></div>
          {failure && <p role="alert" className="text-sm text-destructive sm:col-span-2">{failure}</p>}
          <Button type="submit" className="sm:col-span-2" disabled={busy}>{t('send')}</Button>
        </form>
      )}
    </div>
  );
}
