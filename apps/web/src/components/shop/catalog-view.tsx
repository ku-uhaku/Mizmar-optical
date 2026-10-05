import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { FALLBACK_BRANDING, publicApi, publicQuery, tr, type Branding, type Facets, type Paged, type ShopCard } from '@/lib/api';
import { ProductCard } from '@/components/product-card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';

const KEYS = ['type', 'brand', 'gender', 'shape', 'material', 'color', 'size', 'minPrice', 'maxPrice', 'inStock', 'sort', 'search'] as const;
export type CatalogParams = Partial<Record<(typeof KEYS)[number] | 'page', string>>;
const TYPES = ['FRAME', 'SUNGLASSES', 'CONTACT_LENS', 'LENS', 'ACCESSORY'];

/** Catalog listing: filters are a plain GET form and pagination are links, so it works without JavaScript and every state is a shareable, indexable URL. */
export async function CatalogView({ params, category, basePath }: { params: CatalogParams; category?: string; basePath: string }) {
  const t = await getTranslations('catalog');
  const locale = await getLocale();
  const [facets, branding] = await Promise.all([publicApi<Facets>('/facets'), publicApi<Branding>('/branding')]);
  const currency = (branding ?? FALLBACK_BRANDING).currencies.find((c) => c.isDefault)?.code ?? 'MAD';
  const page = Math.max(1, Number(params.page) || 1);
  const result = await publicQuery<Paged<ShopCard>>('/products', { ...Object.fromEntries(KEYS.map((k) => [k, params[k]])), category, page: String(page), limit: '12' });
  const f = facets ?? { brands: [], categories: [], shapes: [], materials: [], genders: [], colors: [], sizes: [], price: { min: 0, max: 0 } };
  const href = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ page: undefined, ...params, ...over }).filter((e): e is [string, string] => !!e[1] && !(e[0] === 'page' && e[1] === '1')));
    return `${basePath}${q.size ? `?${q}` : ''}`;
  };
  const active = KEYS.filter((k) => k !== 'sort' && params[k]).length;
  const cat = category ? f.categories.find((c) => c.slug === category) : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-3xl font-bold">{cat ? tr(cat, 'name' as never, locale) : params.search ? t('resultsFor', { q: params.search }) : t('title')}</h1>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label={t('types')}>
        <Link href={href({ type: undefined }) as '/'} className={`rounded-full border px-3 py-1 text-sm ${!params.type ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{t('allTypes')}</Link>
        {TYPES.map((x) => <Link key={x} href={href({ type: x }) as '/'} className={`rounded-full border px-3 py-1 text-sm ${params.type === x ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{t(`type.${x}`)}</Link>)}
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-[16rem_1fr]">
        <details className="rounded-lg border bg-card p-4 lg:open:block" open={active > 0}>
          <summary className="cursor-pointer font-medium lg:pointer-events-none">{t('filters')}{active > 0 && ` (${active})`}</summary>
          <form method="get" action={`/${locale}${basePath}`} className="mt-4 space-y-4 text-sm">
            {params.search && <input type="hidden" name="search" value={params.search} />}
            {params.type && <input type="hidden" name="type" value={params.type} />}
            {([['brand', f.brands, t('brand')], ['shape', f.shapes, t('shape')], ['material', f.materials, t('material')]] as const).map(([name, list, label]) => list.length > 0 && (
              <div key={name} className="space-y-1.5"><label htmlFor={`f-${name}`} className="font-medium">{label}</label>
                <Select id={`f-${name}`} name={name} defaultValue={params[name] ?? ''}><option value="">{t('any')}</option>{list.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}</Select></div>
            ))}
            <div className="space-y-1.5"><label htmlFor="f-gender" className="font-medium">{t('gender')}</label>
              <Select id="f-gender" name="gender" defaultValue={params.gender ?? ''}><option value="">{t('any')}</option>{f.genders.map((g) => <option key={g} value={g}>{t(`genders.${g}`)}</option>)}</Select></div>
            {f.colors.length > 0 && <div className="space-y-1.5"><label htmlFor="f-color" className="font-medium">{t('color')}</label>
              <Select id="f-color" name="color" defaultValue={params.color ?? ''}><option value="">{t('any')}</option>{f.colors.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</Select></div>}
            {f.sizes.length > 0 && <div className="space-y-1.5"><label htmlFor="f-size" className="font-medium">{t('size')}</label>
              <Select id="f-size" name="size" defaultValue={params.size ?? ''}><option value="">{t('any')}</option>{f.sizes.map((s) => <option key={s} value={s}>{s} mm</option>)}</Select></div>}
            <fieldset className="space-y-1.5"><legend className="font-medium">{t('price')} ({currency})</legend>
              <div className="flex items-center gap-2">
                <Input type="number" min={0} name="minPrice" aria-label={t('minPrice')} placeholder={String(Math.floor(f.price.min))} defaultValue={params.minPrice} />
                <span aria-hidden>–</span>
                <Input type="number" min={0} name="maxPrice" aria-label={t('maxPrice')} placeholder={String(Math.ceil(f.price.max))} defaultValue={params.maxPrice} />
              </div></fieldset>
            <label className="flex items-center gap-2"><input type="checkbox" name="inStock" value="true" defaultChecked={params.inStock === 'true'} className="size-4 accent-[var(--primary)]" /> {t('inStockOnly')}</label>
            <div className="flex gap-2"><Button type="submit" className="flex-1">{t('apply')}</Button><Button asChild variant="outline"><Link href={(params.type ? `${basePath}?type=${params.type}` : basePath) as '/'}>{t('reset')}</Link></Button></div>
          </form>
        </details>

        <section aria-live="polite">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t('count', { count: result?.meta.total ?? 0 })}</p>
            <div className="flex flex-wrap gap-1 text-sm" role="group" aria-label={t('sortBy')}>
              {(['newest', 'price_asc', 'price_desc', 'name'] as const).map((s) => <Link key={s} href={href({ sort: s }) as '/'} aria-current={(params.sort ?? 'newest') === s} className={`rounded-md px-2.5 py-1 ${(params.sort ?? 'newest') === s ? 'bg-muted font-medium' : 'hover:bg-muted'}`}>{t(`sort.${s}`)}</Link>)}
            </div>
          </div>
          {result && result.data.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">{result.data.map((p) => <ProductCard key={p.id} p={p} currency={currency} />)}</div>
          ) : <p className="rounded-lg border bg-card p-10 text-center text-muted-foreground">{t('noResults')}</p>}
          {result && result.meta.totalPages > 1 && (
            <nav className="mt-8 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
              {page > 1 ? <Link href={href({ page: String(page - 1) }) as '/'} rel="prev" className="rounded-md border px-3 py-1.5 hover:bg-muted">{t('previous')}</Link> : <span />}
              <span className="text-muted-foreground">{t('pageOf', { page, total: result.meta.totalPages })}</span>
              {page < result.meta.totalPages ? <Link href={href({ page: String(page + 1) }) as '/'} rel="next" className="rounded-md border px-3 py-1.5 hover:bg-muted">{t('next')}</Link> : <span />}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
