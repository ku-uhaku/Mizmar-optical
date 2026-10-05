'use client';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const t = useTranslations('common');
  useEffect(() => { if (status === 'unauthenticated') router.replace('/login'); }, [status, router]);

  if (status !== 'authenticated') return <div className="grid min-h-screen place-items-center text-muted-foreground">{t('loading')}</div>;
  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:block"><div className="sticky top-0 h-screen"><Sidebar /></div></div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
