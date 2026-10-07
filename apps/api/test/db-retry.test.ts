import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, newTenant, startApi } from './helpers';
import { DbService } from '../src/database/db.service';
import { requestContext } from '../src/common/request-context';

let api: Api; let db: DbService; let tenantId: string;
beforeAll(async () => { api = await startApi(); db = api.app.get(DbService); tenantId = (await newTenant(api, 'retry')).tenantId; });
afterAll(async () => { await api.app.close(); });
const asTenant = <T>(fn: () => Promise<T>) => requestContext.run({ tenantId }, fn);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('reintento de transacciones', () => {
  it('un deadlock real (dos transacciones se bloquean en orden inverso) se resuelve reintentando la perdedora: ambas terminan', async () => {
    const base = Math.floor(Math.random() * 1e6) + 1000; const attempts = { a: 0, b: 0 };
    const run = (k: 'a' | 'b', first: number, second: number) => asTenant(() => db.tx(async (q) => {
      attempts[k]++;
      await q.query('SELECT pg_advisory_xact_lock($1)', [first]);
      await sleep(150);                                      // ambas ya tienen su primer candado → cruce garantizado
      await q.query('SELECT pg_advisory_xact_lock($1)', [second]);
      return k;
    }));
    const [a, b] = await Promise.all([run('a', base, base + 1), run('b', base + 1, base)]);
    expect([a, b]).toEqual(['a', 'b']);
    expect(attempts.a + attempts.b).toBeGreaterThanOrEqual(3);   // al menos una se repitió desde cero
  });

  it('los errores que NO son de concurrencia no se reintentan', async () => {
    let n = 0;
    await expect(asTenant(() => db.tx(async (q) => { n++; await q.query('SELECT 1/0'); }))).rejects.toThrow(/division by zero/);
    expect(n).toBe(1);
  });

  it('transacción anidada reutiliza la externa (sin reintentos propios) y el rollback revierte todo', async () => {
    await expect(asTenant(() => db.tx(async (q) => {
      await q.query(`INSERT INTO job_runs (tenant_id, job, run_on) VALUES (app_tenant_id(), 'retry-test', current_date)`);
      await db.tx(async (q2) => { expect(q2).toBe(q); });
      throw new Error('boom');
    }))).rejects.toThrow('boom');
    const rows = await asTenant(() => db.tx(async (q) => (await q.query(`SELECT 1 FROM job_runs WHERE job='retry-test'`)).rows));
    expect(rows).toEqual([]);
  });
});
