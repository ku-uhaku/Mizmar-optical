'use client';
import { useSyncExternalStore } from 'react';

type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const NONE: Toast[] = [];
let toasts: Toast[] = NONE;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** Tiny global toast: `notify('Saved')`, `notify(message, 'error')`. Announced to screen readers via role=status / alert. */
export function notify(text: string, kind: Toast['kind'] = 'ok') {
  const id = ++seq;
  toasts = [...toasts, { id, text, kind }];
  emit();
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit(); }, 4500);
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => NONE);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto max-w-md rounded-md border px-4 py-2 text-sm shadow-lg ${t.kind === 'error' ? 'border-destructive bg-background text-destructive' : 'bg-foreground text-background'}`}>{t.text}</div>
      ))}
    </div>
  );
}
