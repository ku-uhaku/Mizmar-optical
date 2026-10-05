'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check, Scale, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { ResourcePage, type FieldDef } from '@/components/resource-page';
import type { Column } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

type Row = { id: string; [k: string]: any };
interface Statement { supplier: { name: string }; totals: { invoiced: number; paid: number; balance: number; overdue: number }; invoices: { id: string; number: string; supplierRef: string; issuedAt: string; dueAt: string | null; total: number; paidTotal: number; status: string; isOverdue: boolean }[] }

function StatementDialog({ supplier, onClose }: { supplier: Row | null; onClose: () => void }) {
  const t = useTranslations('work');
  const f = useFormat();
  const { data } = useQuery({ queryKey: ['supplier-statement', supplier?.id], enabled: !!supplier, queryFn: () => api<Statement>(`/suppliers/${supplier!.id}/statement`) });
  return (
    <Dialog open={!!supplier} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>{t('suppliers.statement')} — {supplier?.name}</DialogTitle>
        <DialogDescription className="sr-only">{t('suppliers.statement')}</DialogDescription>
        {data && (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {(['invoiced', 'paid', 'balance', 'overdue'] as const).map((k) => <div key={k} className="rounded-md border p-2"><dt className="text-xs text-muted-foreground">{t(`suppliers.${k}`)}</dt><dd className={k === 'overdue' && data.totals.overdue > 0 ? 'font-semibold text-destructive' : 'font-semibold'}>{f.money(data.totals[k])}</dd></div>)}
            </dl>
            <Table>
              <THead><TR><TH>{t('payables.number')}</TH><TH>{t('payables.supplierRef')}</TH><TH>{t('payables.dueAt')}</TH><TH>{t('payables.balance')}</TH></TR></THead>
              <TBody>
                {data.invoices.length === 0 && <TR><TD colSpan={4} className="text-center text-muted-foreground">—</TD></TR>}
                {data.invoices.map((i) => <TR key={i.id}><TD className="font-mono text-xs">{i.number}</TD><TD>{i.supplierRef}</TD><TD>{f.date(i.dueAt)} {i.isOverdue && <Badge variant="danger">{t('payables.overdue')}</Badge>}</TD><TD>{f.money(i.total - i.paidTotal)}</TD></TR>)}
              </TBody>
            </Table>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function SuppliersPage() {
  const t = useTranslations('work');
  const c = useTranslations('common');
  const { can } = useAuth();
  const [stmt, setStmt] = useState<Row | null>(null);
  const name: Column<Row> = { header: c('name'), cell: (r) => <span className="font-medium">{r.name}</span> };
  const cols: Column<Row>[] = [
    { header: c('code'), cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    name,
    { header: t('suppliers.contact'), cell: (r) => [r.contactName, r.phone].filter(Boolean).join(' · ') || '—', className: 'hidden md:table-cell' },
    { header: t('suppliers.terms'), cell: (r) => t('suppliers.days', { n: r.paymentTermsDays }), className: 'hidden lg:table-cell' },
    { header: t('suppliers.lab'), cell: (r) => (r.isLensLab ? <Badge>{t('suppliers.lab')}</Badge> : '—'), className: 'hidden sm:table-cell' },
    { header: c('status'), cell: (r) => (r.isActive ? <Check className="size-4 text-emerald-600" aria-label={c('active')} /> : <X className="size-4 text-muted-foreground" aria-label={c('inactive')} />), className: 'w-16' },
    ...(can('finance:read') ? [{ header: '', className: 'w-12', cell: (r: Row) => <Button variant="ghost" size="icon" aria-label={t('suppliers.statement')} onClick={() => setStmt(r)}><Scale /></Button> }] : []),
  ];
  const fields: FieldDef[] = [
    { name: 'code', label: c('code'), required: true, createOnly: true, hint: 'SUP-ESSILOR' }, { name: 'name', label: c('name'), required: true },
    { name: 'contactName', label: t('suppliers.contact') }, { name: 'phone', label: t('suppliers.phone') }, { name: 'email', label: t('suppliers.email') }, { name: 'taxId', label: t('suppliers.taxId') },
    { name: 'address', label: t('suppliers.address'), span: 2 }, { name: 'city', label: t('suppliers.city') }, { name: 'paymentTermsDays', label: t('suppliers.terms'), type: 'number', step: '1' },
    { name: 'isLensLab', label: t('suppliers.lab'), type: 'checkbox', hint: t('suppliers.labHint') }, { name: 'isActive', label: c('status'), type: 'checkbox', hint: c('active') },
    { name: 'notes', label: c('notes'), type: 'textarea' },
  ];
  return (
    <RequirePermission permission="suppliers:read">
      <div className="space-y-4">
        <PageHeader title={t('suppliers.title')} />
        <ResourcePage queryKey="suppliers" endpoint="/suppliers" module="suppliers" title={t('suppliers.title')} columns={cols} fields={fields} defaults={{ paymentTermsDays: 30, isActive: true }} />
        <StatementDialog supplier={stmt} onClose={() => setStmt(null)} />
      </div>
    </RequirePermission>
  );
}
