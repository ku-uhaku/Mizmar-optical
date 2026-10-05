'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client-api';
import type { CartLine } from '@/lib/cart';

export interface QuoteLine { variantId: string; description: string; quantity: number; unitPrice: number; discount: number; lineTotal: number; available: boolean; lens: { lensTypeName: string; lensEntryName: string | null; treatments: string[]; lensPrice: number; treatmentsPrice: number } | null }
export interface ShippingOption { id: string; name: string; price: number; estimatedDaysMin: number | null; estimatedDaysMax: number | null; description: string | null }
export interface Quote {
  lines: QuoteLine[]; subtotal: number; discountTotal: number; shippingTotal: number; taxTotal: number; total: number; hasLens: boolean;
  coupon: null | { code: string; discount: number; freeShipping: boolean } | { error: string }; fulfillment: 'PICKUP' | 'DELIVERY'; storeId: string; shippingOptions: ShippingOption[]; shippingMethodId: string | null; undeliverable: boolean;
}
export interface QuoteInput { fulfillment?: 'PICKUP' | 'DELIVERY'; couponCode?: string; shippingMethodId?: string; storeId?: string; city?: string }

/** Asks the server what this cart costs whenever the cart or the delivery choices change (stale answers are discarded). */
export function useQuote(lines: CartLine[], input: QuoteInput) {
  const [state, setState] = useState<{ quote: Quote | null; error: unknown; loading: boolean }>({ quote: null, error: null, loading: false });
  const seq = useRef(0);
  const key = JSON.stringify([lines.map((l) => [l.variantId, l.quantity, l.lens]), input]);
  useEffect(() => {
    if (lines.length === 0) return;
    const mine = ++seq.current;
    const id = setTimeout(() => {
      setState((s) => ({ ...s, loading: true }));
      api<Quote>('/public/cart/quote', { method: 'POST', body: { lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, lens: l.lens && { lensTypeId: l.lens.lensTypeId, lensEntryId: l.lens.lensEntryId, treatmentIds: l.lens.treatmentIds, prescriptionId: l.lens.prescriptionId } })), ...input } })
        .then((quote) => seq.current === mine && setState({ quote, error: null, loading: false }))
        .catch((error) => seq.current === mine && setState({ quote: null, error, loading: false }));
    }, 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures lines + input
  }, [key]);
  return lines.length === 0 ? { quote: null, error: null, loading: false } : state;
}
