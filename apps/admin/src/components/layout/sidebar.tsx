'use client';
import { useTranslations } from 'next-intl';
import { Glasses } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth';
import { NAV } from '@/lib/nav';
import { cn } from '@/lib/utils';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { can } = useAuth();
  return (
    <aside className="flex h-full w-64 flex-col border-e bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold"><Glasses className="size-5 text-primary" /> Mizmar Optique</div>
      <nav className="flex-1 space-y-1 p-3">
        {(() => {
          const items = NAV.filter((i) => !i.permission || can(i.permission));
          // highlight only the MOST SPECIFIC match ("/pos/sessions" must not also light up "/pos")
          const activeHref = items.map((i) => i.href).filter((h) => (h === '/' ? pathname === '/' : pathname === h || pathname.startsWith(`${h}/`))).sort((x, y) => y.length - x.length)[0];
          return items.map(({ key, href, icon: Icon }) => {
          const active = href === activeHref;
          return (
            <Link key={key} href={href} onClick={onNavigate} className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted', active && 'bg-accent font-medium text-accent-foreground')}>
              <Icon className="size-4" /> {t(key)}
            </Link>
          );
          });
        })()}
      </nav>
    </aside>
  );
}
