import { ApiError } from './client-api';

type T = (key: string, values?: Record<string, string | number>) => string;

/** API error codes that have a customer-friendly translation under `errors.*`. Anything else falls back to the server's message. */
const KNOWN = new Set([
  'INSUFFICIENT_STOCK', 'ACCOUNT_REQUIRED', 'CONTACT_REQUIRED', 'ADDRESS_REQUIRED', 'NOT_DELIVERABLE', 'INVALID_PAYMENT_METHOD', 'PAYMENT_PROVIDER_UNAVAILABLE', 'EMAIL_TAKEN', 'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED', 'COUPON_UNKNOWN', 'COUPON_EXPIRED', 'COUPON_NOT_STARTED', 'COUPON_EXHAUSTED', 'COUPON_ALREADY_USED', 'COUPON_MIN_SUBTOTAL', 'COUPON_NOT_APPLICABLE', 'ORDER_NOT_FOUND', 'CANNOT_CANCEL',
  'PRESCRIPTION_REQUIRED', 'PRESCRIPTION_EXPIRED', 'PRESCRIPTION_NOT_FOUND', 'ADDITION_REQUIRED', 'LENS_OUT_OF_RANGE', 'TREATMENT_NOT_AVAILABLE', 'PRESCRIPTION_EMPTY', 'INVALID_ATTACHMENT', 'VERIFIED',
  'SLOT_TAKEN', 'SLOT_UNAVAILABLE', 'TOO_MANY_APPOINTMENTS', 'APPOINTMENT_NOT_FOUND', 'TOO_LATE', 'INVALID_STATE', 'TOO_MANY_ADDRESSES', 'ALREADY_REVIEWED', 'UNKNOWN_VARIANT', 'UNKNOWN_STORE',
]);

export function errorText(e: unknown, t: T): string {
  if (!(e instanceof ApiError)) return t('errors.network');
  if (e.status === 429) return t('errors.tooMany');
  if (KNOWN.has(e.code)) {
    const values: Record<string, string | number> = {};
    for (const [k, v] of Object.entries((e.details ?? {}) as Record<string, unknown>)) if (typeof v === 'string' || typeof v === 'number') values[k] = v;
    return t(`errors.${e.code}`, values);
  }
  if (Array.isArray(e.details)) return (e.details as string[]).join(' · ');
  return e.status >= 500 ? t('errors.server') : e.message;
}
