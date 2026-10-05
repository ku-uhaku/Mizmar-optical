'use client';
import { useSyncExternalStore } from 'react';

/** What a cart line carries. Prices shown here are DISPLAY ONLY: the server re-prices everything (POST /public/cart/quote). */
export interface CartLine {
  key: string;
  variantId: string;
  quantity: number;
  name: string;
  slug: string;
  image: string | null;
  color: string | null;
  size: string | null;
  price: number;
  lens?: { lensTypeId: string; lensEntryId?: string; treatmentIds: string[]; prescriptionId: string; summary: string };
}

const KEY = 'mizmar.shop.cart';
const EMPTY: CartLine[] = [];
let cache: { raw: string | null; lines: CartLine[] } = { raw: null, lines: EMPTY };
const listeners = new Set<() => void>();

function read(): CartLine[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (raw === cache.raw) return cache.lines;
  let lines: CartLine[] = EMPTY;
  try { const parsed = raw ? JSON.parse(raw) : []; if (Array.isArray(parsed)) lines = parsed.filter((l) => l && typeof l.variantId === 'string' && Number.isInteger(l.quantity) && l.quantity > 0); } catch { /* corrupt: start empty */ }
  cache = { raw, lines: lines.length ? lines : EMPTY };
  return cache.lines;
}
function write(lines: CartLine[]) {
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* private mode: keep going, the cart just won't persist */ }
  cache = { raw: JSON.stringify(lines), lines: lines.length ? lines : EMPTY };
  listeners.forEach((l) => l());
}
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) listeners.forEach((l) => l()); }); // another tab changed it

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const lineKey = (l: Pick<CartLine, 'variantId' | 'lens'>) => `${l.variantId}|${l.lens ? JSON.stringify([l.lens.lensTypeId, l.lens.lensEntryId, [...l.lens.treatmentIds].sort(), l.lens.prescriptionId]) : ''}`;

export const cart = {
  add(l: Omit<CartLine, 'key'>) {
    const lines = read();
    const key = lineKey(l);
    const found = lines.find((x) => x.key === key);
    write(found ? lines.map((x) => (x.key === key ? { ...x, quantity: Math.min(20, x.quantity + l.quantity) } : x)) : [...lines, { ...l, key, quantity: Math.min(20, l.quantity) }]);
  },
  setQuantity(key: string, quantity: number) { write(read().map((x) => (x.key === key ? { ...x, quantity: Math.max(1, Math.min(20, quantity)) } : x))); },
  remove(key: string) { write(read().filter((x) => x.key !== key)); },
  clear() { write([]); },
};

export function useCart() {
  const lines = useSyncExternalStore(subscribe, read, () => EMPTY);
  return { lines, count: lines.reduce((n, l) => n + l.quantity, 0) };
}

// ---------------------------------------------------------------- coupon code (kept with the cart so checkout reuses it)
const COUPON_KEY = 'mizmar.shop.coupon';
const couponListeners = new Set<() => void>();
const readCoupon = () => { try { return localStorage.getItem(COUPON_KEY) ?? ''; } catch { return ''; } };
export const coupon = {
  set(code: string) { try { if (code) localStorage.setItem(COUPON_KEY, code); else localStorage.removeItem(COUPON_KEY); } catch { /* private mode */ } couponListeners.forEach((l) => l()); },
};
export function useCoupon() {
  return useSyncExternalStore((cb) => { couponListeners.add(cb); return () => { couponListeners.delete(cb); }; }, readCoupon, () => '');
}
