import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startApi } from './helpers';
import { Fixture, buildFixture, item } from './fixtures';

let api: Api; let f: Fixture;
beforeAll(async () => { api = await startApi(); f = await buildFixture(api, 'bday'); });
afterAll(async () => { await f.close(); await api.app.close(); });
const get = (url: string, token: string) => api.req('GET', url, { token });

describe('día operativo (corte de día)', () => {
  it('«hoy» del dashboard y de /auth/me sigue al día operativo, no al calendario: con corte 23:59 casi todo el día es «ayer»', async () => {
    // Con el corte en 23:59 el día operativo vigente empezó AYER (salvo el último minuto del día) → reproduce, a cualquier hora, el caso 00:00–04:00 del corte real.
    await f.sql(`UPDATE branches SET business_day_cutoff = '23:59'`);
    await api.req('POST', '/cash/shifts/open', { token: f.tokens.cajero, body: { branchId: f.branchId, openingFloat: 100 } });
    const o = (await api.req('POST', '/orders', { token: f.tokens.mesero, body: { branchId: f.branchId, channel: 'TAKEAWAY', items: [item(f.prod.burger)], send: true } })).body;
    await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.cajero, body: { payments: [{ method: 'CASH', amount: o.total }] } });

    const bd = (await f.sql(`SELECT business_date::text d FROM orders WHERE id=$1`, [o.id]))[0].d as string;
    const calendar = (await f.sql(`SELECT (now() AT TIME ZONE 'America/Mexico_City')::date::text d`))[0].d as string;
    const minuteBeforeCutoff = (await f.sql(`SELECT ((now() AT TIME ZONE 'America/Mexico_City')::time >= '23:59') b`))[0].b;
    if (!minuteBeforeCutoff) expect(bd).not.toBe(calendar);   // la orden quedó en el día operativo anterior al calendario

    const me = (await get('/auth/me', f.admin)).body;
    expect(me.tenant.businessDate).toBe(bd);
    const d = (await get('/dashboard/corporate?range=today', f.admin)).body;
    expect(d.kpis.orders).toBe(1); expect(d.kpis.salesToday).toBeCloseTo(o.total, 2);   // con el calendario habría dado 0
    const mine = (await get(`/dashboard/manager?branchId=${f.branchId}`, f.tokens.gerente)).body;
    expect(JSON.stringify(mine)).toContain(String(o.total));
  });
});
