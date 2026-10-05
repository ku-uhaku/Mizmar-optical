import 'server-only';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/** Server-side fetch of public storefront data, cached 30 s (ISR) so the API isn't hit per request. */
export async function publicApi<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/public${path}`, { next: { revalidate } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null; // API unreachable (e.g. during build): callers fall back to defaults
  }
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
export type Tr = Record<string, Record<string, string>>;
export interface Store { id: string; name: string; slug: string; phone: string | null; email: string | null; address: string | null; city: string | null; openingHours: Record<string, { open: string; close: string }[]> | null }
export interface ProductCard { id: string; slug: string; name: string; type: string; translations: Tr | null; brand: string | null; image: { url: string; alt: string | null } | null; priceFrom: number | null; colors: string[] }
export interface HomeSection { id: string; type: string; title: string | null; subtitle: string | null; translations: Tr | null; config: Record<string, unknown>; data: any }

export const FALLBACK_BRANDING: Branding = {
  storeName: 'Mizmar Optique', tagline: null, logoUrl: null, logoDarkUrl: null, faviconUrl: null, colors: {}, fonts: {}, social: null, contact: null,
  settings: {}, languages: [], currencies: [{ code: 'MAD', symbol: 'DH', decimals: 2, isDefault: true }],
};

/** Dashboard-editable translations: `translations[locale][field]` wins over the base (French) column. */
export const tr = <T extends { translations?: Tr | null }>(o: T, field: keyof T & string, locale: string): string =>
  (o.translations?.[locale]?.[field] as string | undefined) ?? (o[field] as unknown as string);
