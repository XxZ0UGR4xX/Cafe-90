import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startApi } from './helpers';
import { Fixture, buildFixture, item } from './fixtures';

// RFC de pruebas públicos del SAT
const EMISOR = { rfc: 'EKU9003173C9', legalName: 'Escuela Kemper Urgate S.A. de C.V.', regimenFiscal: '601', postalCode: '42501', series: 'A', enabled: true };
const RECEPTOR = { rfc: 'URE180429TM6', legalName: 'Universidad Robotica Española', regimenFiscal: '601', postalCode: '65000', cfdiUse: 'G03', email: 'cfdi@example.test' };

let api: Api; let f: Fixture;
beforeAll(async () => {
  api = await startApi(); f = await buildFixture(api, 'fis');
  await api.req('POST', '/cash/shifts/open', { token: f.tokens.cajero, body: { branchId: f.branchId, openingFloat: 200 } });
});
afterAll(async () => { await f.close(); await api.app.close(); });

const req = (m: string, url: string, token: string, body?: unknown) => api.req(m, url, { token, body });
async function paidOrder(items: any[], opts: { discount?: number; method?: string; channel?: string } = {}) {
  const o = (await req('POST', '/orders', f.tokens.mesero, { branchId: f.branchId, channel: opts.channel ?? 'TAKEAWAY', items, send: true })).body;
  if (opts.discount) await req('POST', `/orders/${o.id}/discount`, f.tokens.cajero, { kind: 'PERCENT', value: opts.discount, reason: 'Prueba' });
  const cur = (await req('GET', `/orders/${o.id}`, f.tokens.cajero)).body;
  const r = await req('POST', `/orders/${o.id}/pay`, f.tokens.cajero, { payments: [{ method: opts.method ?? 'CASH', amount: cur.total }] });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as { id: string; number: number; total: number };
}

describe('facturación CFDI 4.0 — configuración', () => {
  it('sin perfil fiscal no se factura', async () => {
    const o = await paidOrder([item(f.prod.burger)]);
    const r = await req('POST', '/invoices', f.admin, { orderId: o.id, receptor: RECEPTOR });
    expect(r.status).toBe(409); expect(r.body.code).toBe('FISCAL_NOT_CONFIGURED');
  });

  it('perfil fiscal: valida RFC/régimen, normaliza el nombre y sólo admin escribe', async () => {
    expect((await req('PUT', '/fiscal/profile', f.admin, { ...EMISOR, rfc: 'NOVALIDO' })).status).toBe(400);
    expect((await req('PUT', '/fiscal/profile', f.admin, { ...EMISOR, regimenFiscal: '605' })).body.code).toBe('INVOICE_INVALID_DATA');   // 605 es de personas físicas
    expect((await req('PUT', '/fiscal/profile', f.tokens.gerente, EMISOR)).status).toBe(403);
    const ok = await req('PUT', '/fiscal/profile', f.admin, EMISOR);
    expect(ok.status).toBe(200);
    expect(ok.body.profile.legalName).toBe('ESCUELA KEMPER URGATE');
    expect(ok.body.provider).toEqual({ key: 'SANDBOX', simulated: true });
    expect((await req('GET', '/fiscal/profile', f.tokens.gerente)).status).toBe(200);
    expect((await req('GET', '/fiscal/profile', f.tokens.cajero)).status).toBe(403);
    expect((await req('PATCH', `/branches/${f.branchId}`, f.admin, { postalCode: '06600' })).body.postalCode).toBe('06600');
  });

  it('catálogos disponibles para la UI', async () => {
    const c = (await req('GET', '/fiscal/catalogs', f.tokens.cajero)).body;
    expect(c.regimenes.find((r: any) => r.key === '601')).toBeTruthy(); expect(c.usos.find((u: any) => u.key === 'G03')).toBeTruthy();
  });
});

describe('facturación CFDI 4.0 — por ticket', () => {
  it('emite, calcula el total exacto de la cuenta, genera XML y bloquea duplicados', async () => {
    const o = await paidOrder([item(f.prod.burger, { qty: 2 }), item(f.prod.papas), item(f.prod.cola)], { discount: 10 });
    const r = await req('POST', '/invoices', f.tokens.cajero, { orderId: o.id, receptor: RECEPTOR });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const inv = r.body;
    expect(inv.status).toBe('STAMPED'); expect(inv.simulated).toBe(true);
    expect(inv.uuid).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
    expect(inv.series).toBe('A'); expect(inv.receptorName).toBe('UNIVERSIDAD ROBOTICA ESPAÑOLA');
    expect(Math.abs(inv.total - o.total)).toBeLessThanOrEqual(0.01);
    expect(inv.items.length).toBeGreaterThanOrEqual(3);
    expect(inv.discount).toBeGreaterThan(0);
    expect(Math.abs(inv.subtotal - inv.discount + inv.tax - inv.total)).toBeLessThan(0.0001);
    expect(inv.placeOfIssue).toBe('06600');
    expect(inv.orders.map((x: any) => x.number)).toEqual([o.number]);

    const xml = await api.req('GET', `/invoices/${inv.id}/xml`, { token: f.tokens.cajero });
    expect(xml.status).toBe(200); expect(String(xml.headers['content-type'])).toContain('application/xml');
    expect(String(xml.headers['content-disposition'])).toContain('.xml');
    expect(xml.body).toContain(`UUID="${inv.uuid}"`); expect(xml.body).toContain('SIMULADO');
    expect(xml.body).toContain(`Total="${inv.total.toFixed(2)}"`); expect(xml.body).toContain('RegimenFiscalReceptor="601"');

    const dup = await req('POST', '/invoices', f.tokens.cajero, { orderId: o.id, receptor: RECEPTOR });
    expect(dup.status).toBe(409); expect(dup.body.code).toBe('INVOICE_EXISTS');

    // con factura vigente, la cuenta no se devuelve; tras cancelar la factura sí
    const refund = { method: 'CASH', reason: 'Producto en mal estado', supervisor: { userCode: f.users.gerente!.userCode, pin: '1234' } };
    const blocked = await req('POST', `/orders/${o.id}/refund`, f.tokens.cajero, refund);
    expect(blocked.status).toBe(409); expect(blocked.body.code).toBe('INVOICE_ACTIVE');

    expect((await req('POST', `/invoices/${inv.id}/cancel`, f.tokens.cajero, { motive: '02' })).status).toBe(403);   // el cajero no cancela
    expect((await req('POST', `/invoices/${inv.id}/cancel`, f.tokens.gerente, { motive: '01' })).status).toBe(400);   // 01 exige UUID de sustitución
    const c = await req('POST', `/invoices/${inv.id}/cancel`, f.tokens.gerente, { motive: '02' });
    expect(c.status, JSON.stringify(c.body)).toBe(200); expect(c.body.status).toBe('CANCELLED'); expect(c.body.cancelMotive).toBe('02');
    expect((await req('POST', `/orders/${o.id}/refund`, f.tokens.cajero, refund)).status).toBe(200);
  });

  it('un CFDI timbrado es inmutable en la base de datos', async () => {
    const o = await paidOrder([item(f.prod.burger)]);
    const inv = (await req('POST', '/invoices', f.tokens.cajero, { orderId: o.id, receptor: RECEPTOR })).body;
    await expect(f.sql('UPDATE invoices SET total = total + 1 WHERE id=$1', [inv.id])).rejects.toThrow(/no se puede modificar/);
    await expect(f.sql('UPDATE invoices SET xml = $2 WHERE id=$1', [inv.id, '<x/>'])).rejects.toThrow(/no se puede modificar/);
    await expect(f.sql('DELETE FROM invoices WHERE id=$1', [inv.id])).rejects.toThrow();
    await expect(f.sql('UPDATE invoice_items SET amount = 1 WHERE invoice_id=$1', [inv.id])).rejects.toThrow();
  });

  it('valida los datos del receptor y no factura cuentas sin pagar ni de otro permiso', async () => {
    const o = await paidOrder([item(f.prod.papas)]);
    const bad = await req('POST', '/invoices', f.tokens.cajero, { orderId: o.id, receptor: { ...RECEPTOR, cfdiUse: 'D01' } });
    expect(bad.status).toBe(400); expect(bad.body.code).toBe('INVOICE_INVALID_DATA'); expect(bad.body.message).toMatch(/compatible/);
    expect((await req('POST', '/invoices', f.tokens.cajero, { orderId: o.id, receptor: { ...RECEPTOR, rfc: 'XAXX010101000' } })).body.message).toMatch(/global/);
    expect((await req('POST', '/invoices', f.tokens.mesero, { orderId: o.id, receptor: RECEPTOR })).status).toBe(403);
    const open = (await req('POST', '/orders', f.tokens.mesero, { branchId: f.branchId, channel: 'TAKEAWAY', items: [item(f.prod.cola)], send: true })).body;
    expect((await req('POST', '/invoices', f.tokens.cajero, { orderId: open.id, receptor: RECEPTOR })).body.code).toBe('ORDER_NOT_INVOICEABLE');
    // nada quedó a medias: la orden sigue facturable
    expect((await req('POST', '/invoices', f.tokens.cajero, { orderId: o.id, receptor: RECEPTOR })).status).toBe(201);
  });

  it('datos fiscales guardados en el cliente se reutilizan', async () => {
    const c = (await req('POST', '/customers', f.tokens.cajero, { name: 'Cliente Fiscal', phone: '555-0101' })).body;
    expect((await req('PUT', `/customers/${c.id}/fiscal`, f.tokens.cajero, { ...RECEPTOR, legalName: 'Universidad Robotica Española S.A. de C.V.' })).body.legalName).toBe('UNIVERSIDAD ROBOTICA ESPAÑOLA');
    const o = (await req('POST', '/orders', f.tokens.mesero, { branchId: f.branchId, channel: 'TAKEAWAY', customerId: c.id, items: [item(f.prod.burger)], send: true })).body;
    await req('POST', `/orders/${o.id}/pay`, f.tokens.cajero, { payments: [{ method: 'CARD', amount: o.total }] });
    const inv = (await req('POST', '/invoices', f.tokens.cajero, { orderId: o.id, customerId: c.id })).body;
    expect(inv.receptorRfc).toBe('URE180429TM6'); expect(inv.formaPago).toBe('04'); expect(inv.customerId ?? c.id).toBe(c.id);
    expect((await req('GET', `/invoices?orderId=${o.id}`, f.tokens.cajero)).body).toHaveLength(1);
  });

  it('envío a domicilio se factura como concepto aparte y el total cuadra', async () => {
    const o = (await req('POST', '/orders', f.tokens.mesero, { branchId: f.branchId, channel: 'TAKEAWAY', items: [item(f.prod.burger)], send: true })).body;
    await f.sql('UPDATE orders SET delivery_fee = 30 WHERE id=$1', [o.id]);
    await req('POST', `/orders/${o.id}/discount`, f.tokens.cajero, { kind: 'FIXED', value: 1, reason: 'recalcular totales' });
    const cur = (await req('GET', `/orders/${o.id}`, f.tokens.cajero)).body;
    await req('POST', `/orders/${o.id}/pay`, f.tokens.cajero, { payments: [{ method: 'CASH', amount: cur.total }] });
    const inv = (await req('POST', '/invoices', f.tokens.cajero, { orderId: o.id, receptor: RECEPTOR })).body;
    expect(inv.items.map((i: any) => i.description)).toContain('Servicio de envío a domicilio');
    expect(Math.abs(inv.total - cur.total)).toBeLessThanOrEqual(0.01);
  });
});

describe('autofactura pública (código del ticket)', () => {
  it('lookup → facturar → ya facturada → XML; códigos inválidos no filtran información', async () => {
    const o = await paidOrder([item(f.prod.burger), item(f.prod.cola)]);
    const code = (await f.sql('SELECT invoice_code FROM orders WHERE id=$1', [o.id]))[0].invoice_code as string;
    expect(code).toMatch(/^[0-9A-F]{12}$/);
    const base = `/public/${f.t.slug}/invoice`;
    const lk = await api.req('POST', `${base}/lookup`, { body: { code } });
    expect([200, 201]).toContain(lk.status);
    expect(lk.body.invoiceable).toBe(true); expect(lk.body.number).toBe(o.number); expect(lk.body.items.length).toBe(2);
    expect(lk.body.branch).toBeTruthy(); expect(JSON.stringify(lk.body)).not.toMatch(/cost|waiter|customer/i);

    expect((await api.req('POST', `${base}/lookup`, { body: { code: 'AAAAAAAAAAAA' } })).status).toBe(404);
    expect((await api.req('POST', `${base}/lookup`, { body: { code: 'corto' } })).status).toBe(400);
    expect((await api.req('POST', `${base}`, { body: { code, receptor: { ...RECEPTOR, regimenFiscal: '605' } } })).body.code).toBe('INVOICE_INVALID_DATA');

    const r = await api.req('POST', base, { body: { code: code.toLowerCase(), receptor: RECEPTOR } });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect(r.body.uuid).toBeTruthy(); expect(Math.abs(r.body.total - o.total)).toBeLessThanOrEqual(0.01);
    const lk2 = await api.req('POST', `${base}/lookup`, { body: { code } });
    expect(lk2.body.invoiceable).toBe(false); expect(lk2.body.reason).toBe('ALREADY_INVOICED'); expect(lk2.body.invoice.uuid).toBe(r.body.uuid);
    expect((await api.req('POST', base, { body: { code, receptor: RECEPTOR } })).body.code).toBe('INVOICE_EXISTS');
    const xml = await api.req('GET', `${base}/${code}/xml`);
    expect(xml.status).toBe(200); expect(xml.body).toContain(r.body.uuid);
    expect((await api.req('GET', `${base}/BBBBBBBBBBBB/xml`)).status).toBe(404);
  });

  it('respeta el plazo para facturar (fiscal.invoiceWindowDays)', async () => {
    const o = await paidOrder([item(f.prod.papas)]);
    await f.sql(`UPDATE orders SET business_date = business_date - 40 WHERE id=$1`, [o.id]);
    const code = (await f.sql('SELECT invoice_code FROM orders WHERE id=$1', [o.id]))[0].invoice_code;
    const lk = await api.req('POST', `/public/${f.t.slug}/invoice/lookup`, { body: { code } });
    expect(lk.body.invoiceable).toBe(false); expect(lk.body.reason).toBe('WINDOW_CLOSED');
    expect((await api.req('POST', `/public/${f.t.slug}/invoice`, { body: { code, receptor: RECEPTOR } })).body.code).toBe('INVOICE_WINDOW_CLOSED');
    await req('PUT', '/settings', f.admin, { key: 'fiscal.invoiceWindowDays', value: 90 });
    expect((await api.req('POST', `/public/${f.t.slug}/invoice`, { body: { code, receptor: RECEPTOR } })).status).toBeLessThan(300);
  });

  it('el ticket impreso incluye el código de facturación', async () => {
    const o = await paidOrder([item(f.prod.cola)]);
    const code = (await f.sql('SELECT invoice_code FROM orders WHERE id=$1', [o.id]))[0].invoice_code as string;
    const text = String((await api.req('GET', `/orders/${o.id}/receipt.txt`, { token: f.tokens.cajero })).body);
    expect(text).toContain('FACTURA TU CONSUMO');
    expect(text).toContain(`Código: ${code.replace(/(.{4})(?=.)/g, '$1-')}`);
    expect(text).toContain('/factura');
  });
});

describe('factura global', () => {
  it('agrupa tickets del día cerrado a PÚBLICO EN GENERAL, no repite lo ya facturado y libera al cancelar', async () => {
    const a = await paidOrder([item(f.prod.burger, { qty: 3 })], { method: 'CASH' });
    const b = await paidOrder([item(f.prod.papas), item(f.prod.agua)], { method: 'CARD' });
    const own = await paidOrder([item(f.prod.cola)]);
    await req('POST', '/invoices', f.tokens.cajero, { orderId: own.id, receptor: RECEPTOR });
    const day = (await f.sql(`SELECT (business_date - 3)::text AS d FROM orders WHERE id=$1`, [a.id]))[0].d as string;
    await f.sql(`UPDATE orders SET business_date = $2::date WHERE id = ANY($1::uuid[])`, [[a.id, b.id, own.id], day]);

    expect((await req('POST', '/invoices/global', f.tokens.mesero, { branchId: f.branchId, date: day })).status).toBe(403);
    const today = (await f.sql(`SELECT business_date::text d FROM orders WHERE id=$1`, [(await paidOrder([item(f.prod.agua)])).id]))[0].d;
    expect((await req('POST', '/invoices/global', f.tokens.cajero, { branchId: f.branchId, date: today })).body.code).toBe('ORDER_NOT_INVOICEABLE');   // día abierto

    const g = await req('POST', '/invoices/global', f.tokens.cajero, { branchId: f.branchId, date: day });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect(g.body.kind).toBe('GLOBAL'); expect(g.body.receptorRfc).toBe('XAXX010101000'); expect(g.body.receptorName).toBe('PUBLICO EN GENERAL');
    expect(g.body.receptorRegimen).toBe('616'); expect(g.body.cfdiUse).toBe('S01'); expect(g.body.globalInfo.periodicity).toBe('01');
    expect(g.body.orders.map((x: any) => x.number).sort()).toEqual([a.number, b.number].sort());   // 'own' ya estaba facturado
    expect(Math.abs(g.body.total - (a.total + b.total))).toBeLessThanOrEqual(0.02);
    const xml = (await api.req('GET', `/invoices/${g.body.id}/xml`, { token: f.tokens.cajero })).body as string;
    expect(xml).toContain('<cfdi:InformacionGlobal'); expect(xml).toContain('Rfc="XAXX010101000"'); expect(xml).toContain('DomicilioFiscalReceptor="06600"');

    expect((await req('POST', '/invoices/global', f.tokens.cajero, { branchId: f.branchId, date: day })).body.code).toBe('ORDER_NOT_INVOICEABLE');   // nada pendiente
    // un ticket dentro de la global ya no se autofactura
    const code = (await f.sql('SELECT invoice_code FROM orders WHERE id=$1', [a.id]))[0].invoice_code;
    expect((await api.req('POST', `/public/${f.t.slug}/invoice/lookup`, { body: { code } })).body.reason).toBe('IN_GLOBAL');

    await req('POST', `/invoices/${g.body.id}/cancel`, f.tokens.gerente, { motive: '02' });
    const again = await req('POST', '/invoices/global', f.tokens.cajero, { branchId: f.branchId, date: day });
    expect(again.status).toBe(201); expect(again.body.orders).toHaveLength(2);
  });
});

describe('consulta, alcance y aislamiento', () => {
  it('lista con filtros; folios consecutivos únicos; otro tenant no ve nada', async () => {
    const list = (await req('GET', '/invoices?limit=100', f.tokens.gerente)).body as any[];
    expect(list.length).toBeGreaterThan(5);
    const folios = list.filter((i) => i.series === 'A').map((i) => i.folio);
    expect(new Set(folios).size).toBe(folios.length);
    expect((await req('GET', '/invoices?status=CANCELLED', f.tokens.gerente)).body.every((i: any) => i.status === 'CANCELLED')).toBe(true);
    expect((await req('GET', `/invoices?q=${RECEPTOR.rfc}`, f.tokens.gerente)).body.length).toBeGreaterThan(0);
    expect((await req('GET', '/invoices', f.tokens.mesero)).status).toBe(403);

    const other = await buildFixture(api, 'fis2');
    try {
      expect((await req('GET', '/invoices', other.admin)).body).toEqual([]);
      expect((await req('GET', `/invoices/${list[0].id}`, other.admin)).status).toBe(404);
      expect((await req('GET', `/invoices/${list[0].id}/xml`, other.admin)).status).toBe(404);
    } finally { await other.close(); }
  });

  it('el proveedor se puede desactivar: perfil deshabilitado → no factura', async () => {
    await req('PUT', '/fiscal/profile', f.admin, { ...EMISOR, enabled: false });
    const o = await paidOrder([item(f.prod.agua)]);
    expect((await req('POST', '/invoices', f.admin, { orderId: o.id, receptor: RECEPTOR })).body.code).toBe('FISCAL_NOT_CONFIGURED');
    await req('PUT', '/fiscal/profile', f.admin, EMISOR);
  });
});
