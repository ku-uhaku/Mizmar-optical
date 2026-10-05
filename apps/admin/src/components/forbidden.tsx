'use client';
import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';

/** Page-level permission gate. The API enforces permissions regardless; this only avoids dead-end screens. */
export function RequirePermission({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { can } = useAuth();
  const t = useTranslations('common');
  if (can(permission)) return <>{children}</>;
  return <div className="grid place-items-center gap-2 py-24 text-muted-foreground"><ShieldAlert className="size-8" /><p>{t('forbidden')}</p></div>;
}
