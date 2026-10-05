import { getLocale, getTranslations } from 'next-intl/server';
import { Star } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { tr, type HomeSection, type Store } from '@/lib/api';
import { ProductCard } from '@/components/product-card';

const Heading = ({ title, subtitle }: { title: string | null; subtitle?: string | null }) => title ? (
  <div className="mb-6"><h2 className="text-2xl font-semibold tracking-tight">{title}</h2>{subtitle && <p className="text-muted-foreground">{subtitle}</p>}</div>
) : null;
const Wrap = ({ children }: { children: React.ReactNode }) => <section className="mx-auto max-w-7xl px-4 pt-12">{children}</section>;

export async function HomeSections({ sections, currency }: { sections: HomeSection[]; currency: string }) {
  const locale = await getLocale();
  const t = await getTranslations('home');
  return (
    <>
      {sections.map((s) => {
        const title = tr(s as any, 'title', locale);
        const subtitle = tr(s as any, 'subtitle', locale);
        switch (s.type) {
          case 'HERO_BANNER': {
            const b = s.data?.[0];
            return (
              <section key={s.id} className="bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
                <div className="mx-auto flex max-w-7xl flex-col items-start gap-4 px-4 py-20 sm:py-28">
                  <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">{b ? tr(b, 'title', locale) : title}</h1>
                  {b?.subtitle && <p className="max-w-xl text-lg opacity-90">{tr(b, 'subtitle', locale)}</p>}
                  {b?.linkUrl && <Link href={b.linkUrl} className="mt-2 inline-flex h-11 items-center rounded-md bg-background px-6 font-medium text-foreground">{b.ctaLabel ?? t('discover')}</Link>}
                </div>
              </section>
            );
          }
          case 'CATEGORIES':
            return <Wrap key={s.id}><Heading title={title} /><div className="grid grid-cols-2 gap-3 md:grid-cols-5">{s.data.map((c: any) => <Link key={c.id} href={`/catalogue/${c.slug}` as '/'} className="grid h-28 place-items-center rounded-lg border bg-card p-3 text-center font-medium transition-colors hover:bg-accent">{tr(c, 'name', locale)}</Link>)}</div></Wrap>;
          case 'FEATURED_PRODUCTS':
          case 'NEW_ARRIVALS':
            return <Wrap key={s.id}><Heading title={title} subtitle={subtitle} /><div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{s.data.map((p: any) => <ProductCard key={p.id} p={p} currency={currency} />)}</div></Wrap>;
          case 'PROMO':
            return s.data ? <Wrap key={s.id}><div className="flex flex-col items-center gap-2 rounded-xl bg-accent p-8 text-center text-accent-foreground"><h2 className="text-xl font-semibold">{title}</h2><p>{s.data.description}</p><code className="rounded-md border border-dashed border-current px-3 py-1 font-mono text-lg">{s.data.code}</code></div></Wrap> : null;
          case 'BRANDS':
            return <Wrap key={s.id}><Heading title={title} /><div className="flex flex-wrap items-center gap-x-10 gap-y-4 text-xl font-semibold text-muted-foreground">{s.data.map((b: any) => <span key={b.id}>{b.name}</span>)}</div></Wrap>;
          case 'TESTIMONIALS':
            return <Wrap key={s.id}><Heading title={title} /><div className="grid gap-4 md:grid-cols-3">{s.data.map((x: any) => <figure key={x.id} className="rounded-lg border bg-card p-5"><div className="mb-2 flex gap-0.5 text-amber-500" aria-label={`${x.rating}/5`}>{Array.from({ length: x.rating }).map((_, i) => <Star key={i} className="size-4 fill-current" />)}</div><blockquote className="text-sm">{tr(x, 'content', locale)}</blockquote><figcaption className="mt-3 text-sm font-medium">{x.authorName}</figcaption></figure>)}</div></Wrap>;
          case 'STORES':
            return <Wrap key={s.id}><Heading title={title} /><div className="grid gap-4 md:grid-cols-2">{(s.data as Store[]).map((st) => <div key={st.id} className="rounded-lg border bg-card p-5"><p className="font-semibold">{st.name}</p><p className="text-sm text-muted-foreground">{[st.address, st.city].filter(Boolean).join(', ')}</p><p className="mt-1 text-sm">{st.phone}</p></div>)}</div></Wrap>;
          default:
            return null; // e.g. NEWSLETTER lands with the storefront commerce phase
        }
      })}
    </>
  );
}
