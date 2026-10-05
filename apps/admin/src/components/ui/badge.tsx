import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', {
  variants: { variant: { default: 'bg-primary/10 text-primary border-transparent', secondary: 'bg-secondary text-secondary-foreground border-transparent', success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-transparent', danger: 'bg-destructive/15 text-destructive border-transparent', outline: '' } },
  defaultVariants: { variant: 'default' },
});
export const Badge = ({ className, variant, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) => <span className={cn(badge({ variant }), className)} {...p} />;
