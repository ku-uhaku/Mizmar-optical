'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Search, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { CustomerLite } from './types';

/** Find a customer by name / phone / code, or create one on the spot (duplicates by phone/email are surfaced, never silently created). */
export function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: CustomerLite) => void }) {
  const t = useTranslations('pos');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{t('customer')}</DialogTitle>
        <DialogDescription>{t('customerHint')}</DialogDescription>
        <PickerBody onClose={onClose} onPick={onPick} />
      </DialogContent>
    </Dialog>
  );
}

// Dialog content unmounts when closed, so this component's state starts fresh on every open: no reset effect needed.
function PickerBody({ onClose, onPick }: { onClose: () => void; onPick: (c: CustomerLite) => void }) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '' });
  const [dupes, setDupes] = useState<CustomerLite[]>([]);
  useEffect(() => { const id = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(id); }, [q]);

  const list = useQuery({ queryKey: ['pos-customers', debounced], queryFn: () => api<Paginated<CustomerLite>>('/customers', { query: { search: debounced, limit: 8 } }) });
  const create = useMutation({
    mutationFn: (allowDuplicate?: boolean) => api<CustomerLite>('/customers', { method: 'POST', body: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim() || undefined, allowDuplicate: allowDuplicate || undefined } }),
    onSuccess: (cust) => { onPick(cust); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.code === 'DUPLICATE_CUSTOMER') setDupes(((e.details as { matches?: CustomerLite[] })?.matches ?? [])); else toast.error((e as Error).message); },
  });

  return (
    <>
        {!creating ? (<>
          <div className="relative"><Search className="pointer-events-none absolute start-3 top-2.5 size-4 text-muted-foreground" /><Input autoFocus className="ps-9" placeholder={c('search')} aria-label={c('search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <ul className="max-h-72 divide-y overflow-auto rounded-md border">
            {list.data?.data.map((x) => (
              <li key={x.id}><button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-accent" onClick={() => { onPick(x); onClose(); }}>
                <span><span className="font-medium">{x.firstName} {x.lastName}</span> <span className="text-xs text-muted-foreground">{x.code}</span></span><span className="text-sm text-muted-foreground" dir="ltr">{x.phone}</span></button></li>
            ))}
            {list.data?.data.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">{c('empty')}</li>}
          </ul>
          {can('customers:create') && <Button variant="outline" onClick={() => { setCreating(true); setForm({ ...form, lastName: debounced }); }}><UserPlus /> {t('newCustomer')}</Button>}
        </>) : (
          <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(false); }}>
            <Input aria-label={t('firstName')} placeholder={t('firstName')} required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            <Input aria-label={t('lastName')} placeholder={t('lastName')} required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            <Input className="col-span-2" type="tel" aria-label={t('phone')} placeholder={t('phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            {dupes.length > 0 && (
              <div role="alert" className="col-span-2 space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">{t('duplicateTitle')}</p>
                {dupes.map((d) => <button key={d.id} type="button" className="block underline" onClick={() => { onPick(d); onClose(); }}>{d.firstName} {d.lastName} {d.phone}</button>)}
                <Button type="button" size="sm" variant="outline" onClick={() => create.mutate(true)}>{t('createAnyway')}</Button>
              </div>
            )}
            <div className="col-span-2 flex gap-2"><Button type="button" variant="ghost" onClick={() => { setCreating(false); setDupes([]); }}>{c('cancel')}</Button><Button type="submit" className="flex-1" disabled={create.isPending}>{c('save')}</Button></div>
          </form>
        )}
    </>
  );
}
