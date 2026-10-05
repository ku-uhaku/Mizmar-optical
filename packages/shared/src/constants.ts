export const LOCALES = ['fr', 'ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';
export const RTL_LOCALES: readonly Locale[] = ['ar'];
export const isRtl = (l: string) => (RTL_LOCALES as readonly string[]).includes(l);

export const DEFAULT_CURRENCY = 'MAD';
export const DEFAULT_TAX_RATE_PCT = 20;

/** Customer gender: male or female (optional). Product audience is a different list: men / women / unisex / kids. */
export const CUSTOMER_GENDERS = ['MALE', 'FEMALE'] as const;
export type CustomerGender = (typeof CUSTOMER_GENDERS)[number];
