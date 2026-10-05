import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { tr, type Branding, type Store } from '@/lib/api';

export async function Footer({ branding, pages, stores }: { branding: Branding; pages: { slug: string; title: string; translations: any }[]; stores: Store[] }) {
  const t = await getTranslations('footer');
  const locale = await getLocale();
  return (
    <footer className="mt-16 border-t bg-muted/40">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-lg font-semibold">{branding.storeName}</p>
          {branding.tagline && <p className="mt-1 text-sm text-muted-foreground">{branding.tagline}</p>}
          {branding.contact?.phone && <p className="mt-3 text-sm" dir="ltr" style={{ textAlign: 'start' }}>{branding.contact.phone}</p>}
          {branding.contact?.email && <p className="text-sm">{branding.contact.email}</p>}
        </div>
        <div>
          <p className="mb-2 font-medium">{t('information')}</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {pages.map((p) => <li key={p.slug}><Link href={`/pages/${p.slug}` as '/'} className="hover:text-foreground">{tr(p, 'title', locale)}</Link></li>)}
            <li><Link href={'/magasins' as '/'} className="hover:text-foreground">{t('stores')}</Link></li>
          </ul>
        </div>
        <div className="lg:col-span-2">
          <p className="mb-2 font-medium">{t('ourStores')}</p>
          <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {stores.map((s) => <li key={s.id}><span className="font-medium text-foreground">{s.name}</span><br />{[s.address, s.city].filter(Boolean).join(', ')}<br /><bdi>{s.phone}</bdi></li>)}
          </ul>
        </div>
      </div>
      <div className="border-t py-4 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} {branding.storeName}</div>
    </footer>
  );
}
