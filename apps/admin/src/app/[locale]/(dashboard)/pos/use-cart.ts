'use client';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { lineKey, toApiLines, type CartLine, type CustomerLite, type Discount, type LensInput, type ParkedCart, type PricedCart } from './types';

interface State { lines: CartLine[]; customer: CustomerLite | null }
type Action =
  | { type: 'add'; variantId: string; fallbackName?: string }
  | { type: 'qty'; key: string; quantity: number }
  | { type: 'remove'; key: string }
  | { type: 'discount'; key: string; discount?: Discount }
  | { type: 'lens'; key: string; lens?: LensInput; label?: string }
  | { type: 'customer'; customer: CustomerLite | null }
  | { type: 'load'; cart: ParkedCart }
  | { type: 'clear' };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'add': {
      // an item WITHOUT discount/lens just gains quantity; configured lines stay separate so each keeps its own lens
      const same = s.lines.find((l) => l.variantId === a.variantId && !l.lens && !l.discount);
      if (same) return { ...s, lines: s.lines.map((l) => (l === same ? { ...l, quantity: Math.min(l.quantity + 1, 1000) } : l)) };
      return { ...s, lines: [...s.lines, { key: lineKey(), variantId: a.variantId, quantity: 1, fallbackName: a.fallbackName }] };
    }
    case 'qty': return { ...s, lines: s.lines.map((l) => (l.key === a.key ? { ...l, quantity: Math.max(1, Math.min(1000, Math.floor(a.quantity) || 1)) } : l)) };
    case 'remove': return { ...s, lines: s.lines.filter((l) => l.key !== a.key) };
    case 'discount': return { ...s, lines: s.lines.map((l) => (l.key === a.key ? { ...l, discount: a.discount } : l)) };
    case 'lens': return { ...s, lines: s.lines.map((l) => (l.key === a.key ? { ...l, lens: a.lens, lensLabel: a.label } : l)) };
    case 'customer': return { ...s, customer: a.customer };
    case 'load': return { customer: a.cart.customer, lines: a.cart.lines.map((l) => ({ ...l, key: lineKey() })) };
    case 'clear': return { lines: [], customer: null };
  }
}

/**
 * Cart state + a debounced SERVER price preview. The server is the only thing that prices a sale, so the totals shown here are
 * exactly what checkout will charge (and lens/prescription problems are reported while the cashier is still building the cart).
 */
export function useCart() {
  const [state, dispatch] = useReducer(reducer, { lines: [], customer: null });
  const [debounced, setDebounced] = useState(state);
  useEffect(() => { const id = setTimeout(() => setDebounced(state), 250); return () => clearTimeout(id); }, [state]);

  const body = useMemo(() => ({ customerId: debounced.customer?.id, lines: toApiLines(debounced.lines) }), [debounced]);
  const price = useQuery({
    queryKey: ['pos-price', body], enabled: body.lines.length > 0, placeholderData: (prev) => prev, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => api<PricedCart>('/pos/price', { method: 'POST', body }),
  });
  const priced = state.lines.length ? price.data : undefined;
  const priceError = price.error instanceof ApiError ? price.error : price.error ? new ApiError(0, 'ERROR', (price.error as Error).message) : null;
  const pending = state.lines.length > 0 && (price.isFetching || state !== debounced);

  const api_ = useMemo(() => ({
    add: (variantId: string, fallbackName?: string) => dispatch({ type: 'add', variantId, fallbackName }),
    setQty: (key: string, quantity: number) => dispatch({ type: 'qty', key, quantity }),
    remove: (key: string) => dispatch({ type: 'remove', key }),
    setDiscount: (key: string, discount?: Discount) => dispatch({ type: 'discount', key, discount }),
    setLens: (key: string, lens?: LensInput, label?: string) => dispatch({ type: 'lens', key, lens, label }),
    setCustomer: (customer: CustomerLite | null) => dispatch({ type: 'customer', customer }),
    load: (cart: ParkedCart) => dispatch({ type: 'load', cart }),
    clear: () => dispatch({ type: 'clear' }),
  }), []);
  const snapshot = useCallback((): ParkedCart => ({ customer: state.customer, lines: state.lines }), [state]);

  return { ...state, priced: priceError ? undefined : priced, priceError, pending, snapshot, ...api_ };
}
