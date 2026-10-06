import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { ENV, type Env } from '../config/env';
import { ctx, requestContext } from '../common/request-context';
import { forbidden } from '../common/errors';

/** Interfaz mínima de ejecución SQL que reciben los repositorios. */
export interface Tx {
  query<R extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
}

// numeric → number (importes con ≤4 decimales caben sin pérdida en double); bigint → number
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1082, (v) => v);   // date → 'YYYY-MM-DD' (sin conversión de zona horaria)

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({ connectionString: env.DATABASE_URL, max: 20, idleTimeoutMillis: 30_000 });
  }

  /**
   * Ejecuta `fn` en una transacción con `app.tenant_id` fijado (RLS activa).
   * Reutiliza la transacción si ya hay una abierta en el contexto (composición de servicios).
   */
  async tx<T>(fn: (q: Tx) => Promise<T>, tenantId?: string): Promise<T> {
    const c = ctx();
    if (c.tx && (!tenantId || tenantId === c.tenantId)) return fn(c.tx);
    const tid = tenantId ?? c.tenantId;
    if (!tid) throw forbidden({ reason: 'tenant context missing' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tid]);
      const store = { ...c, tenantId: tid, tx: client, afterCommit: [] as Array<() => void> };
      const result = await requestContext.run(store, () => fn(client));
      await client.query('COMMIT');
      for (const cb of store.afterCommit) { try { cb(); } catch { /* los efectos post-commit no deben fallar la operación */ } }
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Transacción INDEPENDIENTE de la actual (se confirma aunque la externa haga rollback): contadores de intentos, auditoría de fallos. */
  async independent<T>(fn: (q: Tx) => Promise<T>): Promise<T> {
    const c = ctx();
    return requestContext.run({ ...c, tx: undefined, afterCommit: undefined }, () => this.tx(fn, c.tenantId));
  }

  /** Consulta sin tenant (sólo funciones SECURITY DEFINER pre-autenticación). */
  async system<R extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<QueryResult<R>> {
    return this.pool.query<R>(sql, params);
  }

  async onModuleDestroy() { await this.pool.end(); }
}

export type { PoolClient };
