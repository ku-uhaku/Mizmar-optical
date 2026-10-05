'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, Minus, PauseCircle, Percent, Plus, Trash2, UserRound, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { salesError } from '@/lib/errors';
import { useFormat } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { FRAME_TYPES, type CartLine, type CustomerLite, type Discount, type PricedCart } from './types';
import type { ApiError } from '@/lib/api';

interface Props {
  lines: CartLine[]; customer: CustomerLite | null; priced?: PricedCart; priceError: ApiError | null; pending: boolean;
  onQty: (key: string, q: number) => void; onRemove: (key: string) => void; onDiscount: (key: string, d?: Discount) => void; onLens: (line: CartLine) => void;
  onCustomer: () => void; onClearCustomer: () => void; onPay: () => void; onPark: () => void; onQuote: () => void; onClear: () => void;
}

export function CartPanel(p: Props) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const [discFor, setDiscFor] = useState<CartLine | null>(null);
  const [dType, setDType] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [dValue, setDValue] = useState('');
  const aligned = p.priced && p.priced.lines.length === p.lines.length && p.priced.lines.every((l, i) => l.variantId === p.lines[i].variantId);
  const canDiscount = can('pos:discount');
  const empty = p.lines.length === 0;

  return (
    <aside className="flex h-full flex-col rounded-lg border bg-card" aria-label={t('cart')}>
      <div className="flex items-center gap-2 border-b p-3">
        <Button variant="outline" size="sm" className="min-w-0 flex-1 justify-start" onClick={p.onCustomer}>
          <UserRound /> <span className="truncate">{p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : t('addCustomer')}</span>
        </Button>
        {p.customer && <Button variant="ghost" size="icon" className="size-8" aria-label={t('removeCustomer')} onClick={p.onClearCustomer}><X /></Button>}
      </div>

      <ul className="min-h-40 flex-1 divide-y overflow-auto">
        {empty && <li className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">{t('cartEmpty')}</li>}
        {p.lines.map((l, i) => {
          const pl = aligned ? p.priced!.lines[i] : undefined;
          const isFrame = pl ? FRAME_TYPES.includes(pl.productType) : false;
          return (
            <li key={l.key} className="space-y-1.5 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium leading-snug">{pl ? pl.description.split(' + ')[0] : l.fallbackName ?? l.variantId}</div>
                  {pl && <div className="font-mono text-xs text-muted-foreground">{pl.sku}</div>}
                  {l.lens && <Badge variant="default" className="mt-1">{t('lens.badge')}: {l.lensLabel ?? ''}</Badge>}
                  {pl?.lens && pl.lens.treatments.length > 0 && <div className="mt-0.5 text-xs text-muted-foreground">{pl.lens.treatments.map((x) => x.name).join(' · ')}</div>}
                  {l.discount && l.discount.value > 0 && <Badge variant="secondary" className="mt-1">−{l.discount.type === 'PERCENT' ? `${l.discount.value}%` : f.money(l.discount.value)}</Badge>}
                </div>
                <div className="text-end"><div className="font-semibold">{pl ? f.money(pl.lineTotal) : '…'}</div>{pl && pl.discount > 0 && <div className="text-xs text-muted-foreground line-through">{f.money(pl.gross)}</div>}</div>
              </div>
              <div className="flex items-center gap-1">
                <div className="flex items-center rounded-md border">
                  <Button variant="ghost" size="icon" className="size-8" aria-label={t('decrease')} onClick={() => p.onQty(l.key, l.quantity - 1)} disabled={l.quantity <= 1}><Minus /></Button>
                  <Input type="number" min={1} max={1000} className="h-8 w-12 border-0 px-1 text-center shadow-none" aria-label={c('quantity')} value={l.quantity} onChange={(e) => p.onQty(l.key, Number(e.target.value))} />
                  <Button variant="ghost" size="icon" className="size-8" aria-label={t('increase')} onClick={() => p.onQty(l.key, l.quantity + 1)}><Plus /></Button>
                </div>
                {isFrame && <Button variant={l.lens ? 'default' : 'outline'} size="sm" onClick={() => p.onLens(l)}><Eye /> {l.lens ? t('lens.edit') : t('lens.add')}</Button>}
                {canDiscount && <Button variant="outline" size="icon" className="size-8" aria-label={t('discount')} onClick={() => { setDiscFor(l); setDType(l.discount?.type ?? 'PERCENT'); setDValue(l.discount ? String(l.discount.value) : ''); }}><Percent /></Button>}
                <Button variant="ghost" size="icon" className="ms-auto size-8" aria-label={c('remove')} onClick={() => p.onRemove(l.key)}><Trash2 className="text-destructive" /></Button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t p-3">
        {p.priceError && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{salesError(p.priceError, t)}</p>}
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">{t('subtotal')}</dt><dd>{f.money(p.priced?.subtotal ?? 0)}</dd></div>
          {!!p.priced?.discountTotal && <div className="flex justify-between"><dt className="text-muted-foreground">{t('discounts')}</dt><dd>−{f.money(p.priced.discountTotal)}</dd></div>}
          <div className="flex justify-between text-xs text-muted-foreground"><dt>{t('includingTax')}</dt><dd>{f.money(p.priced?.taxTotal ?? 0)}</dd></div>
          <div className="flex items-baseline justify-between border-t pt-2 text-xl font-bold"><dt>{c('total')}</dt><dd aria-live="polite" className={p.pending ? 'opacity-50' : ''}>{f.money(p.priced?.total ?? 0)}</dd></div>
          {p.priced?.hasLens && <div className="rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground">{t('depositInfo', { percent: p.priced.depositPercent ?? 0, amount: f.money(p.priced.minimumPayment) })}</div>}
        </dl>
        <Button size="lg" className="h-12 w-full text-base" disabled={empty || !!p.priceError || p.pending || !p.priced} onClick={p.onPay}>{t('pay')} · {f.money(p.priced?.total ?? 0)}</Button>
        <div className="grid grid-cols-3 gap-1.5">
          <Button variant="outline" size="sm" disabled={empty} onClick={p.onPark}><PauseCircle /> {t('park')}</Button>
          <Button variant="outline" size="sm" disabled={empty} onClick={p.onQuote}>{t('saveQuote')}</Button>
          <Button variant="ghost" size="sm" disabled={empty && !p.customer} onClick={() => confirm(t('confirmClear')) && p.onClear()}>{t('clear')}</Button>
        </div>
      </div>

      <Dialog open={!!discFor} onOpenChange={(o) => !o && setDiscFor(null)}>
        <DialogContent className="sm:max-w-sm"><DialogTitle>{t('discount')}</DialogTitle><DialogDescription className="sr-only">{t('discount')}</DialogDescription>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (discFor) p.onDiscount(discFor.key, Number(dValue) > 0 ? { type: dType, value: Number(dValue) } : undefined); setDiscFor(null); }}>
            <div className="grid grid-cols-[1fr_auto] gap-2"><Input type="number" min={0} max={dType === 'PERCENT' ? 100 : undefined} step="0.01" inputMode="decimal" autoFocus aria-label={t('discount')} value={dValue} onChange={(e) => setDValue(e.target.value)} />
              <NativeSelect aria-label={c('type')} value={dType} onChange={(e) => setDType(e.target.value as 'PERCENT' | 'AMOUNT')}><option value="PERCENT">%</option><option value="AMOUNT">{f.symbol}</option></NativeSelect></div>
            <div className="flex gap-2"><Button type="button" variant="ghost" onClick={() => { if (discFor) p.onDiscount(discFor.key, undefined); setDiscFor(null); }}>{t('removeDiscount')}</Button><Button type="submit" className="flex-1">{c('save')}</Button></div>
          </form></DialogContent>
      </Dialog>
    </aside>
  );
}
