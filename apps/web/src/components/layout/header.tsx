'use client';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Glasses, Menu, ShoppingBag, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { MenuItem, Tr } from '@/lib/api';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';

const label = (i: { label: string; translations: Tr | null }, locale: string) => i.translations?.[locale]?.label ?? i.label;

export function Header({ name, logoUrl, items }: { name: string; logoUrl: string | null; items: MenuItem[] }) {
  const t = useTranslations('common');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const links = items.map((i) => (
    <Link key={i.id} href={(i.url ?? '/') as '/'} onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted">{label(i, locale)}</Link>
  ));
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <button className="lg:hidden" aria-label="Menu" onClick={() => setOpen((o) => !o)}>{open ? <X /> : <Menu />}</button>
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
          {logoUrl ? <img src={logoUrl} alt={name} className="h-8" /> : <Glasses className="size-6 text-primary" />}{name}
        </Link>
        <nav className="ms-6 hidden items-center gap-1 lg:flex" aria-label="Main">{links}</nav>
        <div className="ms-auto flex items-center gap-1">
          <LocaleSwitcher label={t('language')} />
          <ThemeToggle label={t('theme')} />
          <button aria-label={t('cart')} className="grid size-9 place-items-center rounded-md hover:bg-muted"><ShoppingBag className="size-5" /></button>
        </div>
      </div>
      {open && <nav className="flex flex-col border-t p-2 lg:hidden" aria-label="Mobile">{links}</nav>}
    </header>
  );
}
