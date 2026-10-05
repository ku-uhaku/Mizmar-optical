'use client';
import { useLocale } from 'next-intl';
import { Languages } from 'lucide-react';
import { LOCALES } from '@mizmar/shared';
import { usePathname, useRouter } from '@/i18n/navigation';

export function LocaleSwitcher({ label }: { label: string }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="relative flex items-center">
      <Languages className="pointer-events-none absolute start-2 size-4 text-muted-foreground" />
      <select aria-label={label} value={locale} onChange={(e) => router.replace(pathname, { locale: e.target.value })} className="h-9 rounded-md border border-input bg-background ps-8 pe-2 text-sm">
        {LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
      </select>
    </label>
  );
}
