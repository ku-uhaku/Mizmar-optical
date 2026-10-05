export interface LensInput { lensTypeId: string; lensEntryId?: string; treatmentIds?: string[]; prescriptionId?: string; notes?: string }
export interface Discount { type: 'PERCENT' | 'AMOUNT'; value: number }

/** One line of the cart: only what the SERVER needs to price it. Display data comes back from /pos/price. */
export interface CartLine { key: string; variantId: string; quantity: number; discount?: Discount; lens?: LensInput; lensLabel?: string; fallbackName?: string }

export interface PricedLine {
  variantId: string; productType: string; sku: string; description: string; quantity: number; unitPrice: number; gross: number; discount: number; taxRatePct: number; taxAmount: number; lineTotal: number;
  lens: null | { lensTypeName: string; lensEntryName: string | null; lensPrice: number; treatments: { treatmentId: string; name: string; price: number }[]; treatmentsPrice: number; prescriptionId: string | null };
}
export interface PricedCart { lines: PricedLine[]; subtotal: number; discountTotal: number; taxTotal: number; total: number; hasLens: boolean; minimumPayment: number; depositPercent: number | null }

export interface PosConfig {
  store: { id: string; name: string; currency: string };
  currentSession: { id: string; registerId: string; openedAt: string } | null;
  registers: { id: string; code: string; name: string; openSession: { id: string; openedById: string; openedAt: string } | null }[];
  paymentMethods: { id: string; code: string; name: string; type: string }[];
  defaultTax: { rate: number; isInclusive: boolean } | null;
  settings: { requireOpenSession: boolean; minDepositPct: number; allowNegativeStock: boolean; prescriptionRequiredForLenses: boolean };
}

export interface CustomerLite { id: string; code?: string | null; firstName: string; lastName: string; phone?: string | null }

export const FRAME_TYPES = ['FRAME', 'SUNGLASSES'];
export const lineKey = () => Math.random().toString(36).slice(2, 10);

/** The cart as it is parked / restored (and sent for pricing): customer + minimal lines. */
export interface ParkedCart { customer: CustomerLite | null; lines: CartLine[] }
export const toApiLines = (lines: CartLine[]) => lines.map(({ variantId, quantity, discount, lens }) => ({ variantId, quantity, ...(discount && discount.value > 0 && { discount }), ...(lens && { lens }) }));
