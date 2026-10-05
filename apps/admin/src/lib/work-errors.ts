import { ApiError } from './api';

type T = (key: string, values?: Record<string, string | number>) => string;

/** Purchasing / payables / workshop / appointments / online-order API codes that get a translated sentence (keys under `work.errors.*`). */
const KNOWN = new Set([
  'OVER_RECEIPT', 'RECEIPT_INVOICED', 'INVOICE_EXCEEDS_RECEIPT', 'DUPLICATE_INVOICE', 'OVERPAYMENT', 'HAS_RECEIPTS', 'HAS_PAYMENTS', 'INVALID_TRANSITION', 'TECHNICIAN_REQUIRED',
  'TASKS_OPEN', 'NOTES_REQUIRED', 'BALANCE_DUE', 'JOBS_NOT_READY', 'NO_CONTACT', 'INVALID_STATE', 'FRAME_REQUIRED', 'NOTHING_DUE', 'INVALID_TECHNICIAN', 'UNKNOWN_SUPPLIER',
  'SLOT_TAKEN', 'SLOT_UNAVAILABLE', 'NO_PRACTITIONER', 'UNKNOWN_PRACTITIONER', 'INVALID_PRACTITIONER', 'INVALID_HOURS', 'OVERLAPPING_HOURS', 'INVALID_RANGE', 'RANGE_TOO_LARGE', 'INVALID_PAYMENT_METHOD',
  'USER_ALREADY_LINKED', 'DUPLICATE_NUMBER', 'END_DATE_REQUIRED', 'HAS_PAYSLIPS', 'ALREADY_CLOCKED_IN', 'ALREADY_CLOCKED_OUT', 'NOT_CLOCKED_IN', 'NO_EMPLOYEE', 'INVALID_TIMES', 'LEAVE_OVERLAP', 'INSUFFICIENT_BALANCE',
  'NO_WORKING_DAYS', 'SELF_APPROVAL', 'UNKNOWN_LEAVE_TYPE', 'RUN_EXISTS', 'RUN_LOCKED', 'NO_EMPLOYEES', 'ALREADY_PAID', 'INVALID_TAX', 'UNKNOWN_CATEGORY', 'UNKNOWN_ACCOUNT', 'NOT_MANUAL',
]);

export function workError(e: unknown, t: T): string {
  if (!(e instanceof ApiError)) return (e as Error).message;
  if (!KNOWN.has(e.code)) return Array.isArray(e.details) ? (e.details as string[]).join(' · ') : e.message;
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries((e.details ?? {}) as Record<string, unknown>)) if (typeof v === 'string' || typeof v === 'number') values[k] = v;
  return t(`errors.${e.code}`, values);
}
