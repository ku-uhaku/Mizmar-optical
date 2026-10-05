import type { QueryClient } from '@tanstack/react-query';

/** Refresh every inventory list/summary: query keys are 'inv-stock', 'inv-transfers', … (TanStack matches array ELEMENTS, not string prefixes). */
export const invalidateInventory = (qc: QueryClient) => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('inv') });
