import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Label + control + error/hint, with the control wired for accessibility via htmlFor/id. */
export function Field({ id, label, error, hint, required, className, children }: { id: string; label: string; error?: string; hint?: string; required?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div><h1 className="text-2xl font-semibold">{title}</h1>{subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}</div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
);

export const StatCard = ({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'warn' | 'danger' }) => (
  <div className="rounded-lg border bg-card p-4">
    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className={cn('mt-1 text-2xl font-semibold', tone === 'warn' && 'text-amber-600 dark:text-amber-400', tone === 'danger' && 'text-destructive')}>{value}</p>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);
