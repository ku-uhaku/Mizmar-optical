'use client';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Glasses, Heart, Menu, Search, ShoppingBag, User, X } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import type { MenuItem, Tr } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';

const label = (i: { label: string; translations: Tr | null }, locale: string) => i.translations?.[locale]?.label ?? i.label;

function SearchBox() {
  const t = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  return open ? (
    <form role="search" className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { router.push(`/catalogue?search=${encodeURIComponent(q.trim())}` as '/'); setOpen(false); } }}>
      <input autoFocus aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="h-9 w-40 rounded-md border bg-background px-3 text-sm sm:w-56" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      <button type="button" aria-label={t('close')} className="grid size-9 place-items-center rounded-md hover:bg-muted" onClick={() => setOpen(false)}><X className="size-4" /></button>
    </form>
  ) : <button aria-label={t('search')} className="grid size-9 place-items-center rounded-md hover:bg-muted" onClick={() => setOpen(true)}><Search className="size-5" /></button>;
}

export function Header({ name, logoUrl, items }: { name: string; logoUrl: string | null; items: MenuItem[] }) {
  const t = useTranslations('common');
  const locale = useLocale();
  const { user } = useAuth();
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const links = items.map((i) => (
    <Link key={i.id} href={(i.url ?? '/') as '/'} onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted">{label(i, locale)}</Link>
  ));
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <button className="lg:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? <X /> : <Menu />}</button>
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
          {logoUrl ? <img src={logoUrl} alt={name} className="h-8" /> : <Glasses className="size-6 text-primary" />}{name}
        </Link>
        <nav className="ms-6 hidden items-center gap-1 lg:flex" aria-label="Main">{links}</nav>
        <div className="ms-auto flex items-center gap-1">
          <SearchBox />
          <div className="hidden sm:flex"><LocaleSwitcher label={t('language')} /></div>
          <ThemeToggle label={t('theme')} />
          {user && <Link href={'/compte/favoris' as '/'} aria-label={t('wishlist')} className="hidden size-9 place-items-center rounded-md hover:bg-muted sm:grid"><Heart className="size-5" /></Link>}
          <Link href={(user ? '/compte' : '/compte/connexion') as '/'} aria-label={user ? t('myAccount') : t('signIn')} className="grid size-9 place-items-center rounded-md hover:bg-muted"><User className="size-5" /></Link>
          <Link href={'/panier' as '/'} aria-label={`${t('cart')} (${count})`} className="relative grid size-9 place-items-center rounded-md hover:bg-muted">
            <ShoppingBag className="size-5" />
            {count > 0 && <span data-testid="cart-count" className="absolute -end-1 -top-1 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-5 text-primary-foreground">{count}</span>}
          </Link>
        </div>
      </div>
      {open && <nav className="flex flex-col border-t p-2 lg:hidden" aria-label="Mobile">{links}<div className="px-3 py-2 sm:hidden"><LocaleSwitcher label={t('language')} /></div></nav>}
    </header>
  );
}
