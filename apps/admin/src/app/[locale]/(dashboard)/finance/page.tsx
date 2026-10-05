'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Tabs } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import { CashFlowTab, OverviewTab, PaymentsTab, SetupTab, VatTab } from './tabs';
import { ExpensesTab } from './expenses';

type Tab = 'overview' | 'expenses' | 'cash' | 'vat' | 'payments' | 'setup';

export default function FinancePage() {
  const t = useTranslations('finance');
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <RequirePermission permission="finance:read">
      <div className="space-y-4">
        <PageHeader title={t('title')} />
        <Tabs value={tab} onChange={setTab} items={[{ value: 'overview', label: t('tabs.overview') }, { value: 'expenses', label: t('tabs.expenses') }, { value: 'cash', label: t('tabs.cash') }, { value: 'vat', label: t('tabs.vat') }, ...(can('payments:read') ? [{ value: 'payments' as Tab, label: t('tabs.payments') }] : []), ...(can('finance:update') ? [{ value: 'setup' as Tab, label: t('tabs.setup') }] : [])]} />
        {tab === 'overview' && <OverviewTab />}
        {tab === 'expenses' && <ExpensesTab />}
        {tab === 'cash' && <CashFlowTab />}
        {tab === 'vat' && <VatTab />}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'setup' && <SetupTab />}
      </div>
    </RequirePermission>
  );
}
