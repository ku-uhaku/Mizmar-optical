import { ApiError } from './api';

type T = (key: string, values?: Record<string, string | number>) => string;

/** Codes the sales API returns that deserve a human, translated sentence (keys live under `errors.sales.*`). */
const KNOWN = new Set([
  'NO_OPEN_SESSION', 'INSUFFICIENT_STOCK', 'FULL_PAYMENT_REQUIRED', 'DEPOSIT_TOO_LOW', 'OVERPAYMENT', 'CUSTOMER_REQUIRED', 'PRESCRIPTION_REQUIRED', 'PRESCRIPTION_EXPIRED',
  'PRESCRIPTION_NOT_FOUND', 'ADDITION_REQUIRED', 'LENS_OUT_OF_RANGE', 'TREATMENT_NOT_AVAILABLE', 'UNKNOWN_VARIANT', 'INVALID_PAYMENT_METHOD', 'QUOTE_NOT_USABLE', 'QUOTE_EXPIRED',
  'BALANCE_DUE', 'NOTHING_DUE', 'RETURN_EXCEEDS_SOLD', 'REFUND_EXCEEDS_PAID', 'REFUND_EXCEEDS_RETURN', 'REFUND_REQUIRED', 'INSUFFICIENT_CASH', 'REGISTER_BUSY', 'ALREADY_OPEN',
  'SESSION_CLOSED', 'INVALID_STATE', 'MISSING_PERMISSION', 'INVALID_PRICING',
]);

/** Translate an API error for display; unknown codes fall back to the server's own message. */
export function salesError(e: unknown, t: T): string {
  if (!(e instanceof ApiError)) return (e as Error).message;
  if (!KNOWN.has(e.code)) return Array.isArray(e.details) ? (e.details as string[]).join(' · ') : e.message;
  const d = (e.details ?? {}) as Record<string, unknown>;
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === 'string' || typeof v === 'number') values[k] = v;
  if (e.code === 'MISSING_PERMISSION' && Array.isArray(d.missing)) values.missing = (d.missing as string[]).join(', ');
  return t(`errors.sales.${e.code}`, values);
}
