'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/client-api';
import { errorText } from '@/lib/errors';
import { notify } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

interface Addr { id: string; label: string | null; recipient: string | null; phone: string | null; line1: string; line2: string | null; city: string; isDefaultShipping: boolean }
const BLANK = { label: '', recipient: '', phone: '', line1: '', line2: '', city: '' };

export default function AddressesPage() {
  const t = useTranslations('account');
  const k = useTranslations('checkout');
  const c = useTranslations('common');
  const [rows, setRows] = useState<Addr[] | null>(null);
  const [form, setForm] = useState<typeof BLANK | null>(null);
  useEffect(() => { let alive = true; api<Addr[]>('/account/addresses').then((r) => alive && setRows(r)).catch(() => alive && setRows([])); return () => { alive = false; }; }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const a = await api<Addr>('/account/addresses', { method: 'POST', body: { ...form, label: form!.label || undefined, line2: form!.line2 || undefined } });
      setRows(await api<Addr[]>('/account/addresses').catch(() => [a, ...(rows ?? [])])); setForm(null); notify(c('saved'));
    } catch (err) { notify(errorText(err, (key, x) => c(key, x as never)), 'error'); }
  };
  const remove = async (id: string) => { try { await api(`/account/addresses/${id}`, { method: 'DELETE' }); setRows((r) => (r ?? []).filter((a) => a.id !== id)); } catch (e) { notify(errorText(e, (key, x) => c(key, x as never)), 'error'); } };
  const makeDefault = async (a: Addr) => { try { await api(`/account/addresses/${a.id}`, { method: 'PATCH', body: { recipient: a.recipient, phone: a.phone, line1: a.line1, city: a.city, isDefaultShipping: true } }); setRows(await api<Addr[]>('/account/addresses')); } catch (e) { notify(errorText(e, (key, x) => c(key, x as never)), 'error'); } };
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">{t('nav.addresses')}</h1>{!form && <Button onClick={() => setForm(BLANK)}>{t('addAddress')}</Button>}</div>
      {form && (
        <form onSubmit={save} className="grid gap-3 rounded-lg border bg-card p-5 sm:grid-cols-2">
          <Field id="ad-label" label={t('addressLabel')}><Input id="ad-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <Field id="ad-rc" label={k('recipient')}><Input id="ad-rc" required value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} /></Field>
          <Field id="ad-ph" label={k('phone')}><Input id="ad-ph" type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field id="ad-city" label={k('city')}><Input id="ad-city" required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Field id="ad-l1" label={k('address')} className="sm:col-span-2"><Input id="ad-l1" required minLength={3} value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} /></Field>
          <Field id="ad-l2" label={k('address2')} className="sm:col-span-2"><Input id="ad-l2" value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} /></Field>
          <div className="flex gap-2 sm:col-span-2"><Button type="submit">{c('save')}</Button><Button type="button" variant="outline" onClick={() => setForm(null)}>{c('cancel')}</Button></div>
        </form>
      )}
      {rows === null ? <p className="text-muted-foreground">…</p> : rows.length === 0 && !form ? <p className="rounded-lg border bg-card p-8 text-center text-muted-foreground">{t('noAddresses')}</p> : (
        <ul className="grid gap-3 sm:grid-cols-2">{rows.map((a) => (
          <li key={a.id} className="rounded-lg border bg-card p-4 text-sm">
            <div className="flex items-start justify-between gap-2"><p className="font-medium">{a.label ?? a.recipient}{a.isDefaultShipping && <span className="ms-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{t('default')}</span>}</p><button aria-label={c('remove')} onClick={() => remove(a.id)}><Trash2 className="size-4 text-destructive" /></button></div>
            <p className="text-muted-foreground">{a.recipient}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />{a.city}<br /><bdi>{a.phone}</bdi></p>
            {!a.isDefaultShipping && <button className="mt-2 text-xs underline" onClick={() => makeDefault(a)}>{t('makeDefault')}</button>}
          </li>))}</ul>
      )}
    </section>
  );
}
