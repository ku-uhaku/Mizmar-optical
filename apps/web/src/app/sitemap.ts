import type { MetadataRoute } from 'next';
import { LOCALES } from '@mizmar/shared';
import { publicApi } from '@/lib/api';

const SITE = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';
export const dynamic = 'force-dynamic';

/** One entry per route with hreflang alternates for every locale. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await publicApi<{ products: { slug: string; updatedAt: string }[]; pages: { slug: string; updatedAt: string }[]; categories: { slug: string; updatedAt: string }[]; posts?: { slug: string; updatedAt: string }[] }>('/sitemap', 3600).catch(() => null);
  const routes: { path: string; lastModified?: string }[] = [
    { path: '' }, { path: '/magasins' }, { path: '/catalogue' }, { path: '/rendez-vous' }, { path: '/contact' }, { path: '/blog' }, { path: '/suivi' },
    ...(data?.posts ?? []).map((p) => ({ path: `/blog/${p.slug}`, lastModified: p.updatedAt })),
    ...(data?.pages ?? []).map((p) => ({ path: `/pages/${p.slug}`, lastModified: p.updatedAt })),
    ...(data?.categories ?? []).map((c) => ({ path: `/catalogue/${c.slug}`, lastModified: c.updatedAt })),
    ...(data?.products ?? []).map((p) => ({ path: `/produit/${p.slug}`, lastModified: p.updatedAt })),
  ];
  return routes.flatMap((r) => LOCALES.map((l) => ({
    url: `${SITE}/${l}${r.path}`,
    lastModified: r.lastModified,
    alternates: { languages: Object.fromEntries(LOCALES.map((x) => [x, `${SITE}/${x}${r.path}`])) },
  })));
}
