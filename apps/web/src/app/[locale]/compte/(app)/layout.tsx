'use client';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, Heart, LogOut, MapPin, Package, ScrollText, UserRound } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth';

const NAV = [
  ['/compte', 'orders', Package], ['/compte/rendez-vous', 'appointments', CalendarDays], ['/compte/ordonnances', 'prescriptions', ScrollText],
  ['/compte/adresses', 'addresses', MapPin], ['/compte/favoris', 'wishlist', Heart], ['/compte/profil', 'profile', UserRound],
] as const;

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('account');
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => { if (ready && !user) router.replace(`/compte/connexion?next=${encodeURIComponent(path)}` as '/'); }, [ready, user, router, path]);
  if (!ready || !user) return <p className="px-4 py-20 text-center text-muted-foreground" role="status">…</p>;
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:grid-cols-[14rem_1fr]">
      <aside>
        <p className="mb-3 font-semibold">{t('hello', { name: user.firstName })}</p>
        <nav aria-label={t('menu')} className="flex gap-1 overflow-x-auto md:flex-col">
          {NAV.map(([href, key, Icon]) => <Link key={key} href={href as '/'} aria-current={path === href ? 'page' : undefined} className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm ${path === href ? 'bg-muted font-medium' : 'hover:bg-muted'}`}><Icon className="size-4" />{t(`nav.${key}`)}</Link>)}
          <button type="button" onClick={async () => { await logout(); router.push('/'); }} className="flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-start text-sm text-muted-foreground hover:bg-muted"><LogOut className="size-4" />{t('nav.logout')}</button>
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
