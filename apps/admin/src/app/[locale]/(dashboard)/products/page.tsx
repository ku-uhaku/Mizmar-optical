'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Glasses, Plus } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';

interface Row { id: string; name: string; type: string; status: string; isPublished: boolean; brand: { name: string } | null; category: { name: string } | null; image: { url: string } | null; variantCount: number; priceFrom: number | null; priceTo: number | null; stock: number }
export const PRODUCT_TYPES = ['FRAME', 'SUNGLASSES', 'CONTACT_LENS', 'LENS', 'ACCESSORY'];

export default function ProductsPage() {
  const t = useTranslations('products');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const [type, setType] = useState('');
  const [brandId, setBrandId] = useState('');
  const [status, setStatus] = useState('');
  const brands = useQuery({ queryKey: ['options', '/brands'], queryFn: () => api<Paginated<{ id: string; name: string }>>('/brands', { query: { limit: 100 } }), staleTime: 60_000 });

  const columns: Column<Row>[] = [
    { header: '', className: 'w-14', cell: (p) => <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-muted">{p.image ? <img src={p.image.url} alt="" className="size-full object-cover" /> : <Glasses className="size-5 text-muted-foreground/50" />}</div> },
    { header: c('name'), cell: (p) => <Link href={`/products/${p.id}` as '/'} className="block hover:underline"><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{[p.brand?.name, p.category?.name].filter(Boolean).join(' · ')}</div></Link> },
    { header: c('type'), cell: (p) => <Badge variant="secondary">{t(`types.${p.type}`)}</Badge>, className: 'hidden md:table-cell' },
    { header: c('price'), cell: (p) => (p.priceFrom == null ? '—' : p.priceFrom === p.priceTo ? f.money(p.priceFrom) : `${f.money(p.priceFrom)} – ${f.money(p.priceTo)}`) },
    { header: t('variants'), cell: (p) => p.variantCount, className: 'hidden sm:table-cell' },
    { header: c('stock'), cell: (p) => <Badge variant={p.stock <= 0 ? 'danger' : 'success'}>{f.int(p.stock)}</Badge> },
    { header: c('status'), cell: (p) => <Badge variant={p.status === 'ACTIVE' ? 'success' : 'secondary'}>{t(`statuses.${p.status}`)}</Badge>, className: 'hidden lg:table-cell' },
  ];

  return (
    <RequirePermission permission="products:read">
      <div className="space-y-4">
        <PageHeader title={t('title')} actions={can('products:create') && <Button asChild><Link href={'/products/new' as '/'}><Plus /> {t('new')}</Link></Button>} />
        <div className="flex flex-wrap gap-2">
          <NativeSelect className="w-44" aria-label={c('type')} value={type} onChange={(e) => setType(e.target.value)}><option value="">{c('type')}: {c('all')}</option>{PRODUCT_TYPES.map((x) => <option key={x} value={x}>{t(`types.${x}`)}</option>)}</NativeSelect>
          <NativeSelect className="w-44" aria-label={t('brand')} value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">{t('brand')}: {c('all')}</option>{brands.data?.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect>
          <NativeSelect className="w-44" aria-label={c('status')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{c('status')}: {c('all')}</option>{['DRAFT', 'ACTIVE', 'ARCHIVED'].map((x) => <option key={x} value={x}>{t(`statuses.${x}`)}</option>)}</NativeSelect>
        </div>
        <DataTable<Row> queryKey="products" endpoint="/products" columns={columns} extraQuery={{ type: type || undefined, brandId: brandId || undefined, status: status || undefined }} />
      </div>
    </RequirePermission>
  );
}
