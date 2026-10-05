'use client';
import { useSyncExternalStore, type ReactNode } from 'react';

const query = '(min-width: 1024px)';
const subscribe = (cb: () => void) => { const m = window.matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); };

/** Filters: always open beside the grid on desktop, collapsed behind a summary on phones unless a filter is active. */
export function FilterPanel({ summary, activeCount, children }: { summary: ReactNode; activeCount: number; children: ReactNode }) {
  const desktop = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
  return (
    <details className="h-fit rounded-lg border bg-card p-4" open={desktop || activeCount > 0}>
      <summary className="cursor-pointer font-medium lg:pointer-events-none">{summary}</summary>
      {children}
    </details>
  );
}
