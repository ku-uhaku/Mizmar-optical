'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ParkedCart } from './types';

interface Held { id: string; label: string | null; createdAt: string; cart: ParkedCart }

export function HeldDialog({ open, onClose, onResume }: { open: boolean; onClose: () => void; onResume: (cart: ParkedCart) => void }) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const f = useFormat();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['pos-held'], queryFn: () => api<Held[]>('/pos/held'), enabled: open });
  const drop = useMutation({ mutationFn: (id: string) => api(`/pos/held/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-held'] }), onError: (e) => toast.error((e as Error).message) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent><DialogTitle>{t('parked.title')}</DialogTitle><DialogDescription>{t('parked.hint')}</DialogDescription>
        <ul className="max-h-80 divide-y overflow-auto rounded-md border">
          {list.data?.map((h) => (
            <li key={h.id} className="flex items-center gap-2 p-2.5"><div className="min-w-0 flex-1"><div className="truncate font-medium">{h.label || t('parked.untitled')}</div><div className="text-xs text-muted-foreground">{f.dateTime(h.createdAt)} · {t('parked.items', { count: h.cart.lines?.length ?? 0 })}{h.cart.customer ? ` · ${h.cart.customer.firstName} ${h.cart.customer.lastName}` : ''}</div></div>
              <Button size="sm" onClick={() => { onResume(h.cart); drop.mutate(h.id); onClose(); }}><Play /> {t('parked.resume')}</Button>
              <Button variant="ghost" size="icon" aria-label={c('delete')} onClick={() => confirm(c('confirmDelete')) && drop.mutate(h.id)}><Trash2 className="text-destructive" /></Button></li>
          ))}
          {list.data?.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">{t('parked.none')}</li>}
        </ul></DialogContent>
    </Dialog>
  );
}
