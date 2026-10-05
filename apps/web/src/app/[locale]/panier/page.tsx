'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Glasses, ShoppingBag, Trash2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/client-api';
import { cart, coupon, useCart, useCoupon } from '@/lib/cart';
import { errorText } from '@/lib/errors';
import { useFormat } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useQuote } from '@/components/shop/quote';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function CartPage() {
  const t = useTranslations('cart');
  const c = useTranslations('common');
  const f = useFormat();
  const { user } = useAuth();
  const { lines } = useCart();
  const code = useCoupon();
  const [draft, setDraft] = useState('');
  const { quote, error, loading } = useQuote(lines, { couponCode: code || undefined });
  const unknown = error instanceof ApiError && error.code === 'UNKNOWN_VARIANT' ? ((error.details as { variantIds?: string[] })?.variantIds ?? []) : [];

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <ShoppingBag className="mx-auto size-12 text-muted-foreground/50" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold">{t('empty')}</h1>
        <Button asChild className="mt-6"><Link href={'/catalogue' as '/'}>{t('continue')}</Link></Button>
      </div>
    );
  }
  const quoted = quote?.lines ?? [];
  const couponState = quote?.coupon;
  const unavailable = quoted.some((l) => !l.available);
  const needsLogin = lines.some((l) => l.lens) && !user;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">{t('title')}</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-label={t('items')}>
          <ul className="divide-y rounded-lg border bg-card">
            {lines.map((l, i) => {
              const q = quoted[i];
              return (
                <li key={l.key} className="flex gap-4 p-4" data-testid="cart-line">
                  <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">{l.image ? <img src={l.image} alt="" className="size-full object-cover" /> : <Glasses className="size-8 text-muted-foreground/40" aria-hidden />}</div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <Link href={`/produit/${l.slug}` as '/'} className="font-medium hover:underline">{l.name}</Link>
                    <p className="text-sm text-muted-foreground">{[l.color, l.size].filter(Boolean).join(' · ')}</p>
                    {l.lens && <p className="text-sm text-muted-foreground">+ {l.lens.summary}</p>}
                    {q && !q.available && <p role="alert" className="text-sm font-medium text-destructive">{t('notEnoughStock')}</p>}
                    <div className="flex items-center gap-3 pt-1">
                      <label className="flex items-center gap-2 text-sm">{t('qty')}
                        <select aria-label={`${t('qty')} ${l.name}`} value={l.quantity} onChange={(e) => cart.setQuantity(l.key, Number(e.target.value))} className="h-8 rounded-md border bg-background px-2" disabled={!!l.lens}>
                          {Array.from({ length: 20 }, (_, n) => n + 1).map((n) => <option key={n}>{n}</option>)}
                        </select></label>
                      <button type="button" onClick={() => cart.remove(l.key)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-destructive"><Trash2 className="size-4" />{c('remove')}</button>
                    </div>
                  </div>
                  <p className="text-end font-semibold">{q ? f.money(q.lineTotal) : f.money(l.price * l.quantity)}</p>
                </li>
              );
            })}
          </ul>
          {unknown.length > 0 && <div role="alert" className="mt-4 rounded-md border border-destructive p-3 text-sm"><p>{t('unavailableItems')}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => lines.filter((l) => unknown.includes(l.variantId)).forEach((l) => cart.remove(l.key))}>{t('removeUnavailable')}</Button></div>}
          {!!error && unknown.length === 0 && <p role="alert" className="mt-4 rounded-md border border-destructive p-3 text-sm text-destructive">{errorText(error, (k, x) => c(k, x as never))}</p>}
        </section>

        <aside aria-label={t('summary')} className="h-fit space-y-4 rounded-lg border bg-card p-5">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { coupon.set(draft.trim().toUpperCase()); setDraft(''); } }}>
            <Input aria-label={t('couponCode')} placeholder={t('couponCode')} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button type="submit" variant="outline">{t('apply')}</Button>
          </form>
          {code && (
            <p className="flex items-center justify-between text-sm" role="status">
              <span>{couponState && 'error' in couponState ? <span className="text-destructive">{t(`coupon.${couponState.error}`)}</span> : <span className="text-emerald-600 dark:text-emerald-400">{code} ✓</span>}</span>
              <button type="button" className="text-muted-foreground underline" onClick={() => coupon.set('')}>{c('remove')}</button>
            </p>
          )}
          <dl className="space-y-1.5 text-sm" aria-busy={loading}>
            <div className="flex justify-between"><dt>{t('subtotal')}</dt><dd>{quote ? f.money(quote.subtotal) : '—'}</dd></div>
            {quote && quote.discountTotal > 0 && <div className="flex justify-between text-emerald-600 dark:text-emerald-400"><dt>{t('discount')}</dt><dd>− {f.money(quote.discountTotal)}</dd></div>}
            <div className="flex justify-between text-muted-foreground"><dt>{t('shippingAtCheckout')}</dt><dd>—</dd></div>
            <div className="flex justify-between border-t pt-2 text-lg font-semibold"><dt>{t('total')}</dt><dd data-testid="cart-total">{quote ? f.money(quote.total) : '—'}</dd></div>
            <p className="text-xs text-muted-foreground">{t('vatIncluded')}</p>
          </dl>
          {needsLogin && <p className="rounded-md bg-muted p-3 text-sm">{t('lensLogin')} <Link href={'/compte/connexion?next=/panier' as '/'} className="font-medium underline">{t('signIn')}</Link></p>}
          <Button asChild className="h-11 w-full" aria-disabled={!quote || unavailable || needsLogin}>
            <Link href={(!quote || unavailable || needsLogin ? '#' : '/commande') as '/'} onClick={(e) => { if (!quote || unavailable || needsLogin) e.preventDefault(); }}>{t('checkout')}</Link>
          </Button>
          {quote?.hasLens && <p className="text-xs text-muted-foreground">{t('lensNote')}</p>}
        </aside>
      </div>
    </div>
  );
}
