'use client';
import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ImagePlus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Img { id: string; url: string; alt: string | null; isPrimary: boolean }

export function ImagesPanel({ productId, images }: { productId: string; images: Img[] }) {
  const t = useTranslations('products');
  const c = useTranslations('common');
  const { can } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['product', productId] }); qc.invalidateQueries({ queryKey: ['products'] }); };

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const media = await apiUpload<{ url: string }>('/media', file, { folder: 'products' });
        await api(`/products/${productId}/images`, { method: 'POST', body: { url: media.url, alt: file.name.replace(/\.[^.]+$/, '') } });
      }
    },
    onSuccess: () => { toast.success(c('saved')); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const primary = useMutation({ mutationFn: (id: string) => api(`/products/images/${id}/primary`, { method: 'POST' }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/products/images/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e) => toast.error((e as Error).message) });
  const canWrite = can('products:update') && can('media:upload');

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('images')}</CardTitle>
        {canWrite && <>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden data-testid="image-input" onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) upload.mutate(files); }} />
          <Button variant="outline" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}><ImagePlus /> {t('uploadImages')}</Button>
        </>}
      </CardHeader>
      <CardContent>
        {images.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t('noImages')}</p> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {images.map((im) => (
              <li key={im.id} className="group relative overflow-hidden rounded-md border">
                <img src={im.url} alt={im.alt ?? ''} className="aspect-square w-full object-cover" />
                {im.isPrimary && <Badge className="absolute start-2 top-2 bg-background/90">{t('primary')}</Badge>}
                {canWrite && (
                  <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {!im.isPrimary && <Button size="icon" variant="secondary" className="size-7" aria-label={t('makePrimary')} onClick={() => primary.mutate(im.id)}><Star /></Button>}
                    <Button size="icon" variant="destructive" className="size-7" aria-label={c('delete')} onClick={() => confirm(c('confirmDelete')) && remove.mutate(im.id)}><Trash2 /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
