'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { workError } from '@/lib/work-errors';
import { DataTable, type Column } from '@/components/data-table';
import { Field } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';

interface Emp { id: string; employeeNumber: string; firstName: string; lastName: string; position: string | null; department: string | null; status: string; hireDate: string | null; email: string | null; phone: string | null; userId: string | null; contracts?: Contract[]; bankIban?: string | null; socialSecurityNo?: string | null }
interface Contract { id: string; type: string; startDate: string; endDate: string | null; baseSalary: number; isActive: boolean }
const tone = (s: string) => (s === 'ACTIVE' ? 'success' : s === 'TERMINATED' ? 'danger' : 'secondary') as 'success' | 'danger' | 'secondary';
const day = (d: string | null) => (d ? d.slice(0, 10) : '');

function EmployeeDialog({ id, onClose }: { id: string | 'new' | null; onClose: () => void }) {
  const t = useTranslations('hr');
  const w = useTranslations('work');
  const c = useTranslations('common');
  const f = useFormat();
  const { can, storeId } = useAuth();
  const qc = useQueryClient();
  const isNew = id === 'new';
  const { data: emp } = useQuery({ queryKey: ['employee', id], enabled: !!id && !isNew, queryFn: () => api<Emp>(`/employees/${id}`) });
  const { data: users } = useQuery({ queryKey: ['hr-users'], enabled: !!id && can('users:read'), queryFn: () => api<Paginated<{ id: string; firstName: string; lastName: string; email: string }>>('/users', { query: { limit: 100 } }) });
  const [form, setForm] = useState<Record<string, string>>({});
  const [contract, setContract] = useState({ type: 'CDI', startDate: new Date().toISOString().slice(0, 10), endDate: '', baseSalary: '' });
  const val = (k: keyof Emp & string) => form[k] ?? (isNew ? '' : String((emp as Emp | undefined)?.[k] ?? '').slice(0, k.endsWith('Date') ? 10 : 200));
  const refresh = () => { qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['employee', id] }); };
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const k of ['firstName', 'lastName', 'position', 'department', 'phone', 'email', 'nationalId', 'socialSecurityNo', 'bankIban', 'hireDate', 'userId']) if (form[k] !== undefined) body[k] = form[k] === '' ? undefined : form[k];
      if (isNew) body.storeId = storeId ?? undefined;
      return api(isNew ? '/employees' : `/employees/${id}`, { method: isNew ? 'POST' : 'PATCH', body });
    },
    onSuccess: () => { toast.success(c('saved')); setForm({}); refresh(); if (isNew) onClose(); }, onError: (e) => toast.error(workError(e, w)),
  });
  const addContract = useMutation({
    mutationFn: () => api(`/employees/${id}/contracts`, { method: 'POST', body: { type: contract.type, startDate: contract.startDate, endDate: contract.endDate || undefined, baseSalary: Number(contract.baseSalary) } }),
    onSuccess: () => { toast.success(c('saved')); setContract({ ...contract, baseSalary: '' }); refresh(); }, onError: (e) => toast.error(workError(e, w)),
  });
  const terminate = useMutation({ mutationFn: () => api(`/employees/${id}`, { method: 'PATCH', body: { status: 'TERMINATED' } }), onSuccess: () => { toast.success(c('saved')); refresh(); }, onError: (e) => toast.error(workError(e, w)) });
  const input = (k: string, label: string, type = 'text') => <Field id={`e-${k}`} label={label}><Input id={`e-${k}`} type={type} value={val(k as never)} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>;

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>{isNew ? t('newEmployee') : `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`} {emp && <Badge variant={tone(emp.status)}>{t(`status.${emp.status}`)}</Badge>}</DialogTitle>
        <DialogDescription>{emp?.employeeNumber ?? t('numberGenerated')}</DialogDescription>
        <div className="grid grid-cols-2 gap-3">
          {input('firstName', t('firstName'))}{input('lastName', t('lastName'))}{input('position', t('position'))}{input('department', t('department'))}
          {input('email', 'Email', 'email')}{input('phone', t('phone'))}{input('hireDate', t('hireDate'), 'date')}
          {can('hr:payroll') && <>{input('socialSecurityNo', t('cnss'))}{input('bankIban', 'IBAN')}</>}
          {can('users:read') && <Field id="e-user" label={t('login')} hint={t('loginHint')} className="col-span-2"><NativeSelect id="e-user" value={val('userId')} onChange={(e) => setForm({ ...form, userId: e.target.value })}><option value="">—</option>{users?.data.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.email})</option>)}</NativeSelect></Field>}
        </div>
        <div className="flex gap-2"><Button disabled={save.isPending || Object.keys(form).length === 0 || (isNew && !(form.firstName && form.lastName))} onClick={() => save.mutate()}>{c('save')}</Button>
          {!isNew && emp?.status !== 'TERMINATED' && can('hr:update') && <Button variant="outline" onClick={() => confirm(t('confirmTerminate')) && terminate.mutate()}>{t('terminate')}</Button>}</div>
        {!isNew && emp?.contracts && (
          <div className="space-y-3 border-t pt-3">
            <h3 className="font-medium">{t('contracts')}</h3>
            <ul className="divide-y rounded-md border text-sm">{emp.contracts.map((k) => <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 p-2"><span><b>{k.type}</b> · {day(k.startDate)} → {day(k.endDate) || '…'}</span><span>{f.money(Number(k.baseSalary))} {k.isActive && <Badge variant="success">{t('current')}</Badge>}</span></li>)}</ul>
            {can('hr:payroll') && emp.status !== 'TERMINATED' && (
              <div className="grid grid-cols-4 items-end gap-2">
                <Field id="k-type" label={c('type')}><NativeSelect id="k-type" value={contract.type} onChange={(e) => setContract({ ...contract, type: e.target.value })}>{['CDI', 'CDD', 'ANAPEC', 'INTERNSHIP', 'FREELANCE'].map((x) => <option key={x}>{x}</option>)}</NativeSelect></Field>
                <Field id="k-start" label={t('startDate')}><Input id="k-start" type="date" value={contract.startDate} onChange={(e) => setContract({ ...contract, startDate: e.target.value })} /></Field>
                <Field id="k-end" label={t('endDate')}><Input id="k-end" type="date" value={contract.endDate} onChange={(e) => setContract({ ...contract, endDate: e.target.value })} /></Field>
                <Field id="k-salary" label={t('grossSalary')}><Input id="k-salary" type="number" min={0} step="0.01" value={contract.baseSalary} onChange={(e) => setContract({ ...contract, baseSalary: e.target.value })} /></Field>
                <Button className="col-span-4" variant="outline" disabled={!contract.baseSalary || addContract.isPending} onClick={() => addContract.mutate()}>{t('addContract')}</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function EmployeesTab() {
  const t = useTranslations('hr');
  const { can } = useAuth();
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const cols: Column<Emp>[] = [
    { header: t('number'), cell: (e) => <span className="font-mono text-xs">{e.employeeNumber}</span> },
    { header: t('name'), cell: (e) => <button className="font-medium underline" onClick={() => setOpen(e.id)}>{e.firstName} {e.lastName}</button> },
    { header: t('position'), cell: (e) => e.position ?? '—', className: 'hidden md:table-cell' }, { header: t('hireDate'), cell: (e) => day(e.hireDate) || '—', className: 'hidden lg:table-cell' },
    { header: t('status.label'), cell: (e) => <Badge variant={tone(e.status)}>{t(`status.${e.status}`)}</Badge> },
  ];
  return (
    <>
      <DataTable<Emp> queryKey="employees" endpoint="/employees" columns={cols} toolbar={can('hr:create') ? <Button onClick={() => setOpen('new')}><Plus /> {t('newEmployee')}</Button> : null} />
      {open && <EmployeeDialog id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
