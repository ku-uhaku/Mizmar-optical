/**
 * Order pricing, shared by the API (authoritative) and the POS screen (live preview) so they can never disagree.
 *
 * All arithmetic is done in INTEGER CENTS and rounded half-up per line, then summed: no floating-point drift, and the
 * invoice lines always add up to the invoice total.
 *
 * Prices may be tax-INCLUSIVE (the default in retail: the shelf price is what the customer pays) or tax-EXCLUSIVE:
 *   inclusive: total = net,        tax = net * r / (100 + r)
 *   exclusive: total = net + tax,  tax = net * r / 100
 * where net = gross - discount and gross = quantity * (unitPrice + lensPrice + treatmentsPrice).
 */
export type Discount = { type: 'PERCENT' | 'AMOUNT'; value: number };

export interface PriceLineInput {
  quantity: number;
  unitPrice: number;
  /** Per unit, when the line is a frame with a lens configuration. */
  lensPrice?: number;
  treatmentsPrice?: number;
  discount?: Discount | null;
  taxRatePct: number;
  taxInclusive: boolean;
}

export interface PricedLine {
  gross: number;
  discount: number;
  net: number;
  tax: number;
  /** What the customer pays for this line. */
  total: number;
}

export interface PricedOrder {
  lines: PricedLine[];
  /** Sum of line gross amounts (before discounts). */
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  shippingTotal: number;
  total: number;
}

export const toCents = (n: number) => Math.round(n * 100 + (n < 0 ? -1e-9 : 1e-9));
export const fromCents = (c: number) => c / 100;
export const roundMoney = (n: number) => fromCents(toCents(n));

export function priceLine(l: PriceLineInput): PricedLine {
  if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new RangeError('quantity must be a positive integer');
  if (l.taxRatePct < 0 || l.taxRatePct > 100) throw new RangeError('taxRatePct must be between 0 and 100');
  const unitCents = toCents(l.unitPrice) + toCents(l.lensPrice ?? 0) + toCents(l.treatmentsPrice ?? 0);
  if (unitCents < 0) throw new RangeError('prices must not be negative');
  const gross = unitCents * l.quantity;

  let discount = 0;
  const d = l.discount;
  if (d) {
    if (d.value < 0) throw new RangeError('discount must not be negative');
    if (d.type === 'PERCENT') {
      if (d.value > 100) throw new RangeError('percent discount cannot exceed 100');
      discount = Math.round((gross * d.value) / 100 + 1e-9);
    } else discount = toCents(d.value);
    discount = Math.min(discount, gross); // a discount can never make a line negative
  }
  const net = gross - discount;
  const tax = l.taxInclusive ? Math.round((net * l.taxRatePct) / (100 + l.taxRatePct) + 1e-9) : Math.round((net * l.taxRatePct) / 100 + 1e-9);
  const total = l.taxInclusive ? net : net + tax;
  return { gross: fromCents(gross), discount: fromCents(discount), net: fromCents(net), tax: fromCents(tax), total: fromCents(total) };
}

export function priceOrder(lines: PriceLineInput[], shipping = 0): PricedOrder {
  const priced = lines.map(priceLine);
  const sum = (f: (l: PricedLine) => number) => priced.reduce((n, l) => n + toCents(f(l)), 0);
  const shippingCents = toCents(shipping);
  return {
    lines: priced,
    subtotal: fromCents(sum((l) => l.gross)),
    discountTotal: fromCents(sum((l) => l.discount)),
    taxTotal: fromCents(sum((l) => l.tax)),
    shippingTotal: fromCents(shippingCents),
    total: fromCents(sum((l) => l.total) + shippingCents),
  };
}

/** Refund for `qty` of a line that sold `lineQty` units for `lineTotal`, given what was already refunded for that line. */
export function proportionalRefund(lineTotal: number, lineQty: number, qty: number, alreadyRefunded: number, alreadyReturnedQty: number): number {
  if (qty + alreadyReturnedQty > lineQty) throw new RangeError('cannot return more than was sold');
  // returning the LAST units takes whatever is left, so rounding can never leave a stray cent behind
  if (qty + alreadyReturnedQty === lineQty) return roundMoney(lineTotal - alreadyRefunded);
  return fromCents(Math.round((toCents(lineTotal) * qty) / lineQty));
}
