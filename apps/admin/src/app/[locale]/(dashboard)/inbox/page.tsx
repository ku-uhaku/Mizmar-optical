'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';

interface Review { id: string; rating: number; title: string | null; body: string | null; authorName: string | null; status: string; createdAt: string; product: { name: string } }
interface Msg { id: string; name: string; email: string; phone: string | null; subject: string | null; message: string; status: string; createdAt: string }

function Reviews() {
  const t = useTranslations('shopAdmin');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const decide = useMutation({ mutationFn: (a: { id: string; d: 'approve' | 'reject' }) => api(`/reviews/${a.id}/${a.d}`, { method: 'POST' }), onSuccess: () => { toast.success(t('inbox.done')); qc.invalidateQueries({ queryKey: ['reviews'] }); }, onError: (e) => toast.error((e as Error).message) });
  const cols: Column<Review>[] = [
    { header: t('inbox.product'), cell: (r) => r.product.name }, { header: t('inbox.rating'), cell: (r) => '★'.repeat(r.rating) },
    { header: t('inbox.review'), cell: (r) => <span><b>{r.title}</b> {r.body}<span className="block text-xs text-muted-foreground">{r.authorName} · {f.date(r.createdAt)}</span></span> },
    { header: '', className: 'w-48', cell: (r) => can('cms:publish') && r.status === 'PENDING' ? <div className="flex gap-1"><Button size="sm" onClick={() => decide.mutate({ id: r.id, d: 'approve' })}>{t('inbox.approve')}</Button><Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, d: 'reject' })}>{t('inbox.reject')}</Button></div> : <Badge variant="secondary">{t(`inbox.reviewStatus.${r.status}`)}</Badge> },
  ];
  return <DataTable<Review> queryKey="reviews" endpoint="/reviews" columns={cols} searchable={false} extraQuery={{ status }}
    toolbar={<select aria-label={t('inbox.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">{['PENDING', 'APPROVED', 'REJECTED'].map((s) => <option key={s} value={s}>{t(`inbox.reviewStatus.${s}`)}</option>)}</select>} />;
}

function Messages() {
  const t = useTranslations('shopAdmin');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('NEW');
  const set = useMutation({ mutationFn: (a: { id: string; status: string }) => api(`/contact-messages/${a.id}/status`, { method: 'POST', body: { status: a.status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }), onError: (e) => toast.error((e as Error).message) });
  const cols: Column<Msg>[] = [
    { header: t('inbox.from'), cell: (m) => <span><b>{m.name}</b><span className="block text-xs text-muted-foreground"><a href={`mailto:${m.email}`} className="underline">{m.email}</a>{m.phone ? ` · ${m.phone}` : ''} · {f.dateTime(m.createdAt)}</span></span> },
    { header: t('inbox.message'), cell: (m) => <span>{m.subject && <b>{m.subject}: </b>}{m.message}</span> },
    { header: '', className: 'w-44', cell: (m) => can('cms:update') ? <select aria-label={t('inbox.status')} value={m.status} onChange={(e) => set.mutate({ id: m.id, status: e.target.value })} className="h-8 rounded-md border bg-background px-2 text-sm">{['NEW', 'READ', 'REPLIED', 'SPAM'].map((s) => <option key={s} value={s}>{t(`inbox.messageStatus.${s}`)}</option>)}</select> : null },
  ];
  return <DataTable<Msg> queryKey="messages" endpoint="/contact-messages" columns={cols} searchable={false} extraQuery={{ status }}
    toolbar={<select aria-label={t('inbox.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">{['NEW', 'READ', 'REPLIED', 'SPAM'].map((s) => <option key={s} value={s}>{t(`inbox.messageStatus.${s}`)}</option>)}</select>} />;
}

export default function InboxPage() {
  const t = useTranslations('shopAdmin');
  const [tab, setTab] = useState<'reviews' | 'messages'>('reviews');
  return (
    <RequirePermission permission="cms:read">
      <div className="space-y-4">
        <PageHeader title={t('inbox.title')} />
        <Tabs value={tab} onChange={setTab} items={[{ value: 'reviews', label: t('inbox.reviews') }, { value: 'messages', label: t('inbox.messages') }]} />
        {tab === 'reviews' ? <Reviews /> : <Messages />}
      </div>
    </RequirePermission>
  );
}
