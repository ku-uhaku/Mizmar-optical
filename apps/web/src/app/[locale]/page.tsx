import { setRequestLocale } from 'next-intl/server';
import { FALLBACK_BRANDING, publicApi, type Branding, type HomeSection } from '@/lib/api';
import { HomeSections } from '@/components/home/sections';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [sections, branding] = await Promise.all([publicApi<HomeSection[]>('/home'), publicApi<Branding>('/branding')]);
  const currency = (branding ?? FALLBACK_BRANDING).currencies.find((c) => c.isDefault)?.code ?? 'MAD';
  const b = branding ?? FALLBACK_BRANDING;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Optician', name: b.storeName, description: b.tagline ?? undefined, telephone: b.contact?.phone, email: b.contact?.email };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <HomeSections sections={sections ?? []} currency={currency} />
    </>
  );
}
