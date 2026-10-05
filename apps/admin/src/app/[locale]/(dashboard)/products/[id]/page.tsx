'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { ProductForm } from '../product-form';
import { ImagesPanel } from './images-panel';
import { VariantsPanel } from './variants-panel';

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('products');
  const c = useTranslations('common');
  const { data: p, isLoading, error } = useQuery({ queryKey: ['product', id], queryFn: () => api<any>(`/products/${id}`) });

  return (
    <RequirePermission permission="products:read">
      <div className="space-y-4">
        <Link href={'/products' as '/'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" /> {t('title')}</Link>
        {isLoading && <p className="text-muted-foreground">{c('loading')}</p>}
        {error && <p className="text-destructive">{(error as Error).message}</p>}
        {p && (<>
          <PageHeader title={p.name} subtitle={[p.brand?.name, t(`types.${p.type}`)].filter(Boolean).join(' · ')} actions={<Badge variant={p.isPublished ? 'success' : 'secondary'}>{p.isPublished ? t('published') : t('unpublished')}</Badge>} />
          <ProductForm key={p.updatedAt} product={p} />
          <VariantsPanel productId={p.id} variants={p.variants} />
          <ImagesPanel productId={p.id} images={p.images} />
        </>)}
      </div>
    </RequirePermission>
  );
}
