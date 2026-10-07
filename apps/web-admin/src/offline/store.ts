import { clear, createStore, del, entries, get, set, delMany } from 'idb-keyval';

/** Almacenamiento local: caché de lectura + cola de operaciones (outbox) persistente. */
const cacheStore = () => createStore('rb-cache', 'kv');
const outboxStore = () => createStore('rb-outbox', 'ops');
let cs: ReturnType<typeof createStore> | undefined; let os: ReturnType<typeof createStore> | undefined;
const C = () => (cs ??= cacheStore()); const O = () => (os ??= outboxStore());

export async function cacheSet(key: string, value: unknown) { try { await set(key, { value, at: Date.now() }, C()); } catch { /* sin IndexedDB */ } }
export async function cacheGet<T>(key: string): Promise<{ value: T; at: number } | undefined> { try { return await get(key, C()); } catch { return undefined; } }

export type OpType = 'ORDER_CREATE' | 'ORDER_PAY' | 'ORDER_CANCEL' | 'ORDER_ADD_ITEMS';
export interface OutboxOp { opId: string; type: OpType; branchId: string; createdAt: string; payload: Record<string, unknown>; attempts: number; label?: string; userId?: string }

let seq = 0;
const keyOf = (createdAt: string, opId: string) => `${createdAt}|${String(++seq).padStart(6, '0')}|${opId}`;
export async function enqueue(op: Omit<OutboxOp, 'attempts' | 'createdAt'> & { createdAt?: string }): Promise<OutboxOp> {
  const full: OutboxOp = { ...op, createdAt: op.createdAt ?? new Date().toISOString(), attempts: 0 };
  await set(keyOf(full.createdAt, full.opId), full, O());   // persistente: sobrevive a recargas y cierre del navegador
  return full;
}
export async function listOps(): Promise<{ key: string; op: OutboxOp }[]> {
  try { return (await entries<string, OutboxOp>(O())).map(([key, op]) => ({ key, op })).sort((a, b) => a.key.localeCompare(b.key)); } catch { return []; }
}
export async function removeOps(keys: string[]) { if (keys.length) await delMany(keys, O()); }
export async function bumpAttempts(key: string, op: OutboxOp) { await set(key, { ...op, attempts: op.attempts + 1 }, O()); }
/** Borra la caché de lectura (menú, etc.). La cola de operaciones NO se toca: son ventas aún sin sincronizar. */
export async function clearCache() { try { await clear(C()); } catch { /* sin IndexedDB */ } }
