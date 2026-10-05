'use client';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { ProductForm } from '../product-form';

export default function NewProductPage() {
  const t = useTranslations('products');
  return (
    <RequirePermission permission="products:create">
      <div className="space-y-4"><PageHeader title={t('new')} /><ProductForm /></div>
    </RequirePermission>
  );
}
