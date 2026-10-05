import 'server-only';
import type { Tr } from './content';
export { tr, type Tr } from './content';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/**
 * Server-side fetch of public storefront data, cached 30 s in Next's data cache.
 *
 * - 404 -> `null` (caller decides: notFound() or a default).
 * - Network error / 5xx -> THROWS. Swallowing it into an empty render would let one API blip bake a blank page into
 *   the cache; throwing lets Next keep serving the last good (stale) data and show the error page only on a cold cache.
 */
export async function publicApi<T>(path: string, revalidate = 30): Promise<T | null> {
  const res = await fetch(`${API_URL}/public${path}`, { next: { revalidate } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storefront API ${path} responded ${res.status}`);
  return (await res.json()) as T;
}

export interface Branding {
  storeName: string; tagline: string | null; logoUrl: string | null; logoDarkUrl: string | null; faviconUrl: string | null;
  colors: { light?: Record<string, string>; dark?: Record<string, string> };
  fonts: { heading?: string; body?: string };
  social: Record<string, string> | null; contact: { phone?: string; email?: string } | null;
  settings: Record<string, unknown>; languages: { code: string; nativeName: string; isRtl: boolean }[];
  currencies: { code: string; symbol: string; decimals: number; isDefault: boolean }[];
}
export interface MenuItem { id: string; label: string; url: string | null; openInNewTab: boolean; translations: Tr | null; children: MenuItem[] }
export interface Store { id: string; name: string; slug: string; phone: string | null; email: string | null; address: string | null; city: string | null; openingHours: Record<string, { open: string; close: string }[]> | null }
export interface ProductCard { id: string; slug: string; name: string; type: string; translations: Tr | null; brand: string | null; image: { url: string; alt: string | null } | null; priceFrom: number | null; colors: string[] }
export interface HomeSection { id: string; type: string; title: string | null; subtitle: string | null; translations: Tr | null; config: Record<string, unknown>; data: any }

export const FALLBACK_BRANDING: Branding = {
  storeName: 'Mizmar Optique', tagline: null, logoUrl: null, logoDarkUrl: null, faviconUrl: null, colors: {}, fonts: {}, social: null, contact: null,
  settings: {}, languages: [], currencies: [{ code: 'MAD', symbol: 'DH', decimals: 2, isDefault: true }],
};


// ---------------------------------------------------------------- shop (server-side reads)
export interface ShopCard {
  id: string; slug: string; name: string; type: string; translations: Tr | null; brand: string | null; gender: string | null; isLensConfigurable: boolean;
  image: { url: string; alt: string | null } | null; priceFrom: number | null; onSale: boolean; stockStatus: 'IN_STOCK' | 'LOW' | 'OUT'; colors: { name: string; hex: string | null }[];
}
export interface Paged<T> { data: T[]; meta: { page: number; limit: number; total: number; totalPages: number } }
export interface Facets {
  brands: { name: string; slug: string }[]; categories: { name: string; slug: string; parentId: string | null; translations: Tr | null }[]; shapes: { name: string; slug: string }[]; materials: { name: string; slug: string }[];
  genders: string[]; colors: { name: string; hex: string | null }[]; sizes: string[]; price: { min: number; max: number };
}
export interface ShopVariant { id: string; sku: string; name: string | null; color: string | null; colorHex: string | null; size: string | null; price: number; compareAtPrice: number | null; stockStatus: 'IN_STOCK' | 'LOW' | 'OUT'; pickupStoreIds: string[] }
export interface ShopProduct {
  id: string; slug: string; name: string; type: string; translations: Tr | null; shortDescription: string | null; description: string | null; gender: string | null; isLensConfigurable: boolean; requiresPrescription: boolean;
  seoTitle: string | null; seoDescription: string | null; brand: { name: string; slug: string } | null; category: { name: string; slug: string } | null;
  images: { id: string; url: string; alt: string | null; variantId: string | null; isPrimary: boolean }[]; variants: ShopVariant[];
  spec: { shape: { name: string } | null; material: { name: string } | null; rimType: string | null; lensWidthMm: number | null; lensHeightMm: number | null; bridgeMm: number | null; templeMm: number | null; frameWidthMm: number | null; isPolarized: boolean; uvProtection: string | null } | null;
  pickupStores: { id: string; name: string }[]; rating: { average: number | null; count: number }; reviews: { id: string; authorName: string | null; rating: number; title: string | null; body: string | null; createdAt: string }[]; related: ShopCard[];
}
export interface LensOption {
  id: string; code: string; kind: string; name: string; description: string | null; translations: Tr | null; requiresAdd: boolean; basePrice: number;
  treatments: { id: string; name: string; category: string; description: string | null; translations: Tr | null; price: number }[];
  entries: { id: string; name: string; refractiveIndex: number; material: string | null; price: number; leadTimeDays: number | null }[];
}
export interface BlogPostCard { slug: string; title: string; excerpt: string | null; coverUrl: string | null; publishedAt: string; tags: string[]; translations: Tr | null; category: { name: string; slug: string } | null }

/** Server-side fetch with arbitrary query (catalog filters). Same rules as publicApi: 404 -> null, 5xx -> throw. */
export async function publicQuery<T>(path: string, query: Record<string, string | undefined> = {}, revalidate = 30): Promise<T | null> {
  const qs = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => !!e[1])).toString();
  return publicApi<T>(`${path}${qs ? `?${qs}` : ''}`, revalidate);
}
