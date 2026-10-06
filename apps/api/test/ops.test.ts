import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startApi } from './helpers';
import { Fixture, buildFixture, item, randomUUID } from './fixtures';
import { JobsService } from '../src/modules/jobs/jobs.service';

let api: Api; let f: Fixture;
beforeAll(async () => {
  api = await startApi(); f = await buildFixture(api, 'ops');
  await api.req('POST', '/cash/shifts/open', { token: f.tokens.cajero, body: { branchId: f.branchId, openingFloat: 1000 } });
});
afterAll(async () => { await f.close(); await api.app.close(); });

const post = (url: string, token: string, body?: unknown) => api.req('POST', url, { token, body });
const get = (url: string, token: string) => api.req('GET', url, { token });
const order = (items: any[], extra: Record<string, unknown> = {}, token = f.tokens.cajero) =>
  post('/orders', token, { branchId: f.branchId, channel: 'TAKEAWAY', items, ...extra }).then((r) => { if (r.status !== 201) throw new Error(JSON.stringify(r.body)); return r.body; });
const customer = async (name: string, phone: string, email: string) => (await post('/customers', f.tokens.cajero, { name, phone, email })).body;

describe('promociones', () => {
  it('2×1 en hamburguesas se aplica solo; el descuento queda como PROMO', async () => {
    const promo = await post('/promotions', f.admin, { name: '2x1 Burgers', type: 'BOGO', config: { productIds: [f.prod.burger] }, stackable: false });
    expect(promo.status, JSON.stringify(promo.body)).toBe(201);
    const o = await order([item(f.prod.burger, { qty: 2 }), item(f.prod.papas)]);
    expect(o.discountTotal).toBe(129);
    expect(o.total).toBe(129 + 49);
    expect(o.discounts[0]).toMatchObject({ kind: 'PROMO', reason: '2x1 Burgers' });
    await api.req('PUT', `/promotions/${promo.body.id}`, { token: f.admin, body: { ...promo.body, isActive: false, startsAt: null, endsAt: null, branchIds: null, maxRedemptions: null, code: null, schedule: null } });
  });

  it('Happy Hour con horario vigente descuenta 20 % en bebidas; fuera de horario no', async () => {
    const catalog = (await get('/categories', f.admin)).body; const bebidas = catalog.find((c: any) => c.name === 'Bebidas').id;
    const day = new Date().getDay();
    const hh = await post('/promotions', f.admin, { name: 'Happy Hour', type: 'HAPPY_HOUR', config: { percent: 20, categoryIds: [bebidas] }, schedule: { days: [day], from: '00:00', to: '23:59' } });
    expect(hh.status).toBe(201);
    const o = await order([item(f.prod.cola, { qty: 2 }), item(f.prod.burger)]);
    expect(o.discountTotal).toBe(14);                          // 20 % de 70
    const off = await post('/promotions', f.admin, { name: 'HH otro día', type: 'HAPPY_HOUR', config: { percent: 50 }, schedule: { days: [(day + 3) % 7], from: '17:00', to: '19:00' } });
    expect(off.status).toBe(201);
    expect((await order([item(f.prod.cola)])).discountTotal).toBe(7);   // sólo aplica la vigente (20 % de 35)
    await api.req('PUT', `/promotions/${hh.body.id}`, { token: f.admin, body: { ...hh.body, isActive: false, startsAt: null, endsAt: null, branchIds: null, maxRedemptions: null, code: null } });
    await api.req('DELETE', `/promotions/${off.body.id}`, { token: f.admin });
  });

  it('cupón: aplica sólo con código; no apila con otra promoción no apilable', async () => {
    await post('/promotions', f.admin, { name: 'Cupón RETRO10', type: 'COUPON', code: 'retro10', config: { discountKind: 'PERCENT', percent: 10 } });
    const o = await order([item(f.prod.burger)]);
    expect(o.discountTotal).toBe(0);
    const bad = await post(`/orders/${o.id}/coupon`, f.tokens.cajero, { code: 'NOEXISTE' });
    expect(bad.status).toBe(404);
    const ok = await post(`/orders/${o.id}/coupon`, f.tokens.cajero, { code: 'RETRO10' });
    expect(ok.body.discountTotal).toBe(12.9);
    const rm = await api.req('DELETE', `/orders/${o.id}/coupon/RETRO10`, { token: f.tokens.cajero });
    expect(rm.body.discountTotal).toBe(0);
  });
});

describe('lealtad y CRM', () => {
  it('acumula puntos al cobrar (cada $10 = 1 punto), actualiza estadísticas y segmento', async () => {
    const c = await customer('Marty McFly', '555-0001', 'marty@x.test');
    const o = await order([item(f.prod.burger), item(f.prod.papas)], { customerId: c.id });
    const paid = await post(`/orders/${o.id}/pay`, f.tokens.cajero, { payments: [{ method: 'CASH', amount: 178 }] });
    expect(paid.body.paymentStatus).toBe('PAID');
    const acc = (await get(`/loyalty/customers/${c.id}`, f.tokens.cajero)).body;
    expect(acc.balance).toBe(17);                              // floor(178/10)
    const cust = (await get(`/customers/${c.id}`, f.tokens.cajero)).body;
    expect(cust).toMatchObject({ visits: 1, totalSpent: 178, segment: 'NUEVO' });
  });

  it('canje de recompensa aplica descuento de producto gratis y descuenta puntos', async () => {
    const c = await customer('Jessie Spano', '555-0002', 'jessie@x.test');
    await post('/loyalty/adjust', f.admin, { customerId: c.id, points: 120, reason: 'Bienvenida' });
    const reward = (await post('/loyalty/rewards', f.admin, { name: 'Papas gratis', pointsCost: 100, productId: f.prod.papas, isActive: true })).body;
    const o = await order([item(f.prod.burger), item(f.prod.papas)], { customerId: c.id });
    const r = await post('/loyalty/redeem', f.tokens.cajero, { customerId: c.id, rewardId: reward.id, orderId: o.id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await get(`/orders/${o.id}`, f.tokens.cajero)).body.total).toBe(129);
    expect((await get(`/loyalty/customers/${c.id}`, f.tokens.cajero)).body.balance).toBe(20);
    const poor = await post('/loyalty/redeem', f.tokens.cajero, { customerId: c.id, rewardId: reward.id, orderId: o.id });
    expect(poor.status).toBe(400);
    // cancelar la orden devuelve los puntos
    await post(`/orders/${o.id}/cancel`, f.tokens.cajero, { reason: 'Cambio de opinión' });
    expect((await get(`/loyalty/customers/${c.id}`, f.tokens.cajero)).body.balance).toBe(120);
  });

  it('devolución total revierte puntos ganados; puntos dobles multiplican', async () => {
    const c = await customer('Zack Morris', '555-0003', 'zack@x.test');
    const dp = (await post('/promotions', f.admin, { name: 'Puntos dobles', type: 'DOUBLE_POINTS', config: { multiplier: 2 }, stackable: true })).body;
    const o = await order([item(f.prod.burger)], { customerId: c.id });
    await post(`/orders/${o.id}/pay`, f.tokens.cajero, { payments: [{ method: 'CARD', amount: 129 }] });
    expect((await get(`/loyalty/customers/${c.id}`, f.tokens.cajero)).body.balance).toBe(24);   // floor(129/10)=12 × 2
    await post(`/orders/${o.id}/refund`, f.tokens.cajero, { method: 'CARD', reason: 'Producto frío', supervisor: { userCode: f.users.gerente!.userCode, pin: '1234' } });
    expect((await get(`/loyalty/customers/${c.id}`, f.tokens.cajero)).body.balance).toBe(0);
    expect((await get(`/customers/${c.id}`, f.tokens.cajero)).body.visits).toBe(0);
    await api.req('DELETE', `/promotions/${dp.id}`, { token: f.admin });
  });

  it('el ledger de puntos es inmutable y el teléfono duplicado se rechaza', async () => {
    await expect(f.sql('UPDATE loyalty_transactions SET points = 1')).rejects.toThrow(/append-only/);
    const dup = await post('/customers', f.tokens.cajero, { name: 'Otro', phone: '555-0001' });
    expect(dup.status).toBe(409);
  });
});

describe('reservaciones', () => {
  it('crea, evita empalmes, confirma, marca llegada abriendo la mesa', async () => {
    const startsAt = new Date(Date.now() + 3600_000).toISOString();
    const r = await post('/reservations', f.tokens.mesero, { branchId: f.branchId, customerName: 'Familia Walsh', phone: '555-0100', partySize: 4, startsAt, tableId: f.tables[1] });
    expect(r.status, JSON.stringify(r.body)).toBe(201); expect(r.body.status).toBe('CONFIRMED');
    const clash = await post('/reservations', f.tokens.mesero, { branchId: f.branchId, customerName: 'Otro', partySize: 2, startsAt: new Date(Date.now() + 3600_000 + 30 * 60_000).toISOString(), tableId: f.tables[1] });
    expect(clash.status).toBe(409);
    const tooBig = await post('/reservations', f.tokens.mesero, { branchId: f.branchId, customerName: 'Grupo', partySize: 12, startsAt, tableId: f.tables[2] });
    expect(tooBig.status).toBe(400);
    const av = (await get(`/reservations/availability?branchId=${f.branchId}&startsAt=${encodeURIComponent(startsAt)}&partySize=2`, f.tokens.mesero)).body;
    expect(av.map((t: any) => t.id)).not.toContain(f.tables[1]);
    const arrived = await post(`/reservations/${r.body.id}/arrive`, f.tokens.mesero);
    expect(arrived.body.status).toBe('ARRIVED'); expect(arrived.body.sessionId).toBeTruthy();
    const map = (await get(`/tables?branchId=${f.branchId}`, f.tokens.mesero)).body;
    expect(map.find((t: any) => t.id === f.tables[1]).status).toBe('OCCUPIED');
    expect((await post(`/reservations/${r.body.id}/cancel`, f.tokens.mesero)).status).toBe(409);
  });

  it('mesa con reservación próxima se muestra RESERVADA; no-show y cancelación liberan', async () => {
    const r = (await post('/reservations', f.tokens.mesero, { branchId: f.branchId, customerName: 'Pronto', partySize: 2, startsAt: new Date(Date.now() + 20 * 60_000).toISOString(), tableId: f.tables[3] })).body;
    expect((await get(`/tables?branchId=${f.branchId}`, f.tokens.mesero)).body.find((t: any) => t.id === f.tables[3]).status).toBe('RESERVED');
    // job de recordatorio (30 min antes)
    const jobs = api.app.get(JobsService);
    await jobs.runOnce();
    const n1 = (await get('/notifications', f.tokens.gerente)).body.filter((n: any) => n.type === 'RESERVATION_SOON');
    expect(n1.length).toBe(1);
    await jobs.runOnce();                                        // idempotente por dedupe
    expect((await get('/notifications', f.tokens.gerente)).body.filter((n: any) => n.type === 'RESERVATION_SOON').length).toBe(1);
    await post(`/reservations/${r.id}/no-show`, f.tokens.mesero);
    expect((await get(`/tables?branchId=${f.branchId}`, f.tokens.mesero)).body.find((t: any) => t.id === f.tables[3]).status).toBe('FREE');
  });
});

describe('delivery', () => {
  it('pedido → confirmado (cocina) → listo → repartidor → entregado → cobro', async () => {
    const d = await post('/delivery-orders', f.tokens.cajero, { branchId: f.branchId, customerName: 'Will Smith', phone: '555-0199', address: 'Bel-Air 10, Col. Fresh', fee: 30, paymentMethod: 'CASH', items: [item(f.prod.burger), item(f.prod.papas)] });
    expect(d.status, JSON.stringify(d.body)).toBe(201); expect(d.body.status).toBe('RECEIVED'); expect(d.body.total).toBe(129 + 49 + 30);
    expect((await post(`/delivery-orders/${d.body.id}/status`, f.tokens.cajero, { to: 'ON_THE_WAY' })).status).toBe(409);   // salto inválido
    const conf = await post(`/delivery-orders/${d.body.id}/status`, f.tokens.cajero, { to: 'CONFIRMED' });
    expect(conf.body.status).toBe('CONFIRMED');
    const tickets = (await get(`/kitchen/tickets?branchId=${f.branchId}`, f.tokens.cocinero)).body.filter((t: any) => t.orderId === d.body.orderId);
    expect(tickets.length).toBe(2);
    for (const t of tickets) for (const to of ['PREPARING', 'READY']) await api.req('PATCH', `/kitchen/tickets/${t.id}/status`, { token: f.tokens.cocinero, body: { to } });
    expect((await get(`/delivery-orders/${d.body.id}`, f.tokens.cajero)).body.status).toBe('READY');
    const noDriver = await post(`/delivery-orders/${d.body.id}/status`, f.tokens.cajero, { to: 'ON_THE_WAY' });
    expect(noDriver.status).toBe(400);
    expect((await post(`/delivery-orders/${d.body.id}/assign`, f.tokens.cajero, { driverId: f.users.cajero!.id })).status).toBe(400);   // no es repartidor
    const asg = await post(`/delivery-orders/${d.body.id}/assign`, f.tokens.cajero, { driverId: f.users.repartidor!.id });
    expect(asg.body.driverName).toBeTruthy();
    expect((await post(`/delivery-orders/${d.body.id}/status`, f.tokens.repartidor, { to: 'ON_THE_WAY' })).body.status).toBe('ON_THE_WAY');
    const mine = (await get(`/delivery-orders/mine?branchId=${f.branchId}`, f.tokens.repartidor)).body;
    expect(mine.map((x: any) => x.id)).toContain(d.body.id);
    expect((await post(`/delivery-orders/${d.body.id}/status`, f.tokens.repartidor, { to: 'DELIVERED' })).body.status).toBe('DELIVERED');
    const pay = await post(`/orders/${d.body.orderId}/pay`, f.tokens.cajero, { payments: [{ method: 'CASH', amount: 208, tendered: 250 }] });
    expect(pay.body.status).toBe('COMPLETED'); expect(pay.body.change).toBe(42);
    const hist = (await get(`/delivery-orders/${d.body.id}`, f.tokens.cajero)).body.history.map((h: any) => h.status);
    expect(hist).toEqual(['RECEIVED', 'CONFIRMED', 'PREPARING', 'READY', 'ON_THE_WAY', 'DELIVERED']);
  });
  it('un repartidor no puede ver ni operar pedidos de otros', async () => {
    const d = (await post('/delivery-orders', f.tokens.cajero, { branchId: f.branchId, customerName: 'X', phone: '5550000000', address: 'Calle falsa 123', items: [item(f.prod.papas)] })).body;
    expect((await post(`/delivery-orders/${d.id}/status`, f.tokens.repartidor, { to: 'CONFIRMED' })).status).toBe(403);
    expect((await get(`/delivery-orders?branchId=${f.branchId}`, f.tokens.repartidor)).status).toBe(403);
    expect((await get(`/delivery-orders/mine?branchId=${f.branchId}`, f.tokens.repartidor)).body.map((x: any) => x.id)).not.toContain(d.id);
  });
});

describe('API pública, QR y pedidos en línea', () => {
  it('menú público sin costos ni autenticación; pedido para recoger queda pendiente', async () => {
    const info = await api.req('GET', `/public/${f.t.slug}`);
    expect(info.status).toBe(200); expect(info.body.branches).toHaveLength(1);
    const menu = (await api.req('GET', `/public/${f.t.slug}/menu?branchId=${f.branchId}`)).body;
    expect(menu.products.length).toBeGreaterThan(3);
    expect(JSON.stringify(menu)).not.toMatch(/cost|margin|avg_cost/i);
    const o = await api.req('POST', `/public/${f.t.slug}/orders`, { body: { branchId: f.branchId, type: 'PICKUP', customer: { name: 'Elaine Benes', phone: '5551234567' }, items: [item(f.prod.burger), item(f.prod.cola)] } });
    expect(o.status, JSON.stringify(o.body)).toBe(201); expect(o.body.total).toBe(164);
    const st = await api.req('GET', `/public/${f.t.slug}/orders/${o.body.orderId}`);
    expect(st.body.status).toBe('PENDING');
    const staff = (await get(`/orders/${o.body.orderId}`, f.tokens.cajero)).body;
    expect(staff.customerName).toBe('Elaine Benes');
    expect((await get('/notifications', f.tokens.cajero)).body.some((n: any) => n.type === 'ONLINE_ORDER')).toBe(true);
    // un tenant inexistente o un id ajeno no filtran datos
    expect((await api.req('GET', '/public/no-existe/menu?branchId=' + f.branchId)).status).toBe(404);
    expect((await api.req('GET', `/public/${f.t.slug}/orders/${randomUUID()}`)).status).toBe(404);
  });

  it('QR de mesa: ver menú, pedir (queda por confirmar), llamar mesero y pedir cuenta con anti-spam', async () => {
    const token = (await get(`/tables?branchId=${f.branchId}`, f.tokens.mesero)).body.find((t: any) => t.id === f.tables[0]).qrToken;
    const t = await api.req('GET', `/public/${f.t.slug}/tables/${token}`);
    expect(t.body.table.number).toBe(1);
    const o = await api.req('POST', `/public/${f.t.slug}/tables/${token}/orders`, { body: { items: [item(f.prod.papas)], customerName: 'Mesa 1' } });
    expect(o.status, JSON.stringify(o.body)).toBe(201); expect(o.body.confirmed).toBe(false); expect(o.body.status).toBe('PENDING');
    const bill = (await api.req('GET', `/public/${f.t.slug}/tables/${token}/bill`)).body;
    expect(bill.total).toBe(49);
    await api.req('POST', `/public/${f.t.slug}/tables/${token}/call-waiter`); await api.req('POST', `/public/${f.t.slug}/tables/${token}/call-waiter`);
    await api.req('POST', `/public/${f.t.slug}/tables/${token}/request-bill`);
    const notes = (await get('/notifications', f.tokens.mesero)).body;
    expect(notes.filter((n: any) => n.type === 'CALL_WAITER').length).toBe(1);
    expect(notes.some((n: any) => n.type === 'REQUEST_BILL')).toBe(true);
    // el mesero confirma el pedido QR (lo envía a cocina)
    const sent = await post(`/orders/${o.body.orderId}/send-to-kitchen`, f.tokens.mesero);
    expect(sent.body.status).toBe('CONFIRMED');
    expect((await api.req('GET', `/public/${f.t.slug}/tables/token-invalido`)).status).toBe(404);
  });

  it('reservación pública asigna la mesa más ajustada; consulta de puntos exige teléfono y correo', async () => {
    const startsAt = new Date(Date.now() + 7200_000 * 3).toISOString();
    const r = await api.req('POST', `/public/${f.t.slug}/reservations`, { body: { branchId: f.branchId, customerName: 'Kevin Arnold', phone: '5559876543', partySize: 3, startsAt } });
    expect(r.status, JSON.stringify(r.body)).toBe(201); expect(r.body.status).toBe('PENDING'); expect(r.body.tableId).toBeTruthy();
    expect((await api.req('GET', `/public/${f.t.slug}/loyalty?phone=555-0001&email=marty@x.test`)).body.balance).toBe(17);
    expect((await api.req('GET', `/public/${f.t.slug}/loyalty?phone=555-0001&email=otro@x.test`)).status).toBe(404);
  });
});

describe('sincronización offline', () => {
  it('aplica operaciones en orden, es idempotente y manda lo irreparable a la bandeja de excepciones', async () => {
    const cu = randomUUID(); const opCreate = randomUUID(); const opPay = randomUUID(); const opBad = randomUUID();
    const payUuid = randomUUID();
    const body = { deviceId: 'pos-1', branchId: f.branchId, operations: [
      { opId: opPay, type: 'ORDER_PAY', createdAt: new Date(Date.now() - 1000).toISOString(), payload: { orderClientUuid: cu, payments: [{ method: 'CASH', amount: 49, clientUuid: payUuid }] } },
      { opId: opCreate, type: 'ORDER_CREATE', createdAt: new Date(Date.now() - 5000).toISOString(), payload: { clientUuid: cu, branchId: f.branchId, channel: 'TAKEAWAY', send: true, items: [item(f.prod.papas)] } },
      { opId: opBad, type: 'ORDER_PAY', createdAt: new Date().toISOString(), payload: { orderClientUuid: randomUUID(), payments: [{ method: 'CASH', amount: 10 }] } },
    ] };
    const r = await post('/sync/push', f.tokens.cajero, body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.applied).toBe(2); expect(r.body.needsReview).toBe(1);        // se ordena por captura: crear → pagar
    const again = await post('/sync/push', f.tokens.cajero, body);
    expect(again.body.results.filter((x: any) => x.status === 'DUPLICATE').length).toBe(2);
    expect((await f.sql('SELECT count(*)::int n FROM orders WHERE client_uuid=$1', [cu]))[0].n).toBe(1);
    expect((await f.sql('SELECT payment_status FROM orders WHERE client_uuid=$1', [cu]))[0].payment_status).toBe('PAID');
    const ex = (await get(`/sync/exceptions?branchId=${f.branchId}`, f.tokens.gerente)).body;
    expect(ex).toHaveLength(1); expect(ex[0].type).toBe('ORDER_PAY');
    const retry = await post(`/sync/exceptions/${ex[0].id}/retry`, f.tokens.gerente);
    expect(retry.body.status).toBe('NEEDS_REVIEW');
    expect((await post(`/sync/exceptions/${ex[0].id}/resolve`, f.tokens.gerente, { note: 'Orden inexistente, ignorada por el gerente' })).body.status).toBe('RESOLVED');
    expect((await get(`/sync/exceptions?branchId=${f.branchId}`, f.tokens.gerente)).body).toHaveLength(0);
  });

  it('venta offline sin stock se aplica y se marca para revisión (no se pierde)', async () => {
    const cola = await f.stock('COLA');
    await post('/inventory/movements', f.admin, { branchId: f.branchId, ingredientId: f.ing.COLA, type: 'ADJUSTMENT', qty: -cola, reason: 'Vaciar para prueba' });
    const cu = randomUUID();
    const r = await post('/sync/push', f.tokens.cajero, { deviceId: 'pos-1', branchId: f.branchId, operations: [{ opId: randomUUID(), type: 'ORDER_CREATE', createdAt: new Date().toISOString(), payload: { clientUuid: cu, branchId: f.branchId, channel: 'TAKEAWAY', send: true, items: [item(f.prod.cola)] } }] });
    expect(r.body.applied).toBe(1);
    const o = (await f.sql('SELECT needs_review FROM orders WHERE client_uuid=$1', [cu]))[0];
    expect(o.needs_review).toBe(true);
    expect(await f.stock('COLA')).toBe(-1);
  });

  it('pull devuelve snapshot para caché (menú, mesas, promociones)', async () => {
    const p = (await get(`/sync/pull?branchId=${f.branchId}`, f.tokens.cajero)).body;
    expect(p.menu.products.length).toBeGreaterThan(3); expect(p.tables).toHaveLength(4); expect(p.shift.id).toBeTruthy();
  });
});

describe('impresión', () => {
  it('encola comanda por estación y ticket al cobrar; el agente confirma', async () => {
    const pr = await post('/printers', f.admin, { branchId: f.branchId, name: 'Cocina', role: 'KITCHEN', columns: 32, stationKeys: [] });
    const cash = await post('/printers', f.admin, { branchId: f.branchId, name: 'Caja', role: 'CASH', columns: 42 });
    expect(pr.status).toBe(201);
    const o = await order([item(f.prod.papas)], { send: true });
    const jobs = (await get(`/print/jobs/pending?printerId=${pr.body.id}`, f.admin)).body;
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0].content).toContain('1 X PAPAS CLÁSICAS');
    expect(Math.max(...jobs[0].content.split('\n').map((l: string) => l.length))).toBeLessThanOrEqual(32);
    await post(`/orders/${o.id}/pay`, f.tokens.cajero, { payments: [{ method: 'CASH', amount: 49 }] });
    const rec = (await get(`/print/jobs/pending?printerId=${cash.body.id}`, f.admin)).body;
    expect(rec.some((j: any) => j.kind === 'RECEIPT' && j.content.includes('TOTAL'))).toBe(true);
    expect((await post(`/print/jobs/${jobs[0].id}/ack`, f.admin, { ok: true })).body.status).toBe('PRINTED');
    const txt = await api.app.inject({ method: 'GET', url: `/orders/${o.id}/receipt.txt`, headers: { authorization: `Bearer ${f.tokens.cajero}` } });
    expect(txt.body).toContain('Orden #');
  });
});

describe('folios', () => {
  it('el contador de folios usa el día operativo en formato ISO y consecutivos', async () => {
    const a = await order([item(f.prod.papas)]); const b = await order([item(f.prod.papas)]);
    expect(b.number).toBe(a.number + 1);
    const scopes = await f.sql(`SELECT scope FROM counters WHERE scope LIKE 'order:%'`);
    expect(scopes.every((s: any) => /^order:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/.test(s.scope))).toBe(true);
  });
});
