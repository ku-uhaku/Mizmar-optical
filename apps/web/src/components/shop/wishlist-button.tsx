'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Heart } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { useAuth } from '@/lib/auth';
import { notify } from '@/components/toaster';

let idsCache: Set<string> | null = null;

/** Heart toggle. Guests are sent to sign in; the list of favourite ids is fetched once per page load. */
export function WishlistButton({ productId, className = '' }: { productId: string; className?: string }) {
  const t = useTranslations('common');
  const { user, ready } = useAuth();
  const router = useRouter();
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!ready || !user) return;
    let alive = true;
    (async () => {
      idsCache ??= new Set(await api<string[]>('/account/wishlist/ids').catch(() => []));
      if (alive) setOn(idsCache.has(productId));
    })();
    return () => { alive = false; };
  }, [ready, user, productId]);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation(); // the heart sits on a clickable card
    if (!ready) return; // still restoring the session: do not mistake a signed-in customer for a guest
    if (!user) return router.push('/compte/connexion' as '/');
    const next = !on;
    setOn(next);
    try {
      await api(`/account/wishlist/${productId}`, { method: next ? 'PUT' : 'DELETE' });
      if (next) idsCache?.add(productId); else idsCache?.delete(productId);
    } catch { setOn(!next); notify(t('errors.generic'), 'error'); }
  };
  return (
    <button type="button" onClick={toggle} aria-pressed={on} aria-label={on ? t('removeFavourite') : t('addFavourite')} className={`grid size-9 place-items-center rounded-full bg-background/90 shadow hover:bg-background ${className}`}>
      <Heart className={`size-4 ${on ? 'fill-red-500 text-red-500' : ''}`} />
    </button>
  );
}
