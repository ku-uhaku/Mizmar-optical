import { getLocale } from 'next-intl/server';
import { Glasses } from 'lucide-react';
import { tr, type ProductCard as P } from '@/lib/api';

export async function ProductCard({ p, currency }: { p: P; currency: string }) {
  const locale = await getLocale();
  const price = p.priceFrom == null ? null : new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(p.priceFrom);
  return (
    <article className="group overflow-hidden rounded-lg border bg-card">
      <div className="grid aspect-[4/3] place-items-center bg-muted">
        {p.image ? <img src={p.image.url} alt={p.image.alt ?? p.name} className="size-full object-cover" loading="lazy" /> : <Glasses className="size-12 text-muted-foreground/40" aria-hidden />}
      </div>
      <div className="space-y-1 p-4">
        {p.brand && <p className="text-xs uppercase tracking-wide text-muted-foreground">{p.brand}</p>}
        <h3 className="font-medium leading-snug">{tr(p, 'name', locale)}</h3>
        <div className="flex items-center justify-between pt-1">
          {price && <span className="font-semibold">{price}</span>}
          <span className="flex gap-1">{p.colors.slice(0, 4).map((c, i) => <span key={i} className="size-3.5 rounded-full border" style={{ background: c }} />)}</span>
        </div>
      </div>
    </article>
  );
}
