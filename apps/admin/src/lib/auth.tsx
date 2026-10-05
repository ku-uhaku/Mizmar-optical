'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { activeStore, api, refreshSession, tokens } from './api';

export interface AuthUser {
  id: string; email: string; firstName: string; lastName: string; locale: string;
  isSuperAdmin: boolean; roles: string[]; permissions: string[]; storeIds: string[];
  stores: { id: string; code: string; name: string }[]; defaultStoreId: string | null;
}

interface AuthCtx {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** true for super admins or when the user holds the `module:action` permission */
  can(permission: string): boolean;
  storeId: string | null;
  setStoreId(id: string): void;
}

const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => { const c = useContext(Ctx); if (!c) throw new Error('useAuth outside AuthProvider'); return c; };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthCtx['status']>('loading');
  const [storeId, setStore] = useState<string | null>(null);

  const adopt = useCallback((u: AuthUser) => {
    setUser(u);
    const saved = activeStore.get();
    const valid = saved && (u.isSuperAdmin || u.storeIds.includes(saved)) ? saved : u.defaultStoreId;
    if (valid) activeStore.set(valid); else activeStore.clear();
    setStore(valid);
    setStatus('authenticated');
  }, []);

  useEffect(() => {
    (async () => {
      if (tokens.hasRefresh() && (await refreshSession())) {
        try { adopt(await api<AuthUser>('/auth/me')); return; } catch { /* fall through */ }
      }
      setStatus('unauthenticated');
    })();
  }, [adopt]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ accessToken: string; refreshToken: string; user: AuthUser }>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
    tokens.set(res.accessToken, res.refreshToken);
    adopt(res.user);
  }, [adopt]);

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem('mizmar.refreshToken');
    if (refreshToken) await api('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }).catch(() => undefined);
    tokens.clear(); activeStore.clear();
    setUser(null); setStore(null); setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    user, status, login, logout, storeId,
    can: (p) => !!user && (user.isSuperAdmin || user.permissions.includes(p)),
    setStoreId: (id) => { activeStore.set(id); setStore(id); window.location.reload(); },
  }), [user, status, login, logout, storeId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
