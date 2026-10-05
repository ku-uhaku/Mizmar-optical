import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { publicApi, type Facets } from '@/lib/api';
import { CatalogView, type CatalogParams } from '@/components/shop/catalog-view';

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const facets = await publicApi<Facets>('/facets');
  return { title: facets?.categories.find((c) => c.slug === category)?.name ?? category };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ locale: string; category: string }>; searchParams: Promise<CatalogParams> }) {
  const { locale, category } = await params;
  setRequestLocale(locale);
  return <CatalogView params={await searchParams} category={category} basePath={`/catalogue/${category}`} />;
}
