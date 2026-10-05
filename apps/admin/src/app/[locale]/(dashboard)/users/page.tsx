'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, ApiError, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DataTable, type Column } from '@/components/data-table';
import { RequirePermission } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface UserRow { id: string; email: string; firstName: string; lastName: string; status: string; roles: { id: string; name: string }[]; stores: { id: string; name: string }[]; lastLoginAt: string | null }
interface RoleRow { id: string; name: string }

const formSchema = z.object({
  firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email(), password: z.string().min(8),
  roleId: z.string().optional(), storeId: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

function CreateUserDialog() {
  const t = useTranslations('users');
  const c = useTranslations('common');
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(formSchema) });
  const roles = useQuery({ queryKey: ['roles-options'], queryFn: () => api<Paginated<RoleRow>>('/roles', { query: { limit: 100 } }), enabled: open && can('roles:read') });

  const create = useMutation({
    mutationFn: (v: FormValues) => api('/users', { method: 'POST', body: { firstName: v.firstName, lastName: v.lastName, email: v.email, password: v.password, roleIds: v.roleId ? [v.roleId] : [], storeIds: v.storeId ? [v.storeId] : [] } }),
    onSuccess: () => { toast.success(t('created')); qc.invalidateQueries({ queryKey: ['users'] }); reset(); setOpen(false); },
    onError: (e) => toast.error(e instanceof ApiError && e.code === 'EMAIL_TAKEN' ? t('emailTaken') : (e as Error).message),
  });

  if (!can('users:create')) return null;
  const field = (name: keyof FormValues, label: string, type = 'text') => (
    <div className="space-y-1.5"><Label htmlFor={name}>{label}</Label><Input id={name} type={type} {...register(name)} aria-invalid={!!errors[name]} />{errors[name] && <p className="text-xs text-destructive">{c('invalidField')}</p>}</div>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> {t('new')}</Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('new')}</DialogTitle>
        <DialogDescription>{t('newHint')}</DialogDescription>
        <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-3" noValidate>
          <div className="grid grid-cols-2 gap-3">{field('firstName', t('firstName'))}{field('lastName', t('lastName'))}</div>
          {field('email', t('email'), 'email')}
          {field('password', t('password'), 'password')}
          <div className="grid grid-cols-2 gap-3">
            {roles.data && <div className="space-y-1.5"><Label htmlFor="roleId">{t('role')}</Label><NativeSelect id="roleId" {...register('roleId')}><option value="">—</option>{roles.data.data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</NativeSelect></div>}
            {user && user.stores.length > 0 && <div className="space-y-1.5"><Label htmlFor="storeId">{t('store')}</Label><NativeSelect id="storeId" {...register('storeId')}><option value="">—</option>{user.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></div>}
          </div>
          <Button type="submit" className="w-full" disabled={create.isPending}>{c('save')}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const t = useTranslations('users');
  const c = useTranslations('common');
  const { can, user: me } = useAuth();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success(t('deleted')); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const columns: Column<UserRow>[] = [
    { header: t('name'), cell: (u) => <div><div className="font-medium">{u.firstName} {u.lastName}</div><div className="text-xs text-muted-foreground">{u.email}</div></div> },
    { header: t('roles'), cell: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.id}>{r.name}</Badge>)}</div> },
    { header: t('stores'), cell: (u) => u.stores.map((s) => s.name).join(', ') || '—', className: 'hidden md:table-cell' },
    { header: c('status'), cell: (u) => <Badge variant={u.status === 'ACTIVE' ? 'success' : 'danger'}>{u.status}</Badge> },
    { header: '', className: 'w-12', cell: (u) => can('users:delete') && u.id !== me?.id ? (
      <Button variant="ghost" size="icon" aria-label={c('delete')} onClick={() => confirm(t('confirmDelete', { name: u.firstName })) && remove.mutate(u.id)}><Trash2 className="text-destructive" /></Button>
    ) : null },
  ];

  return (
    <RequirePermission permission="users:read">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <DataTable<UserRow> queryKey="users" endpoint="/users" columns={columns} toolbar={<CreateUserDialog />} />
      </div>
    </RequirePermission>
  );
}
