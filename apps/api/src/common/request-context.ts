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
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
export const ctx = (): RequestContext => requestContext.getStore() ?? {};
