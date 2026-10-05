'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Glasses, Trash2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { tr } from '@/lib/content';
import type { ShopCard } from '@/lib/api';
import { api } from '@/lib/client-api';
import { useFormat } from '@/lib/format';

export default function WishlistPage() {
  const t = useTranslations('account');
  const c = useTranslations('common');
  const locale = useLocale();
  const f = useFormat();
  const [rows, setRows] = useState<ShopCard[] | null>(null);
  useEffect(() => { let alive = true; api<ShopCard[]>('/account/wishlist').then((r) => alive && setRows(r)).catch(() => alive && setRows([])); return () => { alive = false; }; }, []);
  const remove = async (id: string) => { await api(`/account/wishlist/${id}`, { method: 'DELETE' }).catch(() => undefined); setRows((r) => (r ?? []).filter((p) => p.id !== id)); };
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t('nav.wishlist')}</h1>
      {rows === null ? <p className="text-muted-foreground">…</p> : rows.length === 0 ? <p className="rounded-lg border bg-card p-8 text-center text-muted-foreground">{t('noFavourites')}</p> : (
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3">{rows.map((p) => (
          <li key={p.id} className="relative overflow-hidden rounded-lg border bg-card">
            <Link href={`/produit/${p.slug}` as '/'}><div className="grid aspect-[4/3] place-items-center bg-muted">{p.image ? <img src={p.image.url} alt={p.image.alt ?? p.name} className="size-full object-cover" /> : <Glasses className="size-10 text-muted-foreground/40" aria-hidden />}</div>
              <div className="p-3"><p className="text-xs uppercase text-muted-foreground">{p.brand}</p><p className="font-medium">{tr(p, 'name', locale)}</p><p className="text-sm font-semibold">{f.money(p.priceFrom)}</p></div></Link>
            <button type="button" aria-label={c('remove')} onClick={() => remove(p.id)} className="absolute end-2 top-2 grid size-8 place-items-center rounded-full bg-background/90 shadow"><Trash2 className="size-4 text-destructive" /></button>
          </li>))}</ul>
      )}
    </section>
  );
}
