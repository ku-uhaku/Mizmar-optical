'use client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Glasses } from 'lucide-react';
import { toast } from 'sonner';
import { loginSchema, type LoginInput } from '@mizmar/shared';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { login, status } = useAuth();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  useEffect(() => { if (status === 'authenticated') router.replace('/'); }, [status, router]);

  const onSubmit = handleSubmit(async (v) => {
    try { await login(v.email, v.password); router.replace('/'); }
    catch (e) { toast.error(e instanceof ApiError && e.code === 'ACCOUNT_LOCKED' ? t('locked') : t('invalid')); }
  });

  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Glasses className="size-8 text-primary" />
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" autoComplete="username" {...register('email')} aria-invalid={!!errors.email} />
              {errors.email && <p className="text-xs text-destructive">{t('emailInvalid')}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('password')}</Label>
              <Input id="password" type="password" autoComplete="current-password" {...register('password')} aria-invalid={!!errors.password} />
              {errors.password && <p className="text-xs text-destructive">{t('passwordShort')}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>{t('submit')}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
