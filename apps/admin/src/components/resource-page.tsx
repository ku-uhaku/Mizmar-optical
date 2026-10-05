'use client';
import { useState } from 'react';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DataTable, type Column } from '@/components/data-table';
import { Field } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'checkbox' | 'select' | 'textarea' | 'multiselect';
  required?: boolean;
  step?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  /** Load select options from a list endpoint. */
  optionsFrom?: { endpoint: string; label?: string };
  span?: 1 | 2;
  /** Only editable when creating (e.g. immutable codes). */
  createOnly?: boolean;
  /** Initial value when editing (needed when the API shape differs from the form shape, e.g. multiselect ids). */
  initial?: (row: any) => unknown;
}

type Row = { id: string; [k: string]: any };

function OptionsSelect({ def, ...rest }: { def: FieldDef } & React.ComponentProps<typeof NativeSelect>) {
  const { data } = useQuery({
    queryKey: ['options', def.optionsFrom?.endpoint], enabled: !!def.optionsFrom,
    queryFn: () => api<Paginated<Row>>(def.optionsFrom!.endpoint, { query: { limit: 100 } }), staleTime: 60_000,
  });
  const opts = def.options ?? data?.data.map((r) => ({ value: r.id, label: r[def.optionsFrom?.label ?? 'name'] })) ?? [];
  return <NativeSelect {...rest}><option value="">—</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>;
}

function MultiCheck({ def, control, onChange }: { def: FieldDef; control: Control<Record<string, any>>; onChange: (v: string[]) => void }) {
  const value: string[] = useWatch({ control, name: def.name }) ?? [];
  const { data } = useQuery({ queryKey: ['options', def.optionsFrom?.endpoint], enabled: !!def.optionsFrom, queryFn: () => api<Paginated<Row>>(def.optionsFrom!.endpoint, { query: { limit: 100 } }), staleTime: 60_000 });
  const opts = def.options ?? data?.data.map((r) => ({ value: r.id, label: r[def.optionsFrom?.label ?? 'name'] })) ?? [];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border p-3" role="group">
      {opts.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={value.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))} /> {o.label}
        </label>
      ))}
    </div>
  );
}

/**
 * Config-driven list + create/edit dialog + delete for simple reference tables (brands, lens types, insurers…).
 * Everything the API validates is surfaced: field errors from a 400 are shown under the matching input.
 */
export function ResourcePage({ queryKey, endpoint, module, columns, fields, defaults = {}, title, searchable = true, extraQuery }: {
  queryKey: string; endpoint: string; module: string; columns: Column<Row>[]; fields: FieldDef[]; defaults?: Record<string, unknown>; title: string; searchable?: boolean; extraQuery?: Record<string, string | undefined>;
}) {
  const c = useTranslations('common');
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const isNew = editing === 'new';
  const form = useForm<Record<string, any>>();

  const open = (row: Row | 'new') => {
    setEditing(row);
    const blank = (f: FieldDef) => (f.type === 'checkbox' ? false : f.type === 'multiselect' ? [] : '');
    form.reset(row === 'new' ? { ...Object.fromEntries(fields.map((f) => [f.name, blank(f)])), ...defaults } : Object.fromEntries(fields.map((f) => [f.name, f.initial ? f.initial(row) : (row[f.name] ?? blank(f))])));
  };

  const save = useMutation({
    mutationFn: (values: Record<string, any>) => {
      const body: Record<string, unknown> = {};
      for (const f of fields) {
        if (f.createOnly && !isNew) continue;
        const v = values[f.name];
        if (f.type === 'checkbox') body[f.name] = !!v;
        else if (f.type === 'multiselect') body[f.name] = v ?? [];
        else if (f.type === 'number') { if (v === '' || v == null || Number.isNaN(v)) { if (!isNew) body[f.name] = null; } else body[f.name] = Number(v); }
        else if (v === '' || v == null) { if (!isNew) body[f.name] = null; } // clearing an optional field on edit
        else body[f.name] = v;
      }
      return isNew ? api(endpoint, { method: 'POST', body }) : api(`${endpoint}/${(editing as Row).id}`, { method: 'PATCH', body });
    },
    onSuccess: () => { toast.success(c('saved')); qc.invalidateQueries({ queryKey: [queryKey] }); qc.invalidateQueries({ queryKey: ['options'] }); setEditing(null); },
    onError: (e) => {
      const details = e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]).join(' · ') : null;
      toast.error(details ?? (e as Error).message);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`${endpoint}/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success(c('deleted')); qc.invalidateQueries({ queryKey: [queryKey] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const cols: Column<Row>[] = [
    ...columns,
    { header: '', className: 'w-24 text-end', cell: (r) => (
      <div className="flex justify-end gap-1">
        {can(`${module}:update`) && <Button variant="ghost" size="icon" aria-label={c('edit')} onClick={() => open(r)}><Pencil /></Button>}
        {can(`${module}:delete`) && <Button variant="ghost" size="icon" aria-label={c('delete')} onClick={() => confirm(c('confirmDelete')) && remove.mutate(r.id)}><Trash2 className="text-destructive" /></Button>}
      </div>
    ) },
  ];

  return (
    <>
      <DataTable<Row> queryKey={queryKey} endpoint={endpoint} columns={cols} searchable={searchable} extraQuery={extraQuery}
        toolbar={can(`${module}:create`) ? <Button onClick={() => open('new')}><Plus /> {c('add')}</Button> : null} />
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid grid-cols-2 gap-3" noValidate>
            {fields.map((f) => {
              const id = `f-${f.name}`;
              const err = form.formState.errors[f.name]?.message as string | undefined;
              const disabled = f.createOnly && !isNew;
              const reg = form.register(f.name, { required: f.required && !disabled ? c('required') : false, ...(f.type === 'number' ? { valueAsNumber: true } : {}) });
              return (
                <Field key={f.name} id={id} label={f.label} required={f.required} error={err} hint={f.hint} className={f.span === 2 || f.type === 'textarea' ? 'col-span-2' : undefined}>
                  {f.type === 'multiselect' ? <MultiCheck def={f} control={form.control} onChange={(v) => form.setValue(f.name, v, { shouldDirty: true })} />
                    : f.type === 'checkbox' ? <label className="flex items-center gap-2 text-sm"><input id={id} type="checkbox" className="size-4 accent-[var(--primary)]" {...reg} /> {f.hint ?? ''}</label>
                    : f.type === 'select' ? <OptionsSelect id={id} def={f} disabled={disabled} {...reg} />
                    : f.type === 'textarea' ? <Textarea id={id} {...reg} />
                    : <Input id={id} type={f.type === 'number' ? 'number' : 'text'} step={f.step ?? (f.type === 'number' ? 'any' : undefined)} disabled={disabled} aria-invalid={!!err} {...reg} />}
                </Field>
              );
            })}
            <Button type="submit" className="col-span-2" disabled={save.isPending}>{c('save')}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
