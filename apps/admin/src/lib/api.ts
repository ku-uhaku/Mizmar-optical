const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

const REFRESH_KEY = 'mizmar.refreshToken';
const STORE_KEY = 'mizmar.storeId';

const safe = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

/** Access token lives in memory only; the refresh token is persisted so sessions survive reloads. */
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const tokens = {
  set(access: string, refresh: string) { accessToken = access; safe.set(REFRESH_KEY, refresh); },
  clear() { accessToken = null; safe.del(REFRESH_KEY); },
  hasRefresh: () => !!safe.get(REFRESH_KEY),
};
export const activeStore = { get: () => safe.get(STORE_KEY), set: (id: string) => safe.set(STORE_KEY, id), clear: () => safe.del(STORE_KEY) };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/** Single-flight refresh: concurrent 401s share one refresh call (refresh tokens are one-time use). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = safe.get(REFRESH_KEY);
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
      if (!res.ok) { tokens.clear(); return false; }
      const data = await res.json();
      tokens.set(data.accessToken, data.refreshToken);
      return true;
    } catch { return false; }
    finally { setTimeout(() => (refreshing = null), 0); }
  })();
  return refreshing;
}

type Opts = { method?: string; body?: unknown; query?: Record<string, string | number | undefined | null>; auth?: boolean };

export async function api<T = unknown>(path: string, { method = 'GET', body, query, auth = true }: Opts = {}, retried = false): Promise<T> {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString() : '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const store = activeStore.get();
  if (auth && store) headers['x-store-id'] = store;

  const res = await fetch(`${API_URL}${path}${qs}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  if (res.status === 401 && auth && !retried && (await refreshSession())) return api<T>(path, { method, body, query, auth }, true);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? res.statusText, err.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface Paginated<T> { data: T[]; meta: { page: number; limit: number; total: number; totalPages: number } }
