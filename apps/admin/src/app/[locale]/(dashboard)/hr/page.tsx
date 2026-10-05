'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/form-field';
import { RequirePermission } from '@/components/forbidden';
import { Tabs } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import { AttendanceTab } from './attendance';
import { CommissionsTab } from './commissions';
import { EmployeesTab } from './employees';
import { LeaveTab } from './leave';
import { PayrollTab } from './payroll';
import { SettingsTab } from './settings';

type Tab = 'employees' | 'attendance' | 'leave' | 'commissions' | 'payroll' | 'settings';

export default function HrPage() {
  const t = useTranslations('hr');
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('employees');
  const items: { value: Tab; label: string }[] = [
    { value: 'employees', label: t('tabs.employees') }, { value: 'attendance', label: t('tabs.attendance') }, { value: 'leave', label: t('tabs.leave') },
    ...(can('hr:payroll') ? [{ value: 'commissions' as Tab, label: t('tabs.commissions') }, { value: 'payroll' as Tab, label: t('tabs.payroll') }] : []),
    ...(can('hr:update') ? [{ value: 'settings' as Tab, label: t('tabs.settings') }] : []),
  ];
  return (
    <RequirePermission permission="hr:read">
      <div className="space-y-4">
        <PageHeader title={t('title')} />
        <Tabs value={tab} onChange={setTab} items={items} />
        {tab === 'employees' && <EmployeesTab />}
        {tab === 'attendance' && <AttendanceTab />}
        {tab === 'leave' && <LeaveTab />}
        {tab === 'commissions' && <CommissionsTab />}
        {tab === 'payroll' && <PayrollTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </RequirePermission>
  );
}
