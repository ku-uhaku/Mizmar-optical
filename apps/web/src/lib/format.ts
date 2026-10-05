'use client';
import { useLocale } from 'next-intl';
import { useMemo } from 'react';

export function useFormat(currency = 'MAD') {
  const locale = useLocale();
  return useMemo(() => {
    const money = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 });
    const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
    const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    return {
      money: (n: number | null | undefined) => (n == null ? '—' : money.format(n)),
      date: (d: string | Date | null | undefined) => (d ? date.format(new Date(d)) : '—'),
      dateTime: (d: string | Date | null | undefined) => (d ? dateTime.format(new Date(d)) : '—'),
    };
  }, [locale, currency]);
}

/** Same, for the store's timezone (appointment times are wall-clock times AT the store). */
export function formatAt(locale: string, tz: string, d: string | Date, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }).format(new Date(d));
}
