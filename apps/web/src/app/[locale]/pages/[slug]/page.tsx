import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { publicApi, tr } from '@/lib/api';

interface Page { slug: string; title: string; content: string; seoTitle: string | null; seoDescription: string | null; translations: any }
const load = (slug: string) => publicApi<Page>(`/pages/${encodeURIComponent(slug)}`);

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const p = await load(slug);
  return p ? { title: p.seoTitle ?? tr(p, 'title', locale), description: p.seoDescription ?? undefined } : {};
}

export default async function CmsPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const p = await load(slug);
  if (!p) notFound();
  const content = (p.translations?.[locale]?.content as string | undefined) ?? p.content;
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{tr(p, 'title', locale)}</h1>
      {/* Content is authored in the dashboard by trusted staff and sanitized server-side at save time */}
      <div className="space-y-4 leading-relaxed [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold" dangerouslySetInnerHTML={{ __html: content }} />
    </article>
  );
}
