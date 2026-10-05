import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FALLBACK_BRANDING, publicApi, tr, type Branding, type LensOption, type ShopProduct } from '@/lib/api';
import { ProductCard } from '@/components/product-card';
import { ProductClient } from '@/components/shop/product-client';
import { ReviewForm } from '@/components/shop/review-form';

const SITE = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const p = await publicApi<ShopProduct>(`/products/${slug}`);
  if (!p) return {};
  const img = p.images[0]?.url;
  return {
    title: p.seoTitle ?? tr(p, 'name', locale), description: p.seoDescription ?? p.shortDescription ?? undefined,
    alternates: { canonical: `${SITE}/${locale}/produit/${slug}` }, openGraph: { title: p.name, description: p.shortDescription ?? undefined, images: img ? [img] : undefined, type: 'website' },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [p, lenses, branding] = await Promise.all([publicApi<ShopProduct>(`/products/${slug}`), publicApi<LensOption[]>('/lens-options'), publicApi<Branding>('/branding')]);
  if (!p) notFound();
  const t = await getTranslations('product');
  const currency = (branding ?? FALLBACK_BRANDING).currencies.find((c) => c.isDefault)?.code ?? 'MAD';
  const prices = p.variants.map((v) => v.price);
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.shortDescription ?? p.description ?? undefined, image: p.images.map((i) => i.url), brand: p.brand ? { '@type': 'Brand', name: p.brand.name } : undefined,
    sku: p.variants[0].sku, ...(p.rating.count > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating.average, reviewCount: p.rating.count } } : {}),
    offers: { '@type': 'AggregateOffer', priceCurrency: currency, lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: prices.length, availability: p.variants.some((v) => v.stockStatus !== 'OUT') ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' },
  };
  return (
    <div className="mx-auto max-w-7xl space-y-12 px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <ProductClient product={p} lensOptions={lenses ?? []} />
      {p.description && <section><h2 className="mb-3 text-xl font-semibold">{t('description')}</h2><div className="max-w-3xl whitespace-pre-line text-muted-foreground">{tr(p, 'description' as never, locale) ?? p.description}</div></section>}
      <section aria-labelledby="reviews" className="max-w-3xl space-y-4">
        <h2 id="reviews" className="text-xl font-semibold">{t('reviews')}</h2>
        {p.reviews.length === 0 ? <p className="text-sm text-muted-foreground">{t('noReviews')}</p> : (
          <ul className="space-y-3">{p.reviews.map((r) => <li key={r.id} className="rounded-lg border p-4"><p className="text-amber-500" aria-label={`${r.rating}/5`}>{'★'.repeat(r.rating)}<span className="text-muted-foreground/40">{'★'.repeat(5 - r.rating)}</span></p>{r.title && <p className="font-medium">{r.title}</p>}{r.body && <p className="text-sm text-muted-foreground">{r.body}</p>}<p className="mt-1 text-xs text-muted-foreground">{r.authorName}</p></li>)}</ul>
        )}
        <ReviewForm productId={p.id} />
      </section>
      {p.related.length > 0 && <section><h2 className="mb-4 text-xl font-semibold">{t('related')}</h2><div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{p.related.slice(0, 4).map((r) => <ProductCard key={r.id} p={r} currency={currency} />)}</div></section>}
    </div>
  );
}
