import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startApi } from './helpers';
import { Fixture, buildFixture } from './fixtures';
import { JobsService } from '../src/modules/jobs/jobs.service';

let api: Api; let f: Fixture;
beforeAll(async () => { api = await startApi(); f = await buildFixture(api, 'rec'); });
afterAll(async () => { await f.close(); await api.app.close(); });
const get = (url: string, token: string) => api.req('GET', url, { token });

describe('conciliación de inventario', () => {
  it('estado sano: sin hallazgos críticos', async () => {
    const r = await get(`/inventory/reconciliation?branchId=${f.branchId}`, f.tokens.almacen);
    expect(r.status).toBe(200); expect(r.body.ok).toBe(true); expect(r.body.findings).toEqual([]);
    expect((await get(`/inventory/reconciliation?branchId=${f.branchId}`, f.tokens.mesero)).status).toBe(403);
  });

  it('detecta un saldo alterado fuera del motor, lo notifica una vez al día y es idempotente', async () => {
    await f.sql('UPDATE inventory SET qty = qty + 7 WHERE branch_id=$1 AND ingredient_id=$2', [f.branchId, f.ing.CARNE]);
    const r = await get(`/inventory/reconciliation?branchId=${f.branchId}`, f.tokens.gerente);
    expect(r.body.ok).toBe(false);
    const hit = r.body.findings.find((x: any) => x.ingredientId === f.ing.CARNE);
    expect(hit.kind).toBe('KARDEX_MISMATCH'); expect(hit.severity).toBe('CRITICAL'); expect(hit.stock - hit.expected).toBeCloseTo(7, 3);

    const jobs = api.app.get(JobsService);
    expect(await jobs.nightly(f.t.tenantId)).toMatchObject({ ran: true });
    expect(await jobs.nightly(f.t.tenantId)).toEqual({ ran: false, findings: 0 });          // ya corrió hoy
    const n = (await get('/notifications', f.tokens.gerente)).body.filter((x: any) => x.type === 'INVENTORY_INTEGRITY');
    expect(n).toHaveLength(1); expect(n[0].severity).toBe('CRITICAL'); expect(n[0].title).toContain('CARNE');
    await jobs.nightly(f.t.tenantId, true);                                                  // forzado: no duplica la notificación
    expect((await get('/notifications', f.tokens.gerente)).body.filter((x: any) => x.type === 'INVENTORY_INTEGRITY')).toHaveLength(1);
    expect((await f.sql(`SELECT result FROM job_runs WHERE job='inventory.reconcile'`))[0].result.critical).toBeGreaterThanOrEqual(1);
  });

  it('detecta lotes que exceden el saldo y existencias negativas (advertencias)', async () => {
    await f.sql('UPDATE inventory SET qty = qty - 7 WHERE branch_id=$1 AND ingredient_id=$2', [f.branchId, f.ing.CARNE]);   // reparado
    await f.sql('UPDATE inventory_lots SET qty_remaining = qty_remaining + 500 WHERE branch_id=$1 AND ingredient_id=$2', [f.branchId, f.ing.PAN]);
    const r = (await get(`/inventory/reconciliation?branchId=${f.branchId}`, f.tokens.almacen)).body;
    expect(r.findings.some((x: any) => x.ingredientId === f.ing.CARNE)).toBe(false);
    const lots = r.findings.find((x: any) => x.ingredientId === f.ing.PAN);
    expect(lots.kind).toBe('LOTS_EXCEED_STOCK'); expect(lots.severity).toBe('WARNING');
    expect(r.ok).toBe(true);   // las advertencias no marcan fallo crítico
  });
});
