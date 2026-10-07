import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startApi } from './helpers';
import { Fixture, buildFixture, item } from './fixtures';

let api: Api; let f: Fixture;
beforeAll(async () => {
  api = await startApi(); f = await buildFixture(api, 'str');
  // stock abundante: aquí se mide la concurrencia (la escasez ya se prueba en sales.test.ts)
  for (const k of Object.keys(f.ing)) await api.req('POST', '/inventory/movements', { token: f.admin, body: { branchId: f.branchId, ingredientId: f.ing[k], type: 'PURCHASE_IN', qty: 100000, unitCost: 1, lotCode: 'STRESS' } });
  await api.req('POST', '/cash/shifts/open', { token: f.tokens.cajero, body: { branchId: f.branchId, openingFloat: 500 } });
});
afterAll(async () => { await f.close(); await api.app.close(); });

const req = (m: string, url: string, token: string, body?: unknown) => api.req(m, url, { token, body });

describe('estrés: operaciones concurrentes mezcladas', () => {
  it('120 flujos simultáneos (crear → enviar → cobrar / cancelar / devolver) sin 5xx, sin deadlocks y con datos íntegros', async () => {
    const N = 120;
    const basket = (i: number) => [
      [item(f.prod.burger, { qty: 1 + (i % 3) }), item(f.prod.papas)],
      [item(f.prod.cola), item(f.prod.burger, { modifierIds: [] })],
      [item(f.prod.papas, { qty: 2 }), item(f.prod.cola, { qty: 2 }), item(f.prod.agua)],
      [item(f.prod.cola), item(f.prod.papas), item(f.prod.burger)],          // mismos insumos en distinto orden → riesgo de deadlock
    ][i % 4]!;
    const flow = async (i: number) => {
      const o = await req('POST', '/orders', f.tokens.mesero, { branchId: f.branchId, channel: 'TAKEAWAY', items: basket(i), send: true });
      if (o.status !== 201) return { i, step: 'create', status: o.status, body: o.body };
      if (i % 10 === 9) {                                                    // 10 %: se cancela sin pago
        const c = await req('POST', `/orders/${o.body.id}/cancel`, f.tokens.gerente, { reason: 'Prueba de estrés' });
        return { i, step: 'cancel', status: c.status, id: o.body.id, number: o.body.number };
      }
      const method = ['CASH', 'CARD', 'QR'][i % 3]!;
      const p = await req('POST', `/orders/${o.body.id}/pay`, f.tokens.cajero, { payments: [{ method, amount: o.body.total, tip: i % 7 === 0 ? 10 : 0 }] });
      if (p.status === 200 && i % 15 === 0) {                                // algunas se devuelven completas
        const r = await req('POST', `/orders/${o.body.id}/refund`, f.tokens.cajero, { method, reason: 'Estrés', supervisor: { userCode: f.users.gerente!.userCode, pin: '1234' } });
        return { i, step: 'refund', status: r.status, id: o.body.id, number: o.body.number };
      }
      return { i, step: 'pay', status: p.status, id: o.body.id, number: o.body.number, total: o.body.total, method, tip: i % 7 === 0 ? 10 : 0, body: p.body };
    };

    const t0 = Date.now();
    const out = await Promise.all(Array.from({ length: N }, (_, i) => flow(i)));
    const ms = Date.now() - t0;

    const failures = out.filter((x) => x.status >= 400);
    // La ÚNICA falla aceptable es falta de stock (409 INSUFFICIENT_STOCK) o caja ocupada; jamás 5xx
    expect(out.filter((x) => x.status >= 500), JSON.stringify(out.filter((x) => x.status >= 500).slice(0, 2))).toEqual([]);
    for (const x of failures) expect(x.status, JSON.stringify(x)).toBe(409);
    const done = out.filter((x) => x.status < 400);
    expect(done.length).toBeGreaterThan(N * 0.95);          // con stock abundante prácticamente todo debe completarse
    console.log(`stress: ${N} flujos en ${ms} ms (${Math.round(N / (ms / 1000))} flujos/s); ${done.length} completos, ${failures.length} rechazados por stock`);

    // Integridad
    const nums = await f.sql(`SELECT number, count(*)::int n FROM orders GROUP BY business_date, branch_id, number HAVING count(*) > 1`);
    expect(nums).toEqual([]);                                                // folios únicos
    expect(await f.reconcile()).toEqual([]);                                 // kardex = saldo
    const neg = await f.sql(`SELECT count(*)::int n FROM inventory WHERE qty < 0`); expect(neg[0].n).toBe(0);
    const unbalanced = await f.sql(`SELECT o.number FROM orders o WHERE o.payment_status = 'PAID' AND abs(o.paid_total - o.total) > 0.005`);
    expect(unbalanced).toEqual([]);                                          // pagadas = total exacto
    const overpaid = await f.sql(`SELECT o.number FROM orders o WHERE o.paid_total > o.total + 0.005`); expect(overpaid).toEqual([]);

    // La caja cuadra con los pagos registrados (ventas − devoluciones por método)
    const cash = (await req('GET', `/cash/shifts/current?branchId=${f.branchId}`, f.tokens.cajero)).body;
    expect(cash.id).toBeTruthy();
    const rows = await f.sql(`SELECT sum(CASE WHEN type='SALE' THEN amount ELSE 0 END) s, sum(CASE WHEN type='REFUND' THEN amount ELSE 0 END) r FROM cash_movements WHERE shift_id=$1`, [cash.id]);
    const pays = await f.sql(`SELECT sum(CASE WHEN kind='PAYMENT' THEN amount ELSE 0 END) p, sum(CASE WHEN kind='REFUND' THEN -amount ELSE 0 END) r FROM payments WHERE cash_shift_id=$1`, [cash.id]);
    expect(Number(rows[0].s)).toBeCloseTo(Number(pays[0].p), 2); expect(Math.abs(Number(rows[0].r))).toBeCloseTo(Number(pays[0].r), 2);

    // Cada orden cancelada o devuelta restituyó inventario: el consumo neto sólo viene de órdenes vivas
    const consumed = await f.sql(`SELECT i.sku, -sum(m.qty) AS q FROM inventory_movements m JOIN ingredients i ON i.id = m.ingredient_id WHERE m.type IN ('SALE_OUT','SALE_REVERSAL') GROUP BY i.sku`);
    expect(consumed.length).toBeGreaterThan(0);
    for (const c of consumed) expect(Number(c.q), c.sku).toBeGreaterThanOrEqual(0);
  });
});
