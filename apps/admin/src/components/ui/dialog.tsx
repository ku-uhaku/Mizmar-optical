'use client';
import * as React from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;
export const DialogTitle = ({ className, ...p }: React.ComponentProps<typeof D.Title>) => <D.Title className={cn('text-lg font-semibold', className)} {...p} />;
export const DialogDescription = ({ className, ...p }: React.ComponentProps<typeof D.Description>) => <D.Description className={cn('text-sm text-muted-foreground', className)} {...p} />;

export function DialogContent({ className, children, ...p }: React.ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <D.Content className={cn('fixed start-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-y-1/2 gap-4 rounded-lg border bg-card p-6 shadow-lg ltr:-translate-x-1/2 rtl:translate-x-1/2', className)} {...p}>
        {children}
        <D.Close className="absolute end-4 top-4 rounded-sm opacity-70 hover:opacity-100" aria-label="Close"><X className="size-4" /></D.Close>
      </D.Content>
    </D.Portal>
  );
}
