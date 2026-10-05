'use client';
import type { ReactNode } from 'react';
import { Toaster } from './toaster';
import { AuthProvider } from '@/lib/auth';

export function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}<Toaster /></AuthProvider>;
}
