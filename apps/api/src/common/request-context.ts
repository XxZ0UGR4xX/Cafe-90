import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import type { Principal } from '../modules/identity/principal';

/** Contexto por request (o por job). Evita pasar tenant/usuario por todas las firmas. */
export interface RequestContext {
  requestId?: string;
  ip?: string;
  userAgent?: string;
  tenantId?: string;
  principal?: Principal;
  /** Cliente de BD con transacción abierta y `app.tenant_id` fijado. */
  tx?: PoolClient;
  /** Callbacks que se ejecutan SOLO después del COMMIT de la transacción externa (p. ej. publicar eventos en tiempo real). */
  afterCommit?: Array<() => void>;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
export const ctx = (): RequestContext => requestContext.getStore() ?? {};
