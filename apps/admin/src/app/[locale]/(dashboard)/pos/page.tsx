'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { salesError } from '@/lib/errors';
import { RequirePermission } from '@/components/forbidden';
import { PageHeader } from '@/components/form-field';
import { CartPanel } from './cart-panel';
import { CatalogPanel } from './catalog-panel';
import { CustomerPicker } from './customer-picker';
import { HeldDialog } from './held-dialog';
import { LensDialog } from './lens-dialog';
import { PaymentDialog } from './payment-dialog';
import { OpenRegisterCard, SessionBar, ZReportDialog } from './session-panel';
import type { SessionReport } from './session-report';
import { toApiLines, type CartLine, type ParkedCart, type PosConfig } from './types';
import { useCart } from './use-cart';

function Till() {
  const t = useTranslations('pos');
  const qc = useQueryClient();
  const params = useSearchParams();
  const cart = useCart();
  const [paying, setPaying] = useState(false);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [lensFor, setLensFor] = useState<CartLine | null>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [zReport, setZReport] = useState<SessionReport | null>(null);

  const config = useQuery({ queryKey: ['pos-config'], queryFn: () => api<PosConfig>('/pos/config') });
  const current = useQuery({ queryKey: ['pos-current'], queryFn: () => api<{ session: { id: string } | null; report: SessionReport | null }>('/pos/sessions/current'), refetchInterval: 60_000 });
  const held = useQuery({ queryKey: ['pos-held'], queryFn: () => api<unknown[]>('/pos/held') });

  // arrive from the quotes page: /pos?quote=<id> loads that quote into the till
  const loadedQuote = useRef<string | null>(null);
  useEffect(() => {
    const id = params.get('quote');
    if (!id || loadedQuote.current === id) return;
    loadedQuote.current = id;
    api<{ quoteId: string; number: string; customerId: string | null; lines: CartLine[] }>(`/quotes/${id}/cart`).then(async (q) => {
      const customer = q.customerId ? await api<{ id: string; firstName: string; lastName: string; phone: string | null }>(`/customers/${q.customerId}`).catch(() => null) : null;
      cart.load({ customer, lines: q.lines.map((l) => ({ ...l, key: '' })) });
      setQuoteId(q.quoteId);
      toast.success(t('quote.loaded', { number: q.number }));
    }).catch((e) => toast.error(salesError(e, t)));
  }, [params, cart, t]);

  const park = useMutation({
    mutationFn: () => api('/pos/held', { method: 'POST', body: { label: cart.customer ? `${cart.customer.firstName} ${cart.customer.lastName}` : undefined, cart: cart.snapshot() } }),
    onSuccess: () => { toast.success(t('parked.saved')); cart.clear(); setQuoteId(null); qc.invalidateQueries({ queryKey: ['pos-held'] }); },
    onError: (e) => toast.error(salesError(e, t)),
  });
  const quote = useMutation({
    mutationFn: () => api<{ id: string; number: string }>('/quotes', { method: 'POST', body: { customerId: cart.customer?.id, lines: toApiLines(cart.lines) } }),
    onSuccess: (q) => { toast.success(t('quote.saved', { number: q.number })); cart.clear(); setQuoteId(null); qc.invalidateQueries({ queryKey: ['quotes'] }); },
    onError: (e) => toast.error(salesError(e, t)),
  });

  const newSale = () => { setPaying(false); cart.clear(); setQuoteId(null); loadedQuote.current = params.get('quote'); };

  if (config.isLoading || current.isLoading) return <p className="text-muted-foreground">…</p>;
  if (config.error) return <p className="text-destructive">{(config.error as Error).message}</p>;
  const cfg = config.data!;
  const report = current.data?.report ?? null;
  const needSession = cfg.settings.requireOpenSession && !report;
  if (needSession) return <><PageHeader title={t('title')} /><OpenRegisterCard config={cfg} /><ZReportDialog report={zReport} onClose={() => setZReport(null)} /></>;

  return (
    <div className="space-y-3">
      {report ? <SessionBar report={report} onParked={() => setHeldOpen(true)} parkedCount={held.data?.length ?? 0} onClosed={setZReport} /> : <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">{t('session.none')}</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <section aria-label={t('catalog')}><CatalogPanel onAdd={(id, name) => cart.add(id, name)} /></section>
        <div className="lg:sticky lg:top-16 lg:h-[calc(100vh-9rem)]">
          <CartPanel
            lines={cart.lines} customer={cart.customer} priced={cart.priced} priceError={cart.priceError} pending={cart.pending}
            onQty={cart.setQty} onRemove={cart.remove} onDiscount={cart.setDiscount}
            onLens={(l) => { if (!cart.customer) { toast.info(t('lens.needCustomer')); setPickCustomer(true); setLensFor(l); } else setLensFor(l); }}
            onCustomer={() => setPickCustomer(true)} onClearCustomer={() => cart.setCustomer(null)}
            onPay={() => setPaying(true)} onPark={() => park.mutate()} onQuote={() => quote.mutate()} onClear={() => { cart.clear(); setQuoteId(null); }}
          />
        </div>
      </div>

      <ZReportDialog report={zReport} onClose={() => setZReport(null)} />
      <CustomerPicker open={pickCustomer} onClose={() => setPickCustomer(false)} onPick={cart.setCustomer} />
      <LensDialog open={!!lensFor && !!cart.customer} onClose={() => setLensFor(null)} customer={cart.customer} initial={lensFor?.lens}
        onSave={(lens, label) => lensFor && cart.setLens(lensFor.key, lens, label)} />
      <HeldDialog open={heldOpen} onClose={() => setHeldOpen(false)} onResume={(c: ParkedCart) => { cart.load(c); setQuoteId(null); }} />
      {paying && cart.priced && <PaymentDialog open cart={cart.priced} lines={cart.lines} customer={cart.customer} config={cfg} quoteId={quoteId} onClose={() => setPaying(false)} onFinished={newSale} />}
    </div>
  );
}

export default function PosPage() {
  const t = useTranslations('pos');
  return (
    <RequirePermission permission="pos:access">
      <Suspense fallback={null}>
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h1 className="sr-only">{t('title')}</h1><Link href={'/orders' as '/'} className="ms-auto text-sm text-primary hover:underline">{t('viewOrders')} →</Link></div>
          <Till />
        </div>
      </Suspense>
    </RequirePermission>
  );
}
