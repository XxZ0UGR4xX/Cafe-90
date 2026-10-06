import { create } from 'zustand';
import { ApiError, api } from '../app/api';
import { listOps, removeOps, bumpAttempts } from './store';
import { useSession } from '../app/auth';

export type ConnState = 'online' | 'syncing' | 'offline';
interface ConnStore { state: ConnState; pending: number; exceptions: number; lastSync: number | null; set: (p: Partial<ConnStore>) => void }
export const useConnection = create<ConnStore>((set) => ({ state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online', pending: 0, exceptions: 0, lastSync: null, set: (p) => set(p) }));

const BATCH = 50;
let syncing = false;
export async function refreshPending() { useConnection.getState().set({ pending: (await listOps()).length }); }

/** Envía la cola en orden de captura. Idempotente (opId): reintentar nunca duplica. Nunca descarta una venta: lo irreparable queda en la bandeja del servidor. */
export async function syncNow(): Promise<{ applied: number; review: number } | null> {
  if (syncing || useSession.getState().status !== 'ready') return null;
  const ops = await listOps();
  useConnection.getState().set({ pending: ops.length });
  if (!ops.length) return { applied: 0, review: 0 };
  syncing = true; useConnection.getState().set({ state: 'syncing' });
  let applied = 0; let review = 0;
  try {
    const byBranch = new Map<string, typeof ops>();
    for (const o of ops) byBranch.set(o.op.branchId, [...(byBranch.get(o.op.branchId) ?? []), o]);
    for (const [branchId, list] of byBranch) {
      for (let i = 0; i < list.length; i += BATCH) {
        const chunk = list.slice(i, i + BATCH);
        const res = await api('/sync/push', { method: 'POST', body: { deviceId: deviceId(), branchId, operations: chunk.map(({ op }) => ({ opId: op.opId, type: op.type, createdAt: op.createdAt, payload: op.payload })) } });
        const done = new Set<string>();
        for (const r of res.results as { opId: string; status: string }[]) {
          if (['APPLIED', 'DUPLICATE'].includes(r.status)) applied++; else review++;
          done.add(r.opId);                       // el servidor ya la tiene (aplicada o en bandeja de excepciones)
        }
        await removeOps(chunk.filter(({ op }) => done.has(op.opId)).map(({ key }) => key));
      }
    }
    useConnection.getState().set({ state: 'online', lastSync: Date.now(), exceptions: useConnection.getState().exceptions + review });
  } catch (e) {
    for (const { key, op } of ops.slice(0, 1)) await bumpAttempts(key, op);
    useConnection.getState().set({ state: e instanceof ApiError && e.isNetwork ? 'offline' : 'online' });
  } finally { syncing = false; await refreshPending(); }
  return { applied, review };
}

export function deviceId(): string {
  try { let id = localStorage.getItem('rb.device'); if (!id) { id = `pos-${crypto.randomUUID().slice(0, 8)}`; localStorage.setItem('rb.device', id); } return id; } catch { return 'pos-unknown'; }
}

let started = false;
/** Monitor de conexión: eventos del navegador + ping periódico + sincronización automática. */
export function startConnectionMonitor() {
  if (started || typeof window === 'undefined') return; started = true;
  const check = async () => {
    try { await api('/health', { noAuth: true, signal: AbortSignal.timeout(4000) }); if (useConnection.getState().state === 'offline') useConnection.getState().set({ state: 'online' }); void syncNow(); }
    catch { useConnection.getState().set({ state: 'offline' }); }
    await refreshPending();
  };
  window.addEventListener('online', () => void check()); window.addEventListener('offline', () => useConnection.getState().set({ state: 'offline' }));
  setInterval(() => void check(), 15_000); void check();
}
