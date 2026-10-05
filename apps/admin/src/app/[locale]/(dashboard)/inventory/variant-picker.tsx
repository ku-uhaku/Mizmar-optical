'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { Input } from '@/components/ui/input';

export interface PickedVariant { id: string; sku: string; label: string; stock?: number }
interface StockRow { quantity: number; variant: { id: string; sku: string; color: string | null; size: string | null; product: { name: string } } }

const label = (name: string, color: string | null, size: string | null) => [name, color, size].filter(Boolean).join(' · ');

/**
 * Add-a-line control. Type to search by name/SKU, or scan / paste an exact barcode or SKU and press Enter
 * (that path uses the same lookup endpoint the POS will use, so it also finds items with no stock record yet).
 */
export function VariantPicker({ warehouseId, onPick }: { warehouseId?: string; onPick: (v: PickedVariant) => void }) {
  const t = useTranslations('inventory');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const id = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(id); }, [q]);
  const { data } = useQuery({
    queryKey: ['variant-picker', debounced, warehouseId], enabled: debounced.length >= 2,
    queryFn: () => api<Paginated<StockRow>>('/inventory/stock', { query: { search: debounced, warehouseId, limit: 8 } }),
  });

  const scan = async () => {
    const code = q.trim();
    if (!code) return;
    try {
      const v = await api<{ id: string; sku: string; color: string | null; size: string | null; product: { name: string }; stock: { warehouse: { id: string }; quantity: number }[] }>(`/products/lookup/${encodeURIComponent(code)}?includeInactive=true`);
      onPick({ id: v.id, sku: v.sku, label: label(v.product.name, v.color, v.size), stock: v.stock.find((s) => s.warehouse.id === warehouseId)?.quantity });
      setQ('');
    } catch { toast.error(t('notFound', { code })); }
  };

  return (
    <div className="relative">
      <ScanLine className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
      <Input className="ps-8" value={q} placeholder={t('scanPlaceholder')} aria-label={t('scanPlaceholder')} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scan(); } }} />
      {debounced.length >= 2 && (data?.data.length ?? 0) > 0 && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md" role="listbox">
          {data!.data.map((r) => (
            <li key={r.variant.id}>
              <button type="button" role="option" aria-selected={false} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-muted"
                onClick={() => { onPick({ id: r.variant.id, sku: r.variant.sku, label: label(r.variant.product.name, r.variant.color, r.variant.size), stock: r.quantity }); setQ(''); }}>
                <span><span className="font-medium">{r.variant.product.name}</span> <span className="text-xs text-muted-foreground">{[r.variant.color, r.variant.size].filter(Boolean).join(' · ')}</span><br /><span className="font-mono text-xs text-muted-foreground">{r.variant.sku}</span></span>
                <span className="text-xs text-muted-foreground">{r.quantity}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
