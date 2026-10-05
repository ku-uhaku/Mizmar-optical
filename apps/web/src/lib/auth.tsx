'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, session } from './client-api';

export interface Customer { id: string; email: string; firstName: string; lastName: string; locale: string; customerId: string | null; type: string }
interface AuthState { user: Customer | null; ready: boolean; login(email: string, password: string): Promise<void>; register(input: Record<string, unknown>): Promise<void>; logout(): Promise<void> }
const Ctx = createContext<AuthState | null>(null);

type Tokens = { accessToken: string; refreshToken: string; user: Customer };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Customer | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      let me: Customer | null = null;
      if (session.hasRefresh() && (await refreshSession())) me = await api<Customer>('/auth/me').catch(() => null);
      if (me && me.type !== 'CUSTOMER') { session.clear(); me = null; } // a staff token has no business on the storefront
      if (alive) { setUser(me); setReady(true); }
    })();
    return () => { alive = false; };
  }, []);

  const finish = useCallback((t: Tokens) => {
    if (t.user.type !== 'CUSTOMER') throw new Error('staff-account');
    session.set(t.accessToken, t.refreshToken);
    setUser(t.user);
  }, []);

  const value = useMemo<AuthState>(() => ({
    user, ready,
    login: async (email, password) => finish(await api<Tokens>('/auth/login', { method: 'POST', body: { email, password } })),
    register: async (input) => finish(await api<Tokens>('/public/auth/register', { method: 'POST', body: input })),
    logout: async () => {
      const token = session.refreshToken();
      session.clear(); setUser(null);
      if (token) await api('/auth/logout', { method: 'POST', body: { refreshToken: token } }).catch(() => undefined);
    },
  }), [user, ready, finish]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
