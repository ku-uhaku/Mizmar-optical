import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MapPin, Phone } from 'lucide-react';
import { publicApi, type Store } from '@/lib/api';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('stores'))('title') };
}

export default async function StoresPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('stores');
  const stores = (await publicApi<Store[]>('/stores')) ?? [];
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{t('title')}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {stores.map((s) => (
          <section key={s.id} className="space-y-2 rounded-lg border bg-card p-5">
            <h2 className="text-lg font-semibold">{s.name}</h2>
            <p className="flex gap-2 text-sm"><MapPin className="size-4 shrink-0" />{[s.address, s.city].filter(Boolean).join(', ')}</p>
            {s.phone && <p className="flex gap-2 text-sm"><Phone className="size-4 shrink-0" /><a href={`tel:${s.phone}`}><bdi>{s.phone}</bdi></a></p>}
            {s.openingHours && <ul className="pt-2 text-sm text-muted-foreground">{DAYS.filter((d) => s.openingHours![d]).map((d) => <li key={d} className="flex justify-between"><span>{t(`days.${d}`)}</span><span>{s.openingHours![d].map((h) => `${h.open}–${h.close}`).join(', ')}</span></li>)}</ul>}
          </section>
        ))}
      </div>
    </div>
  );
}
