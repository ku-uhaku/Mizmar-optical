import type { Metadata } from 'next';
import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { publicApi, publicQuery, tr, type BlogPostCard, type Paged } from '@/lib/api';

export async function generateMetadata(): Promise<Metadata> { return { title: (await getTranslations('blog'))('title') }; }

export default async function BlogPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ page?: string; category?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations('blog');
  const page = Math.max(1, Number(sp.page) || 1);
  const [posts, cats] = await Promise.all([publicQuery<Paged<BlogPostCard>>('/blog', { page: String(page), limit: '9', category: sp.category }), publicApi<{ name: string; slug: string }[]>('/blog-categories')]);
  const fmt = new Intl.DateTimeFormat(await getLocale(), { dateStyle: 'long' });
  const q = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(Object.entries({ ...sp, ...over }).filter((e): e is [string, string] => !!e[1] && !(e[0] === 'page' && e[1] === '1'))); return `/blog${p.size ? `?${p}` : ''}`; };
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      {cats && cats.length > 0 && <nav className="mt-4 flex flex-wrap gap-2" aria-label={t('categories')}><Link href={q({ category: undefined, page: undefined }) as '/'} className={`rounded-full border px-3 py-1 text-sm ${!sp.category ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{t('all')}</Link>{cats.map((c) => <Link key={c.slug} href={q({ category: c.slug, page: undefined }) as '/'} className={`rounded-full border px-3 py-1 text-sm ${sp.category === c.slug ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{c.name}</Link>)}</nav>}
      {!posts || posts.data.length === 0 ? <p className="mt-10 rounded-lg border bg-card p-10 text-center text-muted-foreground">{t('empty')}</p> : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.data.map((p) => (
            <article key={p.slug} className="overflow-hidden rounded-lg border bg-card">
              <Link href={`/blog/${p.slug}` as '/'}>
                {p.coverUrl && <img src={p.coverUrl} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" />}
                <div className="space-y-1 p-4"><p className="text-xs text-muted-foreground">{fmt.format(new Date(p.publishedAt))}{p.category ? ` · ${p.category.name}` : ''}</p><h2 className="font-semibold leading-snug">{tr(p, 'title', locale)}</h2>{p.excerpt && <p className="line-clamp-3 text-sm text-muted-foreground">{tr(p, 'excerpt' as never, locale) ?? p.excerpt}</p>}</div>
              </Link>
            </article>
          ))}
        </div>
      )}
      {posts && posts.meta.totalPages > 1 && <nav className="mt-8 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">{page > 1 ? <Link href={q({ page: String(page - 1) }) as '/'} className="rounded-md border px-3 py-1.5 hover:bg-muted">{t('previous')}</Link> : <span />}<span className="text-muted-foreground">{page} / {posts.meta.totalPages}</span>{page < posts.meta.totalPages ? <Link href={q({ page: String(page + 1) }) as '/'} className="rounded-md border px-3 py-1.5 hover:bg-muted">{t('next')}</Link> : <span />}</nav>}
    </div>
  );
}
