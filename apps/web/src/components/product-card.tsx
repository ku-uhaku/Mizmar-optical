import { getLocale, getTranslations } from 'next-intl/server';
import { Glasses } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { tr, type ProductCard as Home, type ShopCard } from '@/lib/api';
import { WishlistButton } from '@/components/shop/wishlist-button';

type Card = Home | ShopCard;
const isShop = (p: Card): p is ShopCard => 'stockStatus' in p;
const swatch = (c: string | { hex: string | null }) => (typeof c === 'string' ? c : c.hex);

export async function ProductCard({ p, currency }: { p: Card; currency: string }) {
  const locale = await getLocale();
  const t = await getTranslations('catalog');
  const price = p.priceFrom == null ? null : new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(p.priceFrom);
  const out = isShop(p) && p.stockStatus === 'OUT';
  return (
    <article className="group relative overflow-hidden rounded-lg border bg-card">
      <Link href={`/produit/${p.slug}` as '/'} className="block">
        <div className="relative grid aspect-[4/3] place-items-center bg-muted">
          {p.image ? <img src={p.image.url} alt={p.image.alt ?? p.name} className="size-full object-cover transition-transform group-hover:scale-105" loading="lazy" /> : <Glasses className="size-12 text-muted-foreground/40" aria-hidden />}
          {out && <span className="absolute start-2 top-2 rounded bg-foreground px-2 py-0.5 text-xs text-background">{t('outOfStock')}</span>}
          {isShop(p) && p.onSale && !out && <span className="absolute start-2 top-2 rounded bg-destructive px-2 py-0.5 text-xs text-white">{t('sale')}</span>}
        </div>
        <div className="space-y-1 p-4">
          {p.brand && <p className="text-xs uppercase tracking-wide text-muted-foreground">{p.brand}</p>}
          <h3 className="font-medium leading-snug">{tr(p, 'name', locale)}</h3>
          <div className="flex items-center justify-between pt-1">
            {price && <span className="font-semibold">{isShop(p) && p.priceFrom != null ? t('from', { price }) : price}</span>}
            <span className="flex gap-1">{p.colors.slice(0, 4).map((c, i) => <span key={i} className="size-3.5 rounded-full border" style={{ background: swatch(c) ?? undefined }} />)}</span>
          </div>
        </div>
      </Link>
      {'id' in p && <WishlistButton productId={p.id} className="absolute end-2 top-2" />}
    </article>
  );
}
