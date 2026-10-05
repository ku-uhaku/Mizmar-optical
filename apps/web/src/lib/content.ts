export type Tr = Record<string, Record<string, string>>;

/** Dashboard-editable translations: `translations[locale][field]` wins over the base (French) column. Safe for server AND client components. */
export const tr = <T extends { translations?: Tr | null }>(o: T, field: keyof T & string, locale: string): string =>
  (o.translations?.[locale]?.[field] as string | undefined) ?? (o[field] as unknown as string);
