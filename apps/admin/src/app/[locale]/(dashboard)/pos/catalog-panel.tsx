'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Glasses, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, type Paginated } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface ProductRow { id: string; name: string; type: string; brand: { name: string } | null; image: { url: string } | null; variantCount: number; priceFrom: number | null; priceTo: number | null; stock: number }
interface Variant { id: string; sku: string; color: string | null; colorHex: string | null; size: string | null; price: number; isActive: boolean; stock: { quantity: number; reserved: number }[] }
interface Lookup { id: string; sku: string; color: string | null; size: string | null; product: { name: string }; stock: { available: number }[] }

const vLabel = (name: string, v: { color: string | null; size: string | null }) => [name, v.color, v.size].filter(Boolean).join(' · ');
const onHand = (v: Variant) => v.stock.reduce((n, s) => n + s.quantity - s.reserved, 0);

/** Scan a barcode / type a SKU and press Enter, or search by name/brand and pick the product (then the variant). */
export function CatalogPanel({ onAdd, disabled }: { onAdd: (variantId: string, name: string) => void; disabled?: boolean }) {
  const t = useTranslations('pos');
  const f = useFormat();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picking, setPicking] = useState<{ name: string; variants: Variant[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const id = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(id); }, [q]);
  useEffect(() => { input.current?.focus(); }, [disabled]);

  const results = useQuery({
    queryKey: ['pos-search', debounced], enabled: debounced.length >= 2 && !disabled,
    queryFn: () => api<Paginated<ProductRow>>('/products', { query: { search: debounced, limit: 8, status: 'ACTIVE' } }),
  });

  const scan = async () => {
    const code = q.trim();
    if (code.length < 3 || /\s/.test(code)) return;
    try {
      const v = await api<Lookup>(`/products/lookup/${encodeURIComponent(code)}`);
      onAdd(v.id, vLabel(v.product.name, v));
      setQ('');
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) toast.error((e as Error).message); // 404: not a code, keep the text as a search
    }
  };

  const open = async (p: ProductRow) => {
    const d = await api<{ name: string; variants: Variant[] }>(`/products/${p.id}`);
    const live = d.variants.filter((v) => v.isActive);
    if (live.length === 1) { onAdd(live[0].id, vLabel(d.name, live[0])); setQ(''); input.current?.focus(); }
    else setPicking({ name: d.name, variants: live });
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <ScanLine className="pointer-events-none absolute start-3 top-3 size-5 text-muted-foreground" />
        <Input ref={input} autoFocus disabled={disabled} className="h-11 ps-10 text-base" value={q} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scan(); } }} />
      </div>
      {debounced.length >= 2 && (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label={t('results')}>
          {results.data?.data.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => open(p)} className="flex w-full items-center gap-3 rounded-lg border bg-card p-2.5 text-start transition-colors hover:bg-accent">
                <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">{p.image ? <img src={p.image.url} alt="" className="size-full object-cover" /> : <Glasses className="size-6 text-muted-foreground/50" />}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{p.brand?.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-sm"><span>{p.priceFrom === p.priceTo ? f.money(p.priceFrom) : `${f.money(p.priceFrom)} – ${f.money(p.priceTo)}`}</span><Badge variant={p.stock > 0 ? 'success' : 'danger'}>{p.stock}</Badge></div>
                </div>
              </button>
            </li>
          ))}
          {results.data?.data.length === 0 && <li className="col-span-full py-6 text-center text-sm text-muted-foreground">{t('noResults')}</li>}
        </ul>
      )}
      <Dialog open={!!picking} onOpenChange={(o) => !o && setPicking(null)}>
        <DialogContent>
          <DialogTitle>{picking?.name}</DialogTitle>
          <DialogDescription>{t('pickVariant')}</DialogDescription>
          <ul className="divide-y rounded-md border">
            {picking?.variants.map((v) => (
              <li key={v.id}>
                <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-accent" onClick={() => { onAdd(v.id, vLabel(picking.name, v)); setPicking(null); setQ(''); input.current?.focus(); }}>
                  {v.colorHex && <span className="size-4 rounded-full border" style={{ background: v.colorHex }} />}
                  <span className="flex-1"><span className="font-medium">{v.color ?? v.sku}</span> <span className="text-xs text-muted-foreground">{v.size}</span><br /><span className="font-mono text-xs text-muted-foreground">{v.sku}</span></span>
                  <span className="text-sm">{f.money(v.price)}</span>
                  <Badge variant={onHand(v) > 0 ? 'success' : 'danger'}>{onHand(v)}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
