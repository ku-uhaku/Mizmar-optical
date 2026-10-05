/** "Ray-Ban Aviator 3025" -> "ray-ban-aviator-3025" (accents stripped, Arabic kept as-is is NOT supported: fall back to id suffix). */
export const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** Returns `base`, `base-2`, `base-3`... whichever is free (soft-deleted rows keep their slug suffixed, so they never collide). */
export async function uniqueSlug(exists: (slug: string) => Promise<boolean>, name: string, fallback = 'item') {
  const base = slugify(name) || fallback;
  let slug = base;
  for (let i = 2; await exists(slug); i++) slug = `${base}-${i}`;
  return slug;
}
