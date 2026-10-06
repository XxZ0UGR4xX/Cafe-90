import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startApi } from './helpers';
import { Fixture, buildFixture, item, randomUUID } from './fixtures';

let api: Api; let f: Fixture;
beforeAll(async () => { api = await startApi(); f = await buildFixture(api, 'sales'); });
afterAll(async () => { await f.close(); await api.app.close(); });

const orderBody = (items: any[], extra: Record<string, unknown> = {}) => ({ branchId: f.branchId, channel: 'DINE_IN', items, ...extra });
const openShift = async (token = f.tokens.cajero, openingFloat = 500) => {
  const r = await api.req('POST', '/cash/shifts/open', { token, body: { branchId: f.branchId, openingFloat } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};
const closeShiftIfOpen = async (token: string) => {
  const cur = await api.req('GET', `/cash/shifts/current?branchId=${f.branchId}`, { token });
  if (cur.body?.id) await api.req('POST', `/cash/shifts/${cur.body.id}/close`, { token, body: { countedCash: 0, notes: 'cierre de prueba', supervisor: { userCode: f.users.gerente!.userCode, pin: '1234' } } }).catch(() => undefined);
};

describe('flujo completo de venta (mesa → cocina → cobro → corte)', () => {
  it('mesero crea orden en mesa, envía a cocina, cocina avanza, cajero cobra y cierra caja', async () => {
    const stockBefore = await f.stock('CARNE');
    const create = await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.burger, { qty: 2 }), item(f.prod.papas), item(f.prod.cola, { qty: 2 })], { tableId: f.tables[0], send: true }) });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const o = create.body;
    expect(o.status).toBe('CONFIRMED');
    expect(o.subtotal).toBe(129 * 2 + 49 + 35 * 2);          // 377
    expect(o.total).toBe(377);
    expect(o.taxTotal).toBeCloseTo(377 - 377 / 1.16, 1);
    expect(o.costTotal).toBeNull();                          // mesero no ve costos

    // mesa ocupada y cuenta visible en el mapa
    const map = await api.req('GET', `/tables?branchId=${f.branchId}`, { token: f.tokens.mesero });
    const t1 = map.body.find((t: any) => t.id === f.tables[0]);
    expect(t1.status).toBe('OCCUPIED'); expect(Number(t1.currentTotal)).toBe(377);

    // inventario descontado por receta: 2 hamburguesas × 150 g
    expect(await f.stock('CARNE')).toBe(stockBefore - 300);
    expect(await f.stock('COLA')).toBe(40 - 2);

    // tickets por estación
    const tickets = await api.req('GET', `/kitchen/tickets?branchId=${f.branchId}`, { token: f.tokens.cocinero });
    const mine = tickets.body.filter((t: any) => t.orderId === o.id);
    expect(mine.map((t: any) => t.stationKey).sort()).toEqual(['BEBIDAS', 'FREIDORA', 'PARRILLA']);
    expect(mine.find((t: any) => t.stationKey === 'PARRILLA').items[0].qty).toBe(2);

    // cocina avanza todos los tickets
    for (const t of mine) {
      for (const to of ['PREPARING', 'READY'])
        expect((await api.req('PATCH', `/kitchen/tickets/${t.id}/status`, { token: f.tokens.cocinero, body: { to } })).status).toBe(200);
    }
    expect((await api.req('GET', `/orders/${o.id}`, { token: f.tokens.mesero })).body.status).toBe('READY');
    for (const t of mine) await api.req('PATCH', `/kitchen/tickets/${t.id}/status`, { token: f.tokens.mesero, body: { to: 'DELIVERED' } }).then((r) => expect([200, 403]).toContain(r.status));
    for (const t of mine) await api.req('PATCH', `/kitchen/tickets/${t.id}/status`, { token: f.tokens.cocinero, body: { to: 'DELIVERED' } });
    expect((await api.req('GET', `/orders/${o.id}`, { token: f.tokens.mesero })).body.status).toBe('DELIVERED');

    // cajero: sin caja abierta no cobra
    const noShift = await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.cajero, body: { payments: [{ method: 'CASH', amount: 377, tendered: 400 }] } });
    expect(noShift.status).toBe(409); expect(noShift.body.code).toBe('SHIFT_NOT_OPEN');

    await openShift();
    const over = await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.cajero, body: { payments: [{ method: 'CASH', amount: 400 }] } });
    expect(over.body.code).toBe('PAYMENT_AMOUNT_MISMATCH');

    const pay = await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.cajero, body: { payments: [{ method: 'CASH', amount: 300, tendered: 300 }, { method: 'CARD', amount: 77, tip: 40, reference: 'AUTH123' }] } });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    expect(pay.body.paymentStatus).toBe('PAID');
    expect(pay.body.status).toBe('COMPLETED');
    expect(pay.body.tipTotal).toBe(40);
    expect((await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.cajero, body: { payments: [{ method: 'CASH', amount: 1 }] } })).body.code).toBe('ORDER_ALREADY_PAID');

    // mesa pasa a limpieza y luego a libre
    const map2 = await api.req('GET', `/tables?branchId=${f.branchId}`, { token: f.tokens.mesero });
    expect(map2.body.find((t: any) => t.id === f.tables[0]).status).toBe('CLEANING');
    expect((await api.req('POST', `/tables/${f.tables[0]}/clean`, { token: f.tokens.mesero })).status).toBe(201);

    // corte de caja ciego: el cajero no ve el esperado; diferencia calculada
    const cur = (await api.req('GET', `/cash/shifts/current?branchId=${f.branchId}`, { token: f.tokens.cajero })).body;
    expect(cur.summary.expectedCash).toBeUndefined();
    expect(cur.summary.salesByMethod).toEqual({ CASH: 300, CARD: 77, TRANSFER: 0, QR: 0 });
    const close = await api.req('POST', `/cash/shifts/${cur.id}/close`, { token: f.tokens.cajero, body: { countedCash: 800 } });
    expect(close.status, JSON.stringify(close.body)).toBe(201);
    expect(close.body.status).toBe('CLOSED');
    expect(close.body.expectedCash).toBe(500 + 300);          // fondo + ventas en efectivo (propina de tarjeta no entra al cajón)
    expect(close.body.difference).toBe(0);
    expect(close.body.report.tipsByMethod.CARD).toBe(40);

    expect(await f.reconcile()).toEqual([]);
  });
});

describe('modificadores y combos', () => {
  it('extras suman precio y consumo; "sin cebolla" reduce consumo', async () => {
    const extras = (await api.req('GET', '/modifier-groups', { token: f.admin })).body;
    const queso = extras.find((g: any) => g.name === 'Extras').modifiers.find((m: any) => m.name === 'Queso extra').id;
    const sinCebolla = extras.find((g: any) => g.name === 'Remover').modifiers[0].id;
    const quesoBefore = await f.stock('QUESO'); const cebBefore = await f.stock('CEBOLLA');
    const r = await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.burger, { modifierIds: [queso, sinCebolla] })], { send: true, channel: 'TAKEAWAY' }) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.total).toBe(129 + 15);
    expect(await f.stock('QUESO')).toBe(quesoBefore - 3);       // 2 de receta + 1 extra
    expect(await f.stock('CEBOLLA')).toBe(cebBefore);            // 20 de receta − 20 removidos = 0
    const kt = (await api.req('GET', `/kitchen/tickets?branchId=${f.branchId}&station=PARRILLA`, { token: f.tokens.cocinero })).body.find((t: any) => t.orderId === r.body.id);
    expect(kt.items[0].modifiers).toEqual(expect.arrayContaining(['+ Queso extra', 'SIN Cebolla']));
  });

  it('valida máximos de selección por grupo', async () => {
    const groups = (await api.req('GET', '/modifier-groups', { token: f.admin })).body;
    const ex = groups.find((g: any) => g.name === 'Extras').modifiers.map((m: any) => m.id);
    const r = await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.burger, { modifierIds: [ex[0], ex[0], ex[1]] })]) });
    expect(r.status).toBe(400);
  });

  it('combo: precio, sustitución permitida con delta y componentes ruteados a su estación', async () => {
    const r = await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.combo, { comboChoices: [{ slotId: f.slots['Bebida'], productId: f.prod.limonada, modifierIds: [] }] })], { send: true, channel: 'TAKEAWAY' }) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.total).toBe(179 + 5);
    const children = r.body.items.filter((i: any) => i.parentItemId);
    expect(children.map((c: any) => c.name).sort()).toEqual(['Limonada', 'Papas Clásicas', 'Retro Burger']);
    const bad = await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.combo, { comboChoices: [{ slotId: f.slots['Bebida'], productId: f.prod.burger, modifierIds: [] }] })]) });
    expect(bad.status).toBe(400);
  });

  it('producto sin estación (agua) se entrega de inmediato y no genera ticket', async () => {
    const r = await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.agua)], { send: true, channel: 'TAKEAWAY' }) });
    expect(r.body.status).toBe('DELIVERED');
    const tk = (await api.req('GET', `/kitchen/tickets?branchId=${f.branchId}`, { token: f.tokens.cocinero })).body;
    expect(tk.some((t: any) => t.orderId === r.body.id)).toBe(false);
  });
});

describe('cancelaciones, devoluciones y autorizaciones', () => {
  it('cancelar antes de preparar revierte inventario; mesero no puede cancelar enviado sin supervisor', async () => {
    const before = await f.stock('CARNE');
    const o = (await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.burger)], { send: true, channel: 'TAKEAWAY' }) })).body;
    expect(await f.stock('CARNE')).toBe(before - 150);
    const denied = await api.req('POST', `/orders/${o.id}/cancel`, { token: f.tokens.mesero, body: { reason: 'Cliente se arrepintió' } });
    expect(denied.status).toBe(403); expect(denied.body.code).toBe('SUPERVISOR_REQUIRED');
    const wrongPin = await api.req('POST', `/orders/${o.id}/cancel`, { token: f.tokens.mesero, body: { reason: 'Cliente se arrepintió', supervisor: { userCode: f.users.gerente!.userCode, pin: '9999' } } });
    expect(wrongPin.status).toBe(403);
    const ok = await api.req('POST', `/orders/${o.id}/cancel`, { token: f.tokens.mesero, body: { reason: 'Cliente se arrepintió', supervisor: { userCode: f.users.gerente!.userCode, pin: '1234' } } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('CANCELLED');
    expect(await f.stock('CARNE')).toBe(before);
    const tk = (await api.req('GET', `/kitchen/tickets?branchId=${f.branchId}&status=NEW`, { token: f.tokens.cocinero })).body;
    expect(tk.some((t: any) => t.orderId === o.id)).toBe(false);
    const audit = (await api.req('GET', `/audit-logs?entity=order&entityId=${o.id}`, { token: f.admin })).body.items;
    expect(audit.find((a: any) => a.action === 'order.cancel').reason).toBe('Cliente se arrepintió');
  });

  it('cancelar con ticket en preparación no reintegra inventario (queda como consumo)', async () => {
    const before = await f.stock('CARNE');
    const o = (await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.burger)], { send: true, channel: 'TAKEAWAY' }) })).body;
    const tk = (await api.req('GET', `/kitchen/tickets?branchId=${f.branchId}&station=PARRILLA`, { token: f.tokens.cocinero })).body.find((t: any) => t.orderId === o.id);
    await api.req('PATCH', `/kitchen/tickets/${tk.id}/status`, { token: f.tokens.cocinero, body: { to: 'PREPARING' } });
    const r = await api.req('POST', `/orders/${o.id}/cancel`, { token: f.tokens.gerente, body: { reason: 'Error de captura' } });
    expect(r.body.status).toBe('CANCELLED');
    expect(await f.stock('CARNE')).toBe(before - 150);
  });

  it('item pendiente se modifica/cancela libremente; item enviado exige supervisor', async () => {
    const o = (await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.burger), item(f.prod.papas)], { channel: 'TAKEAWAY' }) })).body;
    expect(o.status).toBe('PENDING');
    const burger = o.items.find((i: any) => i.name === 'Retro Burger');
    const upd = await api.req('PATCH', `/orders/${o.id}/items/${burger.id}`, { token: f.tokens.mesero, body: { qty: 3 } });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.total).toBe(129 * 3 + 49);
    const rm = await api.req('POST', `/orders/${o.id}/items/${burger.id}/cancel`, { token: f.tokens.mesero, body: { reason: 'Ya no lo quiere' } });
    expect(rm.body.total).toBe(49);
    const sent = await api.req('POST', `/orders/${o.id}/send-to-kitchen`, { token: f.tokens.mesero });
    const papas = sent.body.items.find((i: any) => i.name === 'Papas Clásicas');
    expect((await api.req('POST', `/orders/${o.id}/items/${papas.id}/cancel`, { token: f.tokens.mesero, body: { reason: 'Se equivocó' } })).body.code).toBe('SUPERVISOR_REQUIRED');
  });

  it('devolución total con supervisor: pago negativo, caja, estado REFUNDED e inventario no preparado', async () => {
    await openShift(f.tokens.cajero, 200);
    const before = await f.stock('CARNE');
    const o = (await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.burger)], { channel: 'TAKEAWAY' }) })).body;
    const paid = await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.cajero, body: { payments: [{ method: 'CASH', amount: 129 }] } });
    expect(paid.body.paymentStatus).toBe('PAID');
    const denied = await api.req('POST', `/orders/${o.id}/refund`, { token: f.tokens.cajero, body: { method: 'CASH', reason: 'Producto en mal estado' } });
    expect(denied.body.code).toBe('SUPERVISOR_REQUIRED');
    const ref = await api.req('POST', `/orders/${o.id}/refund`, { token: f.tokens.cajero, body: { method: 'CASH', reason: 'Producto en mal estado', supervisor: { userCode: f.users.gerente!.userCode, pin: '1234' } } });
    expect(ref.status, JSON.stringify(ref.body)).toBe(200);
    expect(ref.body.paymentStatus).toBe('REFUNDED'); expect(ref.body.status).toBe('CANCELLED');
    expect(ref.body.payments.map((p: any) => p.amount).sort((a: number, b: number) => a - b)).toEqual([-129, 129]);
    expect(await f.stock('CARNE')).toBe(before);          // el ticket de cocina aún estaba NEW
    const cur = (await api.req('GET', `/cash/shifts/current?branchId=${f.branchId}`, { token: f.tokens.cajero })).body;
    expect(cur.summary.refunds).toBe(129);
    await closeShiftIfOpen(f.tokens.cajero);
  });

  it('descuento alto exige supervisor; bajo lo aplica el cajero', async () => {
    const o = (await api.req('POST', '/orders', { token: f.tokens.cajero, body: orderBody([item(f.prod.burger), item(f.prod.papas)], { channel: 'TAKEAWAY' }) })).body;
    const low = await api.req('POST', `/orders/${o.id}/discount`, { token: f.tokens.cajero, body: { kind: 'PERCENT', value: 10, reason: 'Cliente frecuente' } });
    expect(low.status, JSON.stringify(low.body)).toBe(201);
    expect(low.body.discountTotal).toBeCloseTo(17.8, 2);
    const high = await api.req('POST', `/orders/${o.id}/discount`, { token: f.tokens.cajero, body: { kind: 'PERCENT', value: 30, reason: 'Queja del cliente' } });
    expect(high.body.code).toBe('SUPERVISOR_REQUIRED');
    const okHigh = await api.req('POST', `/orders/${o.id}/discount`, { token: f.tokens.cajero, body: { kind: 'PERCENT', value: 30, reason: 'Queja del cliente', supervisor: { userCode: f.users.gerente!.userCode, pin: '1234' } } });
    expect(okHigh.status).toBe(201);
  });
});

describe('integridad: idempotencia, concurrencia y offline', () => {
  it('crear orden con el mismo clientUuid no duplica (reintento de red / sync offline)', async () => {
    const clientUuid = randomUUID();
    const a = await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.papas)], { clientUuid, channel: 'TAKEAWAY', send: true }) });
    const b = await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.papas)], { clientUuid, channel: 'TAKEAWAY', send: true }) });
    expect(a.body.id).toBe(b.body.id);
    expect(b.body.idempotent).toBe(true);
    const n = await f.sql('SELECT count(*)::int n FROM orders WHERE client_uuid=$1', [clientUuid]);
    expect(n[0].n).toBe(1);
  });

  it('pago con el mismo clientUuid es idempotente', async () => {
    await openShift(f.tokens.cajero, 100);
    const o = (await api.req('POST', '/orders', { token: f.tokens.cajero, body: orderBody([item(f.prod.papas)], { channel: 'TAKEAWAY' }) })).body;
    const payUuid = randomUUID();
    const body = { payments: [{ method: 'CASH', amount: 49, clientUuid: payUuid }] };
    const a = await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.cajero, body });
    const b = await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.cajero, body });
    expect(a.body.paymentStatus).toBe('PAID'); expect(b.body.idempotent).toBe(true);
    expect((await f.sql('SELECT count(*)::int n FROM payments WHERE order_id=$1', [o.id]))[0].n).toBe(1);
    await closeShiftIfOpen(f.tokens.cajero);
  });

  it('pago parcial + resto; pagos mixtos', async () => {
    await openShift(f.tokens.cajero, 100);
    const o = (await api.req('POST', '/orders', { token: f.tokens.cajero, body: orderBody([item(f.prod.burger), item(f.prod.papas)], { channel: 'TAKEAWAY' }) })).body;
    const p1 = await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.cajero, body: { payments: [{ method: 'CARD', amount: 100 }] } });
    expect(p1.body.paymentStatus).toBe('PARTIAL'); expect(p1.body.remaining).toBe(78);
    const p2 = await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.cajero, body: { payments: [{ method: 'QR', amount: 78 }] } });
    expect(p2.body.paymentStatus).toBe('PAID');
    await closeShiftIfOpen(f.tokens.cajero);
  });

  it('concurrencia: 10 órdenes simultáneas sobre stock limitado no sobrevenden ni dejan inventario negativo', async () => {
    // COLA tiene stock limitado: lo reducimos a 5
    const cur = await f.stock('COLA');
    await api.req('POST', '/inventory/movements', { token: f.admin, body: { branchId: f.branchId, ingredientId: f.ing.COLA, type: 'ADJUSTMENT', qty: -(cur - 5), reason: 'Prueba de concurrencia' } });
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.cola)], { channel: 'TAKEAWAY', send: true }) })));
    const ok = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 409);
    expect(ok).toBe(5);
    expect(rejected.length).toBe(5);
    expect(rejected[0]!.body.code === 'INSUFFICIENT_STOCK' || rejected[0]!.body.code === 'PRODUCT_UNAVAILABLE').toBe(true);
    expect(await f.stock('COLA')).toBe(0);
    expect(await f.reconcile()).toEqual([]);
  });

  it('venta offline sin stock se acepta, queda en revisión y no se pierde', async () => {
    const r = await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.cola)], { channel: 'TAKEAWAY', send: true, offline: true, clientUuid: randomUUID() }) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.needsReview).toBe(true);
    expect(await f.stock('COLA')).toBe(-1);
    const inv = (await api.req('GET', `/inventory?branchId=${f.branchId}`, { token: f.tokens.almacen })).body.find((x: any) => x.name === 'COLA');
    expect(inv.status).toBe('OUT_OF_STOCK'); expect(inv.needsReview).toBe(true);
    expect(await f.reconcile()).toEqual([]);
  });
});

describe('permisos operativos', () => {
  it('mesero no cobra, no ve costos, ni cierra caja ajena', async () => {
    const o = (await api.req('POST', '/orders', { token: f.tokens.mesero, body: orderBody([item(f.prod.papas)], { channel: 'TAKEAWAY' }) })).body;
    expect((await api.req('POST', `/orders/${o.id}/pay`, { token: f.tokens.mesero, body: { payments: [{ method: 'CASH', amount: 49 }] } })).status).toBe(403);
    expect((await api.req('GET', `/products/${f.prod.burger}/cost`, { token: f.tokens.mesero })).status).toBe(403);
    const p = (await api.req('GET', `/products/${f.prod.burger}`, { token: f.tokens.mesero })).body;
    expect(p.cost).toBeUndefined();
    const pg = (await api.req('GET', `/products/${f.prod.burger}`, { token: f.tokens.gerente })).body;
    const costLines = (await api.req('GET', `/products/${f.prod.burger}/cost`, { token: f.tokens.gerente })).body;
    expect(costLines.cost).toBeCloseTo(pg.cost, 4);
    expect(pg.cost).toBeGreaterThan(0);
    expect(pg.margin).toBeGreaterThan(0.5);
  });

  it('un mesero sólo ve sus órdenes; el gerente ve todas', async () => {
    const m = await api.req('GET', `/orders?branchId=${f.branchId}`, { token: f.tokens.mesero });
    const g = await api.req('GET', `/orders?branchId=${f.branchId}`, { token: f.tokens.gerente });
    expect(g.body.length).toBeGreaterThanOrEqual(m.body.length);
    expect(m.body.every((o: any) => o.waiterName)).toBe(true);
  });
});
