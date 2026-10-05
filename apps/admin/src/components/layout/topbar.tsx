'use client';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { LogOut, Menu, Moon, Sun, Languages } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALES } from '@mizmar/shared';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Sidebar } from './sidebar';

export function Topbar() {
  const t = useTranslations('common');
  const { user, logout, storeId, setStoreId } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-5">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu /></Button>
        <div className="ms-auto flex items-center gap-2">
          {user && user.stores.length > 0 && (
            <NativeSelect aria-label={t('store')} className="w-44 sm:w-64" value={storeId ?? ''} onChange={(e) => setStoreId(e.target.value)}>
              {user.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          )}
          <div className="relative flex items-center">
            <Languages className="pointer-events-none absolute start-2 size-4 text-muted-foreground" />
            <NativeSelect aria-label={t('language')} className="w-20 ps-8" value={locale} onChange={(e) => router.replace(pathname, { locale: e.target.value })}>
              {LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </NativeSelect>
          </div>
          <Button variant="ghost" size="icon" aria-label={t('theme')} onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
            <Sun className="hidden dark:block" /><Moon className="dark:hidden" />
          </Button>
          <span className="hidden text-sm text-muted-foreground md:inline">{user?.firstName} {user?.lastName}</span>
          <Button variant="outline" size="sm" onClick={logout}><LogOut /> <span className="hidden sm:inline">{t('logout')}</span></Button>
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute inset-y-0 start-0" onClick={(e) => e.stopPropagation()}><Sidebar onNavigate={() => setOpen(false)} /></div>
        </div>
      )}
    </>
  );
}
