'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';

export interface Warehouse { id: string; code: string; name: string; storeId: string; store: { name: string } }

/**
 * Warehouses the user may use, with the ACTIVE store's first. Forms that default to "the first warehouse"
 * therefore default to the shop the user is actually working in (and dropdowns list it first).
 */
export function useWarehouses(enabled = true) {
  const { storeId } = useAuth();
  const q = useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/warehouses'), staleTime: 60_000, enabled });
  const data = useMemo(() => (q.data ? [...q.data].sort((a, b) => Number(b.storeId === storeId) - Number(a.storeId === storeId)) : undefined), [q.data, storeId]);
  return { ...q, data };
}

/** "Store — Warehouse" label for a warehouse reference coming from the API (which only carries id/name). */
export function useWarehouseLabel() {
  const { data } = useWarehouses();
  const byId = useMemo(() => new Map((data ?? []).map((w) => [w.id, `${w.store.name} — ${w.name}`])), [data]);
  return (w: { id: string; name: string }) => byId.get(w.id) ?? w.name;
}
