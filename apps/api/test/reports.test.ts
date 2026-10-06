import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as client } from 'socket.io-client';
import { Api, startApi } from './helpers';
import { Fixture, buildFixture, item } from './fixtures';

let api: Api; let f: Fixture; let today: string;
beforeAll(async () => {
  api = await startApi(); f = await buildFixture(api, 'rep');
  await api.req('POST', '/cash/shifts/open', { token: f.tokens.cajero, body: { branchId: f.branchId, openingFloat: 200 } });
  // 3 ventas con meseros, propinas y un cliente
  const c = (await api.req('POST', '/customers', { token: f.tokens.cajero, body: { name: 'Cliente Rep', phone: '555-7777' } })).body;
  for (const [items, tip, method] of [[[item(f.prod.burger, { qty: 2 })], 20, 'CASH'], [[item(f.prod.burger), item(f.prod.papas)], 0, 'CARD'], [[item(f.prod.cola, { qty: 3 })], 10, 'QR']] as const) {
    const o = (await api.req('POST', '/orders', { token: f.tokens.mesero, body: { branchId: f.branchId, channel: 'TAKEAWAY', customerId: c.id, items, send: true } })).body;
    const r = await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.cajero, body: { payments: [{ method, amount: o.total, tip }] } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
  today = (await f.sql(`SELECT business_date::text d FROM orders LIMIT 1`))[0].d;
});
afterAll(async () => { await f.close(); await api.app.close(); });

const get = (url: string, token: string) => api.req('GET', url, { token });
const q = (extra = '') => `from=${today}&to=${today}&branchId=${f.branchId}${extra}`;

describe('reportes', () => {
  it('ventas: totales correctos (258 + 178 + 105 = 541) y por método de pago', async () => {
    const r = (await get(`/reports/sales?${q()}`, f.tokens.gerente)).body;
    expect(r.totals.orders).toBe(3); expect(r.totals.net).toBe(541); expect(r.totals.tips).toBe(30);
    expect(r.totals.avgTicket).toBeCloseTo(180.33, 2);
    const card = (await get(`/reports/sales?${q('&method=CARD')}`, f.tokens.gerente)).body;
    expect(card.totals.orders).toBe(1); expect(card.totals.net).toBe(178);
    const byHour = (await get(`/reports/sales?${q('&groupBy=hour')}`, f.tokens.gerente)).body;
    expect(byHour.rows.reduce((a: number, x: any) => a + x.orders, 0)).toBe(3);
  });

  it('productos: unidades e ingreso; costo y utilidad sólo para quien ve costos', async () => {
    const g = (await get(`/reports/products?${q()}`, f.tokens.gerente)).body;
    const burger = g.rows.find((x: any) => x.product === 'Retro Burger');
    expect(burger.qty).toBe(3); expect(burger.revenue).toBe(387);
    expect(burger.cost).toBeGreaterThan(0);
    const role = await api.req('POST', '/roles', { token: f.admin, body: { key: 'ANALISTA', name: 'Analista', permissions: ['reports.sales.read', 'notifications.read'] } });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const email = `analista@${f.t.slug}.test`;
    await api.req('POST', '/users', { token: f.admin, body: { email, fullName: 'Ana Lista', password: 'Sup3r-Secret-Pass!', roles: [{ role: 'ANALISTA', branchIds: [f.branchId] }] } });
    const login = await api.req('POST', '/auth/login', { body: { tenant: f.t.slug, email, password: 'Sup3r-Secret-Pass!' } });
    const c = (await get(`/reports/products?${q()}`, login.body.accessToken)).body;
    expect(c.columns.map((x: any) => x.key)).not.toContain('cost');
    expect(c.rows[0].cost).toBeNull();
  });

  it('utilidad/costos requieren permiso; mesero no accede a reportes de ventas', async () => {
    expect((await get(`/reports/profit?${q()}`, f.tokens.gerente)).status).toBe(200);
    expect((await get(`/reports/profit?${q()}`, f.tokens.cajero)).status).toBe(403);
    expect((await get(`/reports/sales?${q()}`, f.tokens.mesero)).status).toBe(403);
    const p = (await get(`/reports/profit?${q()}`, f.tokens.gerente)).body;
    expect(p.totals.revenue).toBeGreaterThan(0); expect(p.totals.profit).toBeCloseTo(p.totals.revenue - p.totals.cogs, 1);
  });

  it('propinas por mesero/método, empleados, inventario, cajas y clientes', async () => {
    expect((await get(`/reports/tips?${q()}`, f.tokens.gerente)).body.totals.tips).toBe(30);
    const emp = (await get(`/reports/employees?${q()}`, f.tokens.gerente)).body;
    expect(emp.rows[0]).toMatchObject({ orders: 3, sales: 541 });
    expect((await get(`/reports/inventory?${q()}`, f.tokens.almacen)).body.rows.length).toBeGreaterThan(3);
    expect((await get(`/reports/customers?${q()}`, f.tokens.gerente)).body.rows[0]).toMatchObject({ customer: 'Cliente Rep', visits: 3 });
    expect((await get(`/reports/cash?${q()}`, f.tokens.gerente)).status).toBe(200);
    expect((await get('/reports/nope?from=2026-01-01&to=2026-01-02', f.admin)).status).toBe(400);
  });

  it('el alcance de sucursal se respeta: gerente de otra sucursal no ve estos datos', async () => {
    const other = (await api.req('POST', '/branches', { token: f.admin, body: { name: 'Otra', code: 'OTRA' } })).body;
    const r = await get(`/reports/sales?from=${today}&to=${today}&branchId=${other.id}`, f.tokens.gerente);
    expect(r.status).toBe(403);
    const all = await get(`/reports/sales?from=${today}&to=${today}`, f.tokens.gerente);
    expect(all.body.totals.net).toBe(541);
  });
});

describe('dashboards y analítica', () => {
  it('corporativo: KPIs, gráficas y ranking; sólo con alcance corporativo', async () => {
    const d = (await get('/dashboard/corporate?range=today', f.admin)).body;
    expect(d.kpis.salesToday).toBe(541); expect(d.kpis.orders).toBe(3); expect(d.kpis.topProduct).toBe('Retro Burger');
    expect(d.ranking[0]).toMatchObject({ rank: 1, sales: 541, orders: 3 });
    expect(d.charts.salesByCategory.length).toBeGreaterThan(0); expect(d.charts.salesByHour.length).toBeGreaterThan(0);
    expect(d.comparison.sales).toBeNull();   // ayer = 0 → sin base de comparación
    expect((await get('/dashboard/corporate?range=today', f.tokens.gerente)).status).toBe(403);
    expect((await get('/dashboard/corporate?range=custom', f.admin)).status).toBe(400);
  });

  it('analítica: revenue, COGS, utilidad bruta, ticket promedio, food cost %, retención', async () => {
    const a = (await get(`/analytics/overview?from=${today}&to=${today}`, f.admin)).body.current;
    expect(a.revenue).toBe(541); expect(a.orders).toBe(3); expect(a.customers).toBe(1);
    expect(a.grossProfit).toBeCloseTo(a.netSales - a.cogs, 1);
    expect(a.foodCostPct).toBeGreaterThan(0); expect(a.retention).toBe(100);
    expect((await get(`/analytics/overview?from=${today}&to=${today}`, f.tokens.cajero)).status).toBe(403);
  });

  it('gerente: hoy vs ayer/semana pasada, inventario, alertas y problemas', async () => {
    const m = (await get(`/dashboard/manager?branchId=${f.branchId}`, f.tokens.gerente)).body;
    expect(m.sales).toBe(541); expect(m.orders).toBe(3); expect(m.staff).toBeGreaterThanOrEqual(5);
    expect(m.vsYesterday).toHaveProperty('sales'); expect(m.problems).toHaveProperty('syncExceptions'); expect(m.inventory).toHaveProperty('critical');
  });

  it('cajero (sólo caja), mesero (mesas y propinas propias) y almacén', async () => {
    const c = (await get(`/dashboard/cashier?branchId=${f.branchId}`, f.tokens.cajero)).body;
    expect(c.salesTotal).toBe(541); expect(c.methods.map((m: any) => m.method).sort()).toEqual(['CARD', 'CASH', 'QR']);
    expect(JSON.stringify(c)).not.toMatch(/profit|cost|utilidad/i);
    const w = (await get(`/dashboard/waiter?branchId=${f.branchId}`, f.tokens.mesero)).body;
    expect(w.sales).toBe(541); expect(w.tips).toBe(30); expect(w.tables.total).toBe(4);
    const wh = (await get(`/dashboard/warehouse?branchId=${f.branchId}`, f.tokens.almacen)).body;
    expect(wh.summary.total).toBe(6); expect(wh.flow24h.exits).toBeGreaterThan(0);
    const cards = (await get('/dashboard/branches', f.admin)).body;
    expect(cards.find((x: any) => x.code === 'CENTRO')).toMatchObject({ ordersToday: 3, salesToday: 541 });
  });
});

describe('tiempo real (WebSocket)', () => {
  it('el KDS recibe eventos de su sucursal y rechaza sockets sin token', async () => {
    await api.app.listen(0, '127.0.0.1');
    const port = (api.app.getHttpServer().address() as { port: number }).port;
    const bad = client(`http://127.0.0.1:${port}`, { path: '/ws', auth: { token: 'x' }, transports: ['websocket'] });
    const rejected = await new Promise<string>((res) => { bad.on('error', (e: any) => res(e.code)); bad.on('disconnect', () => res('DISCONNECTED')); });
    expect(['UNAUTHENTICATED', 'DISCONNECTED']).toContain(rejected); bad.close();

    const sock = client(`http://127.0.0.1:${port}`, { path: '/ws', auth: { token: f.tokens.cocinero }, transports: ['websocket'] });
    await new Promise((res) => sock.on('ready', res));
    const got = new Promise<any>((res) => sock.on('KitchenChanged', res));
    await api.req('POST', '/orders', { token: f.tokens.mesero, body: { branchId: f.branchId, channel: 'TAKEAWAY', items: [item(f.prod.papas)], send: true } });
    const ev = await got;
    expect(ev.new).toBe(true); expect(ev.station).toBe('FREIDORA');
    sock.close();
  });
});
