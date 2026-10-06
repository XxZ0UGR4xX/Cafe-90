import { errorMessage } from '@retroburger/shared';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** Error de API con mensaje humano (nunca un "500 Internal Server Error" crudo). */
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown, public retryable = false, public requestId?: string) { super(message); }
  get isNetwork() { return this.code === 'NETWORK'; }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onAuthLost: (() => void) | null = null;
export const setToken = (t: string | null) => { accessToken = t; };
export const getToken = () => accessToken;
export const onSessionLost = (fn: () => void) => { onAuthLost = fn; };
export const apiBase = BASE;

async function raw(path: string, init: RequestInit): Promise<Response> {
  try { return await fetch(`${BASE}${path}`, { credentials: 'include', ...init }); }
  catch { throw new ApiError('NETWORK', '📡 Sin conexión con el servidor. La información permanece guardada y se enviará al reconectar.', 0, undefined, true); }
}

/** Renueva el access token con la cookie HttpOnly de refresh (rotativa). Una sola petición en vuelo. */
export function refreshSession(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const r = await raw('/auth/refresh', { method: 'POST', headers: { 'x-requested-with': 'retroburger' } });
      if (!r.ok) { setToken(null); return null; }
      const j = await r.json(); setToken(j.accessToken); return j.accessToken as string;
    } catch { return null; } finally { setTimeout(() => { refreshing = null; }, 0); }
  })();
  return refreshing;
}

export interface ReqOpts { method?: string; body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string>; signal?: AbortSignal; noAuth?: boolean }
export async function api<T = any>(path: string, o: ReqOpts = {}): Promise<T> {
  const qs = o.query ? '?' + new URLSearchParams(Object.entries(o.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString() : '';
  const send = () => raw(path + (qs === '?' ? '' : qs), {
    method: o.method ?? (o.body ? 'POST' : 'GET'), signal: o.signal,
    headers: { ...(o.body ? { 'content-type': 'application/json' } : {}), ...(accessToken && !o.noAuth ? { authorization: `Bearer ${accessToken}` } : {}), ...o.headers },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  let res = await send();
  if (res.status === 401 && !o.noAuth && !path.startsWith('/auth/')) {
    const t = await refreshSession();
    if (t) res = await send(); else { onAuthLost?.(); }
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const d = (data ?? {}) as { code?: string; message?: string; details?: unknown; retryable?: boolean; requestId?: string };
    const code = d.code ?? 'INTERNAL';
    throw new ApiError(code, d.message ?? errorMessage(code), res.status, d.details, d.retryable ?? res.status >= 500, d.requestId);
  }
  return data as T;
}
export const get = <T = any>(path: string, query?: Record<string, unknown>) => api<T>(path, { query });
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} });
export const patch = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });
