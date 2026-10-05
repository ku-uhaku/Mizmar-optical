'use client';
import { useLocale } from 'next-intl';
import { useMemo } from 'react';

/** Locale-aware formatters. Currency defaults to MAD (the store currency); Arabic gets Arabic-script numerals via Intl. */
export function useFormat(currency = 'MAD') {
  const locale = useLocale();
  return useMemo(() => {
    const money = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 });
    const int = new Intl.NumberFormat(locale);
    const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
    const dateTimeFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
    return {
      money: (n: number | null | undefined) => (n == null ? '—' : money.format(n)),
      int: (n: number | null | undefined) => (n == null ? '—' : int.format(n)),
      date: (d: string | Date | null | undefined) => (d ? dateFmt.format(new Date(d)) : '—'),
      dateTime: (d: string | Date | null | undefined) => (d ? dateTimeFmt.format(new Date(d)) : '—'),
    };
  }, [locale, currency]);
}

/** Optical measurement with explicit sign, e.g. -1.25 -> "-1.25", 2 -> "+2.00". */
export const dioptre = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}`);
