import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, PASSWORD, createBranch, createUser, login, startApi } from './helpers';
import { Fixture, buildFixture, item, randomUUID } from './fixtures';

/** Controles añadidos tras la auditoría: alcance por sucursal, sesiones, impresión, caja y superficie pública. */
let api: Api; let f: Fixture; let branch2: string;
beforeAll(async () => { api = await startApi(); f = await buildFixture(api, 'audit'); branch2 = (await createBranch(api, f.admin, 'NORTE')).id; });
afterAll(async () => { await f.close(); await api.app.close(); });

const post = (url: string, token: string, body?: unknown, headers?: Record<string, string>) => api.req('POST', url, { token, body, headers });
const put = (url: string, token: string, body?: unknown, headers?: Record<string, string>) => api.req('PUT', url, { token, body, headers });
const orderBody = (items: any[], extra: Record<string, unknown> = {}) => ({ branchId: f.branchId, channel: 'TAKEAWAY', items, ...extra });

describe('alcance por sucursal', () => {
  it('configuración: un gerente de sucursal no escribe la global ni la de otra sucursal, y las claves se validan', async () => {
    expect((await put('/settings', f.tokens.gerente, { key: 'sales.discountThresholdPct', value: 100 })).status).toBe(403);               // global
    expect((await put('/settings', f.tokens.gerente, { key: 'sales.discountThresholdPct', value: 5, branchId: branch2 })).status).toBe(403);   // otra sucursal
    expect((await put('/settings', f.tokens.gerente, { key: 'sales.discountThresholdPct', value: 100, branchId: branch2 }, { 'x-branch-id': f.branchId })).status).toBe(403);   // cabecera ≠ cuerpo
    expect((await put('/settings', f.tokens.gerente, { key: 'sales.discountThresholdPct', value: 12, branchId: f.branchId })).status).toBe(200);
    expect((await put('/settings', f.admin, { key: 'inventado.clave', value: 1 })).status).toBe(400);
    expect((await put('/settings', f.admin, { key: 'sales.discountThresholdPct', value: 500 })).status).toBe(400);
    expect((await put('/settings', f.admin, { key: 'sales.discountThresholdPct', value: 'NaN' })).status).toBe(400);
  });

  it('asignar roles: no se puede dar alcance corporativo ni sucursales ajenas', async () => {
    const corp = await post('/users', f.tokens.gerente, { email: `x-${randomUUID().slice(0, 6)}@${f.t.slug}.test`, fullName: 'Intruso', password: PASSWORD, roles: [{ role: 'CAJERO', branchIds: null }] });
    expect(corp.status).toBe(403);
    const other = await post('/users', f.tokens.gerente, { email: `y-${randomUUID().slice(0, 6)}@${f.t.slug}.test`, fullName: 'Intruso', password: PASSWORD, roles: [{ role: 'CAJERO', branchIds: [branch2] }] });
    expect(other.status).toBe(403);
  });

  it('ticket en texto: respeta sucursal y propietario de la orden', async () => {
    const o = (await post('/orders', f.tokens.cajero, orderBody([item(f.prod.papas)]))).body;
    expect((await api.req('GET', `/orders/${o.id}/receipt.txt`, { token: f.tokens.mesero })).status).toBe(403);   // mesero ajeno a la orden
    expect((await api.req('GET', `/orders/${o.id}/receipt.txt`, { token: f.tokens.cajero })).status).toBe(200);
  });

  it('impresoras: la conexión se valida y no se reasignan impresoras de otra sucursal', async () => {
    let n = 0; const mk = (extra: Record<string, unknown>) => ({ branchId: f.branchId, name: `P${++n}`, role: 'CASH', columns: 42, stationKeys: [], isActive: true, ...extra });
    expect((await post('/printers', f.admin, mk({ connection: { type: 'file', path: '/etc/cron.d/x' } }))).status).toBe(400);
    expect((await post('/printers', f.admin, mk({ connection: { type: 'file', path: '/home/pi/.profile' } }))).status).toBe(400);
    expect((await post('/printers', f.admin, mk({ connection: { type: 'network', host: 'a b', port: 9100 } }))).status).toBe(400);
    expect((await post('/printers', f.admin, mk({ connection: { type: 'usb', path: '/dev/usb/lp0' } }))).status).toBe(201);
    expect((await post('/printers', f.admin, mk({ connection: { type: 'network', host: '192.168.1.50', port: 9100 } }))).status).toBe(201);
    const foreign = (await post('/printers', f.admin, mk({ branchId: branch2, connection: { type: 'network', host: '10.0.0.10', port: 9100 } }))).body;
    expect(foreign.id).toBeTruthy();
    // un gerente de OTRA sucursal intenta reasignarla a la suya
    expect((await put(`/printers/${foreign.id}`, f.tokens.gerente, mk({ connection: { type: 'network', host: '10.0.0.10', port: 9100 } }))).status).toBe(403);
    // y ni siquiera la modifica quedándose en la sucursal ajena
    expect((await put(`/printers/${foreign.id}`, f.tokens.gerente, mk({ branchId: branch2, connection: { type: 'network', host: '10.0.0.10', port: 9100 } }))).status).toBe(403);
  });
});

describe('sesiones', () => {
  it('el logout (aun con el access token expirado) revoca la sesión y el token deja de servir', async () => {
    const t = f.t; const u = await createUser(api, f.admin, t, 'CAJERO', [f.branchId], 'sesion');
    const l = await api.req('POST', '/auth/login', { body: { tenant: t.slug, email: u.email, password: PASSWORD } });
    const cookie = /rb_refresh=([^;]+)/.exec(String(l.headers['set-cookie']))![1]!;
    expect((await api.req('GET', '/auth/me', { token: l.body.accessToken })).status).toBe(200);
    const out = await api.req('POST', '/auth/logout', { headers: { 'x-requested-with': 'retroburger', cookie: `rb_refresh=${cookie}` }, body: {} });   // sin Authorization
    expect(out.status).toBe(204);
    expect((await api.req('GET', '/auth/me', { token: l.body.accessToken })).status).toBe(401);
  });

  it('un tenant suspendido pierde el acceso de inmediato', async () => {
    const t = f.t; const u = await createUser(api, f.admin, t, 'CAJERO', [f.branchId], 'susp');
    const tok = await login(api, t, u.email);
    expect((await api.req('GET', '/auth/me', { token: tok })).status).toBe(200);
    await f.sql(`UPDATE restaurants SET status='SUSPENDED' WHERE id=$1`, [f.t.tenantId]).catch(() => undefined);
    const after = (await api.req('GET', '/auth/me', { token: tok })).status;
    await f.sql(`UPDATE restaurants SET status='ACTIVE' WHERE id=$1`, [f.t.tenantId]).catch(() => undefined);
    expect(after).toBe(401);
  });
});

describe('caja', () => {
  it('gastos acumulados y depósitos exigen supervisor', async () => {
    const open = await post('/cash/shifts/open', f.tokens.cajero, { branchId: f.branchId, openingFloat: 3000 });
    expect(open.status, JSON.stringify(open.body)).toBe(201);
    const mv = (type: string, amount: number, extra: Record<string, unknown> = {}) => post('/cash/movements', f.tokens.cajero, { type, amount, reason: 'Prueba de auditoría', ...extra });
    expect((await mv('EXPENSE', 300)).status).toBe(201);
    expect((await mv('EXPENSE', 300)).body.code).toBe('SUPERVISOR_REQUIRED');       // 300 + 300 > 500 acumulado
    expect((await mv('DEPOSIT', 100)).body.code).toBe('SUPERVISOR_REQUIRED');       // todo depósito
    expect((await mv('EXPENSE', 300, { supervisor: { userCode: f.users.gerente!.userCode, pin: '1234' } })).status).toBe(201);
    // conteo ciego: tras varios cierres rechazados, solo cierra con supervisor
    const shift = (await api.req('GET', `/cash/shifts/current?branchId=${f.branchId}`, { token: f.tokens.cajero })).body;
    for (let i = 0; i < 3; i++) expect((await post(`/cash/shifts/${shift.id}/close`, f.tokens.cajero, { countedCash: 1 })).status).toBe(400);
    const near = await post(`/cash/shifts/${shift.id}/close`, f.tokens.cajero, { countedCash: 2100 });   // aun cerca del esperado, ya no se acepta sin supervisor
    expect([400, 403]).toContain(near.status);
    const ok = await post(`/cash/shifts/${shift.id}/close`, f.tokens.cajero, { countedCash: 2100, notes: 'Cierre con supervisor', supervisor: { userCode: f.users.gerente!.userCode, pin: '1234' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
});

describe('superficie pública', () => {
  it('QR: el pedido anónimo va en su propia orden, no en la cuenta del mesero', async () => {
    const tableId = f.tables[2]!;
    const staff = (await post('/orders', f.tokens.mesero, orderBody([item(f.prod.burger)], { channel: 'DINE_IN', tableId }))).body;
    const token = (await api.req('GET', `/tables?branchId=${f.branchId}`, { token: f.tokens.mesero })).body.find((t: any) => t.id === tableId).qrToken;
    const qr = await api.req('POST', `/public/${f.t.slug}/tables/${token}/orders`, { body: { items: [item(f.prod.papas, { qty: 3 })] } });
    expect(qr.status, JSON.stringify(qr.body)).toBe(201);
    expect(qr.body.orderId).not.toBe(staff.id);
    expect((await api.req('GET', `/orders/${staff.id}`, { token: f.tokens.mesero })).body.total).toBe(129);
    const big = await api.req('POST', `/public/${f.t.slug}/tables/${token}/orders`, { body: { items: [item(f.prod.papas, { qty: 99 })] } });
    expect(big.status).toBe(400);   // cantidad pública acotada
  });

  it('puntos de lealtad: por POST (sin datos en la URL), sin caché y con respuestas uniformes', async () => {
    const get = await api.req('GET', `/public/${f.t.slug}/loyalty?phone=5550000000&email=a@b.test`);
    expect(get.status).toBe(404);
    const miss = await api.req('POST', `/public/${f.t.slug}/loyalty`, { body: { phone: '5550000000', email: 'a@b.test' } });
    expect(miss.status).toBe(404);
    expect(String(miss.headers['cache-control'])).toContain('no-store');
  });

  it('errores de validación en parámetros son 400, no 500; y no se filtra el nombre de constraints', async () => {
    expect((await api.req('GET', `/public/${f.t.slug}/orders/no-es-uuid`)).status).toBe(400);
    expect((await api.req('GET', `/public/${f.t.slug}/invoice/abc/xml`)).status).toBe(400);
    const nul = await api.req('POST', `/public/${f.t.slug}/orders`, { body: { branchId: f.branchId, type: 'PICKUP', customer: { name: 'A\u0000B', phone: '5551234567' }, items: [item(f.prod.papas)] } });
    expect(nul.status).toBe(400);
  });

  it('reservación pública: horizonte y duración acotados', async () => {
    const far = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const r = await api.req('POST', `/public/${f.t.slug}/reservations`, { body: { branchId: f.branchId, customerName: 'X', phone: '5551112222', partySize: 2, startsAt: far } });
    expect(r.status).toBe(400);
    const near = new Date(Date.now() + 5 * 3600_000).toISOString();
    const long = await api.req('POST', `/public/${f.t.slug}/reservations`, { body: { branchId: f.branchId, customerName: 'X', phone: '5551112222', partySize: 2, startsAt: near, durationMin: 480 } });
    expect(long.status).toBe(400);
  });
});

describe('cupones y descuentos', () => {
  it('un cupón de un solo uso no se cobra en dos cuentas', async () => {
    await post('/promotions', f.admin, { name: 'Cupón único', type: 'COUPON', code: 'unico1', maxRedemptions: 1, config: { discountKind: 'PERCENT', percent: 10 } });
    await post('/cash/shifts/open', f.tokens.cajero, { branchId: f.branchId, openingFloat: 500 });
    const mk = async () => { const o = (await post('/orders', f.tokens.cajero, orderBody([item(f.prod.burger)]))).body; await post(`/orders/${o.id}/coupon`, f.tokens.cajero, { code: 'UNICO1' }); return o.id as string; };
    const a = await mk(); const b = await mk();
    const total = (id: string) => api.req('GET', `/orders/${id}`, { token: f.tokens.cajero }).then((r) => r.body.total as number);
    expect(await total(a)).toBeCloseTo(116.1, 1); expect(await total(b)).toBeCloseTo(116.1, 1);
    expect((await post(`/orders/${a}/pay`, f.tokens.cajero, { payments: [{ method: 'CASH', amount: 116.1 }] })).status).toBe(200);
    const second = await post(`/orders/${b}/pay`, f.tokens.cajero, { payments: [{ method: 'CASH', amount: 116.1 }] });
    expect(second.status).toBe(200); expect(second.body.priceChanged).toBe(true);   // el cupón ya se agotó: el total cambió y NO se cobró
    expect(second.body.total).toBe(129); expect(second.body.paidTotal).toBe(0);
    expect(await total(b)).toBe(129);
  });
});
