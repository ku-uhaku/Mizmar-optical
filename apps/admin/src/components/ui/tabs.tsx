'use client';
import { cn } from '@/lib/utils';

/** Minimal controlled tabs (the active tab is kept in state/URL by the caller). */
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto border-b', className)}>
      {items.map((i) => (
        <button key={i.value} role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)}
          className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors', value === i.value ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          {i.label}
        </button>
      ))}
    </div>
  );
}
