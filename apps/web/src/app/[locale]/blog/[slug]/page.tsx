import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { publicApi, tr } from '@/lib/api';

interface Post { slug: string; title: string; excerpt: string | null; content: string; coverUrl: string | null; publishedAt: string; seoTitle: string | null; seoDescription: string | null; translations: Record<string, Record<string, string>> | null; category: { name: string } | null }

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const p = await publicApi<Post>(`/blog/${slug}`);
  return p ? { title: p.seoTitle ?? tr(p, 'title', locale), description: p.seoDescription ?? p.excerpt ?? undefined, openGraph: { type: 'article', images: p.coverUrl ? [p.coverUrl] : undefined } } : {};
}

export default async function PostPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const p = await publicApi<Post>(`/blog/${slug}`);
  if (!p) notFound();
  const t = await getTranslations('blog');
  const date = new Intl.DateTimeFormat(await getLocale(), { dateStyle: 'long' }).format(new Date(p.publishedAt));
  // Post bodies are authored by trusted staff in the dashboard (same rule as CMS pages): add server-side sanitising when a public editor ships.
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <Link href={'/blog' as '/'} className="text-sm text-muted-foreground hover:underline">← {t('title')}</Link>
      <h1 className="mt-3 text-4xl font-bold leading-tight">{tr(p, 'title', locale)}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{date}{p.category ? ` · ${p.category.name}` : ''}</p>
      {p.coverUrl && <img src={p.coverUrl} alt="" className="mt-6 w-full rounded-lg" />}
      <div className="prose-content mt-8 space-y-4 leading-relaxed [&_a]:underline [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:ps-6" dangerouslySetInnerHTML={{ __html: p.content }} />
    </article>
  );
}
