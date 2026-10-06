const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const TENANT = (import.meta.env as any).VITE_TENANT ?? 'retroburger';

export class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}): Promise<T> {
  const qs = opts.query ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString() : '';
  let res: Response;
  try { res = await fetch(`${BASE}/public/${TENANT}${path}${qs}`, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: opts.body ? { 'content-type': 'application/json' } : undefined, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new ApiError('NETWORK', '📡 No pudimos conectar. Revisa tu Internet e inténtalo de nuevo.', 0); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.code ?? 'INTERNAL', data?.message ?? '⚠️ No pudimos completar tu solicitud. Inténtalo nuevamente.', res.status);
  return data as T;
}
