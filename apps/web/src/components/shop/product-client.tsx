'use client';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Glasses, Minus, Plus, Store } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { LensOption, ShopProduct, ShopVariant } from '@/lib/api';
import { tr } from '@/lib/api';
import { cart } from '@/lib/cart';
import { useFormat } from '@/lib/format';
import { notify } from '@/components/toaster';
import { Button } from '@/components/ui/button';
import { WishlistButton } from './wishlist-button';
import { LensConfigurator, type LensChoice } from './lens-configurator';

const statusTone = { IN_STOCK: 'text-emerald-600 dark:text-emerald-400', LOW: 'text-amber-600 dark:text-amber-400', OUT: 'text-destructive' } as const;

export function ProductClient({ product, lensOptions }: { product: ShopProduct; lensOptions: LensOption[] }) {
  const t = useTranslations('product');
  const locale = useLocale();
  const f = useFormat();
  const [variantId, setVariantId] = useState(product.variants[0].id);
  const [qty, setQty] = useState(1);
  const [lensOpen, setLensOpen] = useState(false);
  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
  const colors = useMemo(() => [...new Map(product.variants.filter((v) => v.color).map((v) => [v.color, v])).values()], [product.variants]);
  const sizes = product.variants.filter((v) => v.color === variant.color);
  const images = product.images.filter((i) => !i.variantId || i.variantId === variant.id);
  const [shown, setShown] = useState(0);
  const main = images[Math.min(shown, Math.max(0, images.length - 1))];
  const out = variant.stockStatus === 'OUT';
  const configurable = product.isLensConfigurable && lensOptions.length > 0 && ['FRAME', 'SUNGLASSES'].includes(product.type);
  const pickupHere = product.pickupStores.filter((s) => variant.pickupStoreIds.includes(s.id));

  const pick = (v: ShopVariant) => { setVariantId(v.id); setShown(0); };
  const base = { variantId: variant.id, name: tr(product, 'name', locale), slug: product.slug, image: images[0]?.url ?? product.images[0]?.url ?? null, color: variant.color, size: variant.size, price: variant.price };
  const add = () => { cart.add({ ...base, quantity: qty }); notify(t('added')); };
  const addWithLens = (c: LensChoice) => { cart.add({ ...base, quantity: 1, lens: c }); setLensOpen(false); notify(t('added')); };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="relative grid aspect-square place-items-center overflow-hidden rounded-lg border bg-muted">
          {main ? <img src={main.url} alt={main.alt ?? product.name} className="size-full object-contain" /> : <Glasses className="size-24 text-muted-foreground/30" aria-hidden />}
          <WishlistButton productId={product.id} className="absolute end-3 top-3" />
        </div>
        {images.length > 1 && <ul className="flex gap-2 overflow-x-auto">{images.map((im, i) => <li key={im.id}><button type="button" aria-label={`${product.name} ${i + 1}`} aria-current={i === shown} onClick={() => setShown(i)} className={`size-16 overflow-hidden rounded-md border ${i === shown ? 'ring-2 ring-primary' : ''}`}><img src={im.url} alt="" className="size-full object-cover" /></button></li>)}</ul>}
      </div>

      <div className="space-y-5">
        <div>
          {product.brand && <p className="text-sm uppercase tracking-wide text-muted-foreground">{product.brand.name}</p>}
          <h1 className="text-3xl font-bold">{tr(product, 'name', locale)}</h1>
          {product.rating.count > 0 && <p className="mt-1 text-sm text-muted-foreground" aria-label={t('ratingLabel', { average: product.rating.average ?? 0, count: product.rating.count })}>★ {product.rating.average} ({product.rating.count})</p>}
        </div>
        <p className="flex items-baseline gap-3"><span className="text-3xl font-semibold" data-testid="price">{f.money(variant.price)}</span>{variant.compareAtPrice && variant.compareAtPrice > variant.price && <s className="text-muted-foreground">{f.money(variant.compareAtPrice)}</s>}</p>
        {product.shortDescription && <p className="text-muted-foreground">{tr(product, 'shortDescription' as never, locale) ?? product.shortDescription}</p>}

        {colors.length > 1 && (
          <fieldset><legend className="mb-2 text-sm font-medium">{t('color')}: <span className="font-normal text-muted-foreground">{variant.color}</span></legend>
            <div className="flex flex-wrap gap-2">{colors.map((c) => <button key={c.id} type="button" aria-label={c.color ?? ''} aria-pressed={c.color === variant.color} onClick={() => pick(product.variants.find((v) => v.color === c.color)!)} className={`grid size-9 place-items-center rounded-full border-2 ${c.color === variant.color ? 'border-primary' : 'border-transparent ring-1 ring-border'}`}><span className="size-6 rounded-full border" style={{ background: c.colorHex ?? '#ccc' }} />{c.color === variant.color && <Check className="absolute size-3 text-white mix-blend-difference" />}</button>)}</div></fieldset>
        )}
        {sizes.length > 1 && (
          <fieldset><legend className="mb-2 text-sm font-medium">{t('size')}</legend>
            <div className="flex flex-wrap gap-2">{sizes.map((s) => <button key={s.id} type="button" aria-pressed={s.id === variant.id} onClick={() => pick(s)} className={`rounded-md border px-3 py-1.5 text-sm ${s.id === variant.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'} ${s.stockStatus === 'OUT' ? 'text-muted-foreground line-through' : ''}`}>{s.size}</button>)}</div></fieldset>
        )}

        <p className={`text-sm font-medium ${statusTone[variant.stockStatus]}`} role="status">{t(`stock.${variant.stockStatus}`)}</p>
        {pickupHere.length > 0 && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Store className="size-4" />{t('pickupIn', { stores: pickupHere.map((s) => s.name).join(', ') })}</p>}

        {!lensOpen && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-md border" role="group" aria-label={t('quantity')}>
              <button type="button" aria-label={t('less')} className="grid size-10 place-items-center" onClick={() => setQty(Math.max(1, qty - 1))}><Minus className="size-4" /></button>
              <span className="w-8 text-center" aria-live="polite">{qty}</span>
              <button type="button" aria-label={t('more')} className="grid size-10 place-items-center" onClick={() => setQty(Math.min(20, qty + 1))}><Plus className="size-4" /></button>
            </div>
            <Button size="default" className="h-10 flex-1" disabled={out} onClick={add}>{out ? t('unavailable') : t('addToCart')}</Button>
            {configurable && <Button variant="outline" className="h-10 flex-1" disabled={out} onClick={() => setLensOpen(true)}>{t('withLenses')}</Button>}
          </div>
        )}
        {lensOpen && <LensConfigurator variant={variant} options={lensOptions} onConfirm={addWithLens} onCancel={() => setLensOpen(false)} />}

        {product.spec && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t pt-4 text-sm">
            {([['shape', product.spec.shape?.name], ['material', product.spec.material?.name], ['dimensions', product.spec.lensWidthMm ? `${product.spec.lensWidthMm}-${product.spec.bridgeMm ?? '?'}-${product.spec.templeMm ?? '?'} mm` : null], ['polarized', product.spec.isPolarized ? t('yes') : null], ['uv', product.spec.uvProtection]] as const).filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{t(`spec.${k}`)}</dt><dd>{v}</dd></div>)}
          </dl>
        )}
        <p className="text-xs text-muted-foreground">{t('needHelp')} <Link href={'/rendez-vous' as '/'} className="underline">{t('bookExam')}</Link></p>
      </div>
    </div>
  );
}
