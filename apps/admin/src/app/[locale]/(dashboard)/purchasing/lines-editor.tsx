'use client';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VariantPicker, type PickedVariant } from '../inventory/variant-picker';

export interface CostLine extends PickedVariant { qty: number; cost: number }

/** Pick variants, then set quantity and unit cost (tax-exclusive) for each. Shared by purchase orders and direct receipts. */
export function LinesEditor({ lines, setLines, warehouseId }: { lines: CostLine[]; setLines: (l: CostLine[]) => void; warehouseId?: string }) {
  const t = useTranslations('work');
  const c = useTranslations('common');
  const add = (v: PickedVariant) => (lines.some((l) => l.id === v.id) ? toast.info(t('purchasing.alreadyAdded')) : setLines([...lines, { ...v, qty: 1, cost: 0 }]));
  const set = (i: number, patch: Partial<CostLine>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      <VariantPicker warehouseId={warehouseId} onPick={add} />
      {lines.length > 0 && (
        <ul className="divide-y rounded-md border">
          {lines.map((l, i) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
              <div className="min-w-40 flex-1"><div className="truncate font-medium">{l.label}</div><div className="font-mono text-xs text-muted-foreground">{l.sku}</div></div>
              <Input type="number" min={1} className="w-20" aria-label={c('quantity')} value={l.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} />
              <Input type="number" min={0} step="0.01" className="w-28" aria-label={t('purchasing.unitCost')} placeholder={t('purchasing.unitCost')} value={l.cost} onChange={(e) => set(i, { cost: Number(e.target.value) })} />
              <Button type="button" variant="ghost" size="icon" aria-label={c('remove')} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="text-destructive" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
