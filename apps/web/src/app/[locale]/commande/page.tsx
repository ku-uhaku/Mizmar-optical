'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { cart, useCart, useCoupon } from '@/lib/cart';
import { errorText } from '@/lib/errors';
import { useFormat } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useQuote } from '@/components/shop/quote';
import { notify } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';

interface Store { id: string; name: string; address: string | null; city: string | null }
interface Method { code: string; name: string; type: string; translations: Record<string, Record<string, string>> | null }
interface Saved { id: string; label: string | null; recipient: string | null; phone: string | null; line1: string; line2: string | null; city: string; isDefaultShipping: boolean }

const PHONE = /^\+?[0-9 ().-]{6,20}$/;

export default function CheckoutPage() {
  const t = useTranslations('checkout');
  const c = useTranslations('common');
  const f = useFormat();
  const router = useRouter();
  const locale = useLocale();
  const { user, ready } = useAuth();
  const { lines } = useCart();
  const coupon = useCoupon();
  const attempt = useRef<string>('');
  const [fulfillment, setFulfillment] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [storeId, setStoreId] = useState('');
  const [shippingMethodId, setShippingMethodId] = useState('');
  const [method, setMethod] = useState('');
  const [contact, setContact] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [addr, setAddr] = useState({ recipient: '', phone: '', line1: '', line2: '', city: '' });
  const [note, setNote] = useState('');
  const [stores, setStores] = useState<Store[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api<Store[]>('/public/stores'), api<Method[]>('/public/payment-methods')]).then(([s, m]) => { if (alive) { setStores(s); setMethods(m); } }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    api<Saved[]>('/account/addresses').then((a) => alive && setSaved(a)).catch(() => undefined);
    return () => { alive = false; };
  }, [user]);

  const effStore = storeId || stores[0]?.id || '';
  const effMethod = method || methods[0]?.code || '';
  const { quote, error, loading } = useQuote(lines, { fulfillment, couponCode: coupon || undefined, storeId: fulfillment === 'PICKUP' ? effStore || undefined : undefined, city: fulfillment === 'DELIVERY' ? addr.city.trim() || undefined : undefined, shippingMethodId: shippingMethodId || undefined });
  const chosenMethod = methods.find((m) => m.code === effMethod);

  if (lines.length === 0) {
    return <div className="mx-auto max-w-xl px-4 py-20 text-center"><h1 className="text-2xl font-bold">{c('cartEmpty')}</h1><Button asChild className="mt-6"><Link href={'/catalogue' as '/'}>{c('browse')}</Link></Button></div>;
  }

  const validate = () => {
    const e: Record<string, string> = {};
    if (!user) {
      if (!contact.firstName.trim()) e.firstName = c('required');
      if (!contact.lastName.trim()) e.lastName = c('required');
      if (!/^\S+@\S+\.\S+$/.test(contact.email)) e.email = t('invalidEmail');
      if (!PHONE.test(contact.phone)) e.phone = t('invalidPhone');
    }
    if (fulfillment === 'DELIVERY') {
      if (!addr.recipient.trim()) e.recipient = c('required');
      if (!PHONE.test(addr.phone)) e.addrPhone = t('invalidPhone');
      if (addr.line1.trim().length < 3) e.line1 = c('required');
      if (addr.city.trim().length < 2) e.city = c('required');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const place = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFailure(null);
    if (!validate() || !quote) return;
    attempt.current ||= crypto.randomUUID(); // a double click or a retry after a timeout returns the SAME order
    setBusy(true);
    try {
      const order = await api<{ number: string; redirectUrl: string | null }>('/public/checkout', {
        method: 'POST',
        body: {
          lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, lens: l.lens && { lensTypeId: l.lens.lensTypeId, lensEntryId: l.lens.lensEntryId, treatmentIds: l.lens.treatmentIds, prescriptionId: l.lens.prescriptionId } })),
          couponCode: coupon || undefined, fulfillment, storeId: fulfillment === 'PICKUP' ? effStore : undefined, shippingMethodId: fulfillment === 'DELIVERY' ? (quote.shippingMethodId ?? undefined) : undefined,
          city: fulfillment === 'DELIVERY' ? addr.city : undefined, paymentMethod: effMethod, note: note.trim() || undefined, clientRef: attempt.current, locale,
          contact: user ? undefined : contact, address: fulfillment === 'DELIVERY' ? { recipient: addr.recipient, phone: addr.phone, line1: addr.line1, line2: addr.line2 || undefined, city: addr.city } : undefined,
        },
      });
      try { sessionStorage.setItem('mizmar.shop.lastOrder', JSON.stringify({ ...order, contact: user ? user.email : contact.email })); } catch { /* private mode */ }
      cart.clear();
      if (order.redirectUrl) { window.location.href = order.redirectUrl; return; }
      router.push('/commande/confirmation' as '/');
    } catch (err) {
      setFailure(errorText(err, (k, x) => c(k, x as never)));
      notify(t('failed'), 'error');
    } finally { setBusy(false); }
  };

  const fill = (a: Saved) => setAddr({ recipient: a.recipient ?? '', phone: a.phone ?? '', line1: a.line1, line2: a.line2 ?? '', city: a.city });
  const radio = 'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5';

  return (
    <form onSubmit={place} noValidate className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">{t('title')}</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          <section aria-labelledby="s-contact" className="space-y-3"><h2 id="s-contact" className="text-lg font-semibold">1. {t('contact')}</h2>
            {!ready ? null : user ? <p className="rounded-md bg-muted p-3 text-sm">{t('signedInAs', { name: `${user.firstName} ${user.lastName}`, email: user.email })}</p> : (
              <>
                <p className="text-sm text-muted-foreground">{t('guestHint')} <Link href={'/compte/connexion?next=/commande' as '/'} className="underline">{t('signIn')}</Link></p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="c-fn" label={t('firstName')} error={errors.firstName}><Input id="c-fn" autoComplete="given-name" value={contact.firstName} aria-invalid={!!errors.firstName} onChange={(e) => setContact({ ...contact, firstName: e.target.value })} /></Field>
                  <Field id="c-ln" label={t('lastName')} error={errors.lastName}><Input id="c-ln" autoComplete="family-name" value={contact.lastName} aria-invalid={!!errors.lastName} onChange={(e) => setContact({ ...contact, lastName: e.target.value })} /></Field>
                  <Field id="c-em" label={t('email')} error={errors.email}><Input id="c-em" type="email" autoComplete="email" value={contact.email} aria-invalid={!!errors.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></Field>
                  <Field id="c-ph" label={t('phone')} error={errors.phone}><Input id="c-ph" type="tel" autoComplete="tel" value={contact.phone} aria-invalid={!!errors.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></Field>
                </div>
              </>
            )}
          </section>

          <section aria-labelledby="s-delivery" className="space-y-3"><h2 id="s-delivery" className="text-lg font-semibold">2. {t('delivery')}</h2>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              <label className={radio}><input type="radio" name="fulfillment" checked={fulfillment === 'PICKUP'} onChange={() => setFulfillment('PICKUP')} className="mt-1 accent-[var(--primary)]" /><span><b>{t('pickup')}</b><br /><span className="text-muted-foreground">{t('pickupHint')}</span></span></label>
              <label className={radio}><input type="radio" name="fulfillment" checked={fulfillment === 'DELIVERY'} onChange={() => setFulfillment('DELIVERY')} className="mt-1 accent-[var(--primary)]" /><span><b>{t('homeDelivery')}</b><br /><span className="text-muted-foreground">{t('deliveryHint')}</span></span></label>
            </div>
            {fulfillment === 'PICKUP' ? (
              <Field id="d-store" label={t('pickupStore')}><Select id="d-store" value={effStore} onChange={(e) => setStoreId(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ''}</option>)}</Select></Field>
            ) : (
              <div className="space-y-3">
                {saved.length > 0 && <Field id="d-saved" label={t('savedAddresses')}><Select id="d-saved" defaultValue="" onChange={(e) => { const a = saved.find((x) => x.id === e.target.value); if (a) fill(a); }}><option value="">—</option>{saved.map((a) => <option key={a.id} value={a.id}>{a.label ?? a.line1}, {a.city}</option>)}</Select></Field>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="a-rc" label={t('recipient')} error={errors.recipient}><Input id="a-rc" autoComplete="name" value={addr.recipient} aria-invalid={!!errors.recipient} onChange={(e) => setAddr({ ...addr, recipient: e.target.value })} /></Field>
                  <Field id="a-ph" label={t('phone')} error={errors.addrPhone}><Input id="a-ph" type="tel" autoComplete="tel" value={addr.phone} aria-invalid={!!errors.addrPhone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} /></Field>
                  <Field id="a-l1" label={t('address')} error={errors.line1} className="sm:col-span-2"><Input id="a-l1" autoComplete="address-line1" value={addr.line1} aria-invalid={!!errors.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} /></Field>
                  <Field id="a-l2" label={t('address2')} className="sm:col-span-2"><Input id="a-l2" autoComplete="address-line2" value={addr.line2} onChange={(e) => setAddr({ ...addr, line2: e.target.value })} /></Field>
                  <Field id="a-ct" label={t('city')} error={errors.city}><Input id="a-ct" autoComplete="address-level2" value={addr.city} aria-invalid={!!errors.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></Field>
                </div>
                {quote?.undeliverable && <p role="alert" className="text-sm text-destructive">{c('errors.NOT_DELIVERABLE')}</p>}
                {quote && quote.shippingOptions.length > 0 && (
                  <fieldset className="space-y-2"><legend className="text-sm font-medium">{t('shippingMethod')}</legend>
                    {quote.shippingOptions.map((o) => (
                      <label key={o.id} className={radio}><input type="radio" name="ship" checked={quote.shippingMethodId === o.id} onChange={() => setShippingMethodId(o.id)} className="mt-1 accent-[var(--primary)]" />
                        <span className="flex-1"><b>{o.name}</b>{o.estimatedDaysMin != null && <span className="block text-muted-foreground">{o.estimatedDaysMin === o.estimatedDaysMax || o.estimatedDaysMax == null ? t('days', { n: o.estimatedDaysMin }) : t('daysRange', { min: o.estimatedDaysMin, max: o.estimatedDaysMax })}</span>}</span>
                        <span className="font-medium">{o.price === 0 ? t('free') : f.money(o.price)}</span></label>
                    ))}
                  </fieldset>
                )}
              </div>
            )}
          </section>

          <section aria-labelledby="s-pay" className="space-y-3"><h2 id="s-pay" className="text-lg font-semibold">3. {t('payment')}</h2>
            <div className="space-y-2" role="radiogroup">
              {methods.map((m) => (
                <label key={m.code} className={radio}><input type="radio" name="pay" checked={effMethod === m.code} onChange={() => setMethod(m.code)} className="mt-1 accent-[var(--primary)]" />
                  <span><b>{m.translations?.[locale]?.name ?? m.name}</b>{m.type === 'CASH_ON_DELIVERY' && <span className="block text-muted-foreground">{fulfillment === 'DELIVERY' ? t('codHint') : t('payAtStoreHint')}</span>}{m.type === 'BANK_TRANSFER' && <span className="block text-muted-foreground">{t('transferHint')}</span>}{m.type === 'ONLINE_PROVIDER' && <span className="block text-muted-foreground">{t('demoHint')}</span>}</span></label>
              ))}
            </div>
            <Field id="o-note" label={t('note')}><Textarea id="o-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
          </section>
        </div>

        <aside aria-label={t('summary')} className="h-fit space-y-4 rounded-lg border bg-card p-5 lg:sticky lg:top-24">
          <h2 className="text-lg font-semibold">{t('summary')}</h2>
          <ul className="space-y-2 text-sm">{(quote?.lines ?? []).map((l, i) => <li key={i} className="flex justify-between gap-3"><span className="min-w-0">{l.quantity} × {l.description}</span><span className="shrink-0">{f.money(l.lineTotal)}</span></li>)}</ul>
          <dl className="space-y-1.5 border-t pt-3 text-sm" aria-busy={loading}>
            <div className="flex justify-between"><dt>{t('subtotal')}</dt><dd>{quote ? f.money(quote.subtotal) : '—'}</dd></div>
            {quote && quote.discountTotal > 0 && <div className="flex justify-between text-emerald-600 dark:text-emerald-400"><dt>{t('discount')}</dt><dd>− {f.money(quote.discountTotal)}</dd></div>}
            {fulfillment === 'DELIVERY' && <div className="flex justify-between"><dt>{t('shipping')}</dt><dd>{quote ? (quote.shippingTotal === 0 ? t('free') : f.money(quote.shippingTotal)) : '—'}</dd></div>}
            <div className="flex justify-between border-t pt-2 text-lg font-semibold"><dt>{t('total')}</dt><dd data-testid="checkout-total">{quote ? f.money(quote.total) : '—'}</dd></div>
            <p className="text-xs text-muted-foreground">{t('vatIncluded')}</p>
          </dl>
          {quote?.hasLens && <p className="text-xs text-muted-foreground">{t('lensNote')}</p>}
          {!!error && <p role="alert" className="text-sm text-destructive">{errorText(error, (k, x) => c(k, x as never))}</p>}
          {failure && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{failure}</p>}
          <Button type="submit" className="h-11 w-full" disabled={busy || !quote || !effMethod || (fulfillment === 'DELIVERY' && !!quote?.undeliverable)}>{busy ? t('placing') : t('placeOrder')}</Button>
          <p className="text-xs text-muted-foreground">{chosenMethod ? t('byOrdering') : ''}</p>
        </aside>
      </div>
    </form>
  );
}
