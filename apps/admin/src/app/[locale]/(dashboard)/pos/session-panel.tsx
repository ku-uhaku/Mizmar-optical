'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Banknote, DoorClosed, DoorOpen, FileBarChart, PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { salesError } from '@/lib/errors';
import { useFormat } from '@/lib/format';
import { Field } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { SessionReportView, type SessionReport } from './session-report';
import type { PosConfig } from './types';

export function OpenRegisterCard({ config }: { config: PosConfig }) {
  const t = useTranslations('pos');
  const { can } = useAuth();
  const qc = useQueryClient();
  const free = config.registers.filter((r) => !r.openSession);
  const [registerId, setRegisterId] = useState('');
  const [float, setFloat] = useState('');
  const open = useMutation({
    mutationFn: () => api('/pos/sessions', { method: 'POST', body: { registerId: registerId || free[0]?.id, openingFloat: Number(float || 0) } }),
    onSuccess: () => { toast.success(t('session.opened')); qc.invalidateQueries({ queryKey: ['pos-current'] }); qc.invalidateQueries({ queryKey: ['pos-config'] }); },
    onError: (e) => toast.error(salesError(e, t)),
  });
  return (
    <div className="mx-auto max-w-md pt-10">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><DoorOpen className="size-5" /> {t('session.openTitle')}</CardTitle><CardDescription>{t('session.openHint', { store: config.store.name })}</CardDescription></CardHeader>
        <CardContent>
          {!can('pos:manage_register') ? <p className="text-sm text-muted-foreground">{t('session.cannotOpen')}</p> : free.length === 0 ? <p className="text-sm text-muted-foreground">{t('session.noFreeRegister')}</p> : (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); open.mutate(); }}>
              <Field id="reg" label={t('session.register')}><NativeSelect id="reg" value={registerId || free[0].id} onChange={(e) => setRegisterId(e.target.value)}>{free.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</NativeSelect></Field>
              <Field id="float" label={t('session.float')} hint={t('session.floatHint')}><Input id="float" type="number" min={0} step="0.01" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} /></Field>
              <Button type="submit" className="w-full" disabled={open.isPending}>{t('session.open')}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Register controls shown above the till while a session is open. */
export function SessionBar({ report, onParked, parkedCount, onClosed }: { report: SessionReport; onParked: () => void; parkedCount: number; onClosed: (r: SessionReport) => void }) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const f = useFormat();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<'move' | 'report' | 'close' | null>(null);
  const [kind, setKind] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['pos-current'] }); qc.invalidateQueries({ queryKey: ['pos-config'] }); qc.invalidateQueries({ queryKey: ['pos-sessions'] }); };

  const move = useMutation({
    mutationFn: () => api(`/pos/sessions/${report.session.id}/movements`, { method: 'POST', body: { type: kind, amount: Number(amount), reason } }),
    onSuccess: () => { toast.success(c('saved')); setDlg(null); setAmount(''); setReason(''); refresh(); }, onError: (e) => toast.error(salesError(e, t)),
  });
  const close = useMutation({
    mutationFn: () => api<SessionReport>(`/pos/sessions/${report.session.id}/close`, { method: 'POST', body: { countedCash: Number(counted), notes: notes || undefined } }),
    // hand the Z report to the PAGE: closing ends the session, which unmounts this bar, and the report must outlive it
    onSuccess: (r) => { setDlg(null); refresh(); onClosed(r); }, onError: (e) => toast.error(salesError(e, t)),
  });
  const canManage = can('pos:manage_register');

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
        <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" aria-hidden /> <span className="font-medium">{report.session.register.name}</span></span>
        <span className="text-muted-foreground">{t('session.since', { time: f.dateTime(report.session.openedAt) })}</span>
        <span className="text-muted-foreground">· {t('session.cashNow')}: <span className="font-medium text-foreground">{f.money(report.cash.expected)}</span></span>
        <div className="ms-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={onParked}><PauseCircle /> {t('parked.title')}{parkedCount > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{parkedCount}</span>}</Button>
          {canManage && <Button size="sm" variant="outline" onClick={() => setDlg('move')}><Banknote /> {t('session.cashMovement')}</Button>}
          <Button size="sm" variant="outline" onClick={() => setDlg('report')}><FileBarChart /> {t('report.x')}</Button>
          {canManage && <Button size="sm" variant="outline" onClick={() => { setCounted(''); setDlg('close'); }}><DoorClosed /> {t('session.close')}</Button>}
        </div>
      </div>

      <Dialog open={dlg === 'move'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent><DialogTitle>{t('session.cashMovement')}</DialogTitle><DialogDescription>{t('session.cashMovementHint')}</DialogDescription>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); move.mutate(); }}>
            <div className="grid grid-cols-2 gap-2">{(['CASH_IN', 'CASH_OUT'] as const).map((k) => <Button key={k} type="button" variant={kind === k ? 'default' : 'outline'} onClick={() => setKind(k)}>{t(`session.${k}`)}</Button>)}</div>
            <Field id="mv-amount" label={c('price')} required><Input id="mv-amount" type="number" min={0.01} step="0.01" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field id="mv-reason" label={c('reason')} required><Input id="mv-reason" required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Button type="submit" className="w-full" disabled={move.isPending}>{c('save')}</Button>
          </form></DialogContent>
      </Dialog>
      <Dialog open={dlg === 'report'} onOpenChange={(o) => !o && setDlg(null)}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"><DialogTitle>{t('report.x')}</DialogTitle><DialogDescription className="sr-only">{t('report.x')}</DialogDescription><SessionReportView report={report} /></DialogContent></Dialog>
      <Dialog open={dlg === 'close'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent><DialogTitle>{t('session.close')}</DialogTitle><DialogDescription>{t('session.closeHint')}</DialogDescription>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); close.mutate(); }}>
            <div className="rounded-md bg-muted p-3 text-sm">{t('report.expected')}: <span className="font-semibold">{f.money(report.cash.expected)}</span></div>
            <Field id="cl-counted" label={t('session.counted')} required hint={t('session.countedHint')}><Input id="cl-counted" type="number" min={0} step="0.01" inputMode="decimal" required autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
            {counted !== '' && <p className={`text-sm font-medium ${Number(counted) === report.cash.expected ? 'text-emerald-600' : 'text-amber-600'}`}>{t('report.variance')}: {f.money(Number(counted) - report.cash.expected)}</p>}
            <Field id="cl-notes" label={c('notes')}><Input id="cl-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Button type="submit" className="w-full" disabled={close.isPending || counted === ''}>{t('session.closeConfirm')}</Button>
          </form></DialogContent>
      </Dialog>
    </>
  );
}

/** The closing (Z) report. Rendered by the page, not the session bar, so it stays up after the session ends and the bar disappears. */
export function ZReportDialog({ report, onClose }: { report: SessionReport | null; onClose: () => void }) {
  const t = useTranslations('pos');
  return (
    <Dialog open={!!report} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"><DialogTitle>{t('report.z')}</DialogTitle><DialogDescription className="sr-only">{t('report.z')}</DialogDescription>{report && <SessionReportView report={report} />}</DialogContent>
    </Dialog>
  );
}
