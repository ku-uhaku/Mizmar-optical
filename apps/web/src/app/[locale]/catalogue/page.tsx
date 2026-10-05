import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CatalogView, type CatalogParams } from '@/components/shop/catalog-view';

export async function generateMetadata(): Promise<Metadata> { return { title: (await getTranslations('catalog'))('title') }; }

export default async function CataloguePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<CatalogParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CatalogView params={await searchParams} basePath="/catalogue" />;
}
