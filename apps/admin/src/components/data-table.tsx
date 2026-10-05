'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

export interface Column<T> { header: string; cell: (row: T) => ReactNode; className?: string }

/** Debounced value so typing in the search box doesn't fire a request per keystroke. */
function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/**
 * Server-driven list: search + pagination handled by the API's PaginationDto contract.
 * Every phase 2+ list page reuses this with a different endpoint and columns.
 */
export function DataTable<T extends { id: string }>({ queryKey, endpoint, columns, searchable = true, extraQuery, toolbar }: {
  queryKey: string; endpoint: string; columns: Column<T>[]; searchable?: boolean; extraQuery?: Record<string, string | undefined>; toolbar?: ReactNode;
}) {
  const t = useTranslations('common');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [queryKey, { page, q, ...extraQuery }],
    queryFn: () => api<Paginated<T>>(endpoint, { query: { page, limit: 10, search: q, ...extraQuery } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input className="ps-8" placeholder={t('search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label={t('search')} />
          </div>
        )}
        <div className="ms-auto">{toolbar}</div>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <THead><TR>{columns.map((c, i) => <TH key={i} className={c.className}>{c.header}</TH>)}</TR></THead>
          <TBody>
            {isLoading && <TR><TD colSpan={columns.length} className="py-10 text-center text-muted-foreground">{t('loading')}</TD></TR>}
            {isError && <TR><TD colSpan={columns.length} className="py-10 text-center text-destructive">{(error as Error).message}</TD></TR>}
            {data?.data.length === 0 && <TR><TD colSpan={columns.length} className="py-10 text-center text-muted-foreground">{t('empty')}</TD></TR>}
            {data?.data.map((row) => <TR key={row.id}>{columns.map((c, i) => <TD key={i} className={c.className}>{c.cell(row)}</TD>)}</TR>)}
          </TBody>
        </Table>
      </div>
      {data && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{t('pageOf', { page: data.meta.page, total: data.meta.totalPages })} · {data.meta.total}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t('previous')}><ChevronLeft className="rtl:rotate-180" /></Button>
            <Button variant="outline" size="icon" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)} aria-label={t('next')}><ChevronRight className="rtl:rotate-180" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
