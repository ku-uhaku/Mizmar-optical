import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { ThemeProvider } from 'next-themes';
import { isRtl } from '@mizmar/shared';
import { routing } from '@/i18n/routing';
import { FALLBACK_BRANDING, publicApi, type Branding, type MenuItem, type Store } from '@/lib/api';
import { brandingCss, fontsHref, safeFont } from '@/lib/theme';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import { Providers } from '@/components/providers';
import '../globals.css';

// Rendered per request; data freshness comes from the fetch cache (30 s, stale-while-revalidate), and nothing is
// baked at build time, so an API outage can never freeze an empty page into the cache.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const b = (await publicApi<Branding>('/branding')) ?? FALLBACK_BRANDING;
  return {
    title: { default: b.tagline ? `${b.storeName} — ${b.tagline}` : b.storeName, template: `%s · ${b.storeName}` },
    description: b.tagline ?? undefined,
    icons: b.faviconUrl ? { icon: b.faviconUrl } : undefined,
    openGraph: { siteName: b.storeName, type: 'website' },
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [branding, header, pages, stores] = await Promise.all([
    publicApi<Branding>('/branding'),
    publicApi<{ items: MenuItem[] }>('/menus/header'),
    publicApi<{ slug: string; title: string; translations: any }[]>('/pages'),
    publicApi<Store[]>('/stores'),
  ]);
  const b = branding ?? FALLBACK_BRANDING;
  const href = fontsHref(b.fonts);
  const body = safeFont(b.fonts.body);
  const heading = safeFont(b.fonts.heading);

  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <head>
        {href && <link rel="stylesheet" href={href} />}
        {/* Brand colors/fonts come from the dashboard; values are validated in lib/theme.ts */}
        <style dangerouslySetInnerHTML={{ __html: `${brandingCss(b.colors)}${body ? `body{font-family:'${body}',ui-sans-serif,system-ui,sans-serif}` : ''}${heading ? `h1,h2,h3{font-family:'${heading}',ui-sans-serif,system-ui,sans-serif}` : ''}` }} />
      </head>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            <Providers>
              <Header name={b.storeName} logoUrl={b.logoUrl} items={header?.items ?? []} />
              <main>{children}</main>
              <Footer branding={b} pages={pages ?? []} stores={stores ?? []} />
            </Providers>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
