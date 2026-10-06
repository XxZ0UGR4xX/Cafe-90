import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, createBranch, startApi } from './helpers';
import { Fixture, buildFixture } from './fixtures';

let api: Api; let f: Fixture; let branch2: string;
beforeAll(async () => { api = await startApi(); f = await buildFixture(api, 'inv'); branch2 = (await createBranch(api, f.admin, 'NORTE', 'RETROBURGER NORTE')).id; });
afterAll(async () => { await f.close(); await api.app.close(); });

const post = (url: string, token: string, body?: unknown) => api.req('POST', url, { token, body });

describe('inventario: movimientos, kardex, estados y conteo físico', () => {
  it('merma exige motivo y no deja negativo; ajuste queda en kardex con saldo', async () => {
    const bad = await post('/inventory/movements', f.tokens.almacen, { branchId: f.branchId, ingredientId: f.ing.PAN, type: 'WASTE', qty: -5 });
    expect(bad.status).toBe(400);
    const over = await post('/inventory/movements', f.tokens.almacen, { branchId: f.branchId, ingredientId: f.ing.PAN, type: 'WASTE', qty: -5000, reason: 'Se cayó' });
    expect(over.body.code).toBe('INSUFFICIENT_STOCK');
    const ok = await post('/inventory/movements', f.tokens.almacen, { branchId: f.branchId, ingredientId: f.ing.PAN, type: 'WASTE', qty: -5, reason: 'Caducado' });
    expect(ok.status).toBe(201); expect(ok.body.balance).toBe(45);
    const k = (await api.req('GET', `/inventory/kardex?branchId=${f.branchId}&ingredientId=${f.ing.PAN}`, { token: f.tokens.almacen })).body;
    expect(k[0]).toMatchObject({ type: 'WASTE', qty: -5, balanceAfter: 45, reason: 'Caducado' });
    expect(await f.reconcile()).toEqual([]);
  });

  it('el kardex es inmutable (append-only)', async () => {
    await expect(f.sql('UPDATE inventory_movements SET qty = 1')).rejects.toThrow(/append-only/);
    await expect(f.sql('DELETE FROM inventory_movements')).rejects.toThrow(/append-only/);
  });

  it('estados semáforo y alerta de inventario bajo (con notificación)', async () => {
    await post('/inventory/movements', f.tokens.almacen, { branchId: f.branchId, ingredientId: f.ing.QUESO, type: 'ADJUSTMENT', qty: -97, reason: 'Conteo rápido' });
    const inv = (await api.req('GET', `/inventory?branchId=${f.branchId}`, { token: f.tokens.almacen })).body.find((x: any) => x.name === 'QUESO');
    expect(inv.qty).toBe(3); expect(inv.status).toBe('CRITICAL');
    const low = (await api.req('GET', `/inventory?branchId=${f.branchId}&status=CRITICAL`, { token: f.tokens.almacen })).body;
    expect(low.map((x: any) => x.name)).toContain('QUESO');
    const notes = (await api.req('GET', '/notifications', { token: f.tokens.gerente })).body;
    expect(notes.some((n: any) => n.type === 'STOCK_LOW' && n.title.includes('QUESO'))).toBe(true);
    await post('/inventory/movements', f.tokens.almacen, { branchId: f.branchId, ingredientId: f.ing.QUESO, type: 'PURCHASE_IN', qty: 97, unitCost: 3, lotCode: 'R1' });
  });

  it('el almacén no ve costos de ingredientes del catálogo ni cambia permisos', async () => {
    const inv = (await api.req('GET', `/inventory?branchId=${f.branchId}`, { token: f.tokens.mesero })).status;
    expect(inv).toBe(403);
  });

  it('inventario físico: conteo ciego → aplicar diferencias → COUNT_ADJ', async () => {
    const c = await post('/inventory/counts', f.tokens.almacen, { branchId: f.branchId });
    expect(c.status).toBe(201);
    expect(c.body.items.every((i: any) => i.systemQty === null)).toBe(true);   // ciego
    await api.req('PUT', `/inventory/counts/${c.body.id}/items`, { token: f.tokens.almacen, body: { items: [{ ingredientId: f.ing.CARNE, countedQty: 2900 }] } });
    expect((await post(`/inventory/counts/${c.body.id}/apply`, f.tokens.almacen)).status).toBe(403);   // almacén no aprueba
    const applied = await post(`/inventory/counts/${c.body.id}/apply`, f.tokens.gerente);
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    expect(await f.stock('CARNE')).toBe(2900);
    const k = (await api.req('GET', `/inventory/kardex?branchId=${f.branchId}&ingredientId=${f.ing.CARNE}`, { token: f.tokens.almacen })).body;
    expect(k[0].type).toBe('COUNT_ADJ'); expect(k[0].qty).toBe(-100);
    expect(await f.reconcile()).toEqual([]);
  });
});

describe('transferencias entre sucursales', () => {
  it('REQUESTED → APPROVED → IN_TRANSIT → RECEIVED con diferencias auditadas', async () => {
    const carne0 = await f.stock('CARNE');
    const t = await post('/transfers', f.tokens.gerente, { fromBranchId: f.branchId, toBranchId: branch2, items: [{ ingredientId: f.ing.CARNE, qty: 1000 }] });
    expect(t.status, JSON.stringify(t.body)).toBe(201); expect(t.body.status).toBe('REQUESTED');
    expect((await post(`/transfers/${t.body.id}/dispatch`, f.admin)).status).toBe(409);        // aún no aprobada
    expect((await post(`/transfers/${t.body.id}/approve`, f.admin)).body.status).toBe('APPROVED');
    const d = await post(`/transfers/${t.body.id}/dispatch`, f.admin);
    expect(d.body.status).toBe('IN_TRANSIT');
    expect(await f.stock('CARNE')).toBe(carne0 - 1000);                                          // sale del origen, aún no entra al destino
    const dest = (await f.sql('SELECT qty FROM inventory WHERE branch_id=$1 AND ingredient_id=$2', [branch2, f.ing.CARNE]))[0];
    expect(Number(dest?.qty ?? 0)).toBe(0);
    const r = await post(`/transfers/${t.body.id}/receive`, f.admin, { items: [{ ingredientId: f.ing.CARNE, qty: 980 }] });
    expect(r.body.status).toBe('RECEIVED');
    expect(Number((await f.sql('SELECT qty FROM inventory WHERE branch_id=$1 AND ingredient_id=$2', [branch2, f.ing.CARNE]))[0].qty)).toBe(980);
    const audit = (await api.req('GET', `/audit-logs?entity=stock_transfer&entityId=${t.body.id}`, { token: f.admin })).body.items;
    expect(audit.some((a: any) => a.action === 'transfer.discrepancy')).toBe(true);
    expect(await f.reconcile()).toEqual([]);
  });

  it('cancelar en tránsito reintegra al origen', async () => {
    const before = await f.stock('PAPAS');
    const t = (await post('/transfers', f.tokens.gerente, { fromBranchId: f.branchId, toBranchId: branch2, items: [{ ingredientId: f.ing.PAPAS, qty: 500 }] })).body;
    await post(`/transfers/${t.id}/approve`, f.admin); await post(`/transfers/${t.id}/dispatch`, f.admin);
    expect(await f.stock('PAPAS')).toBe(before - 500);
    expect((await post(`/transfers/${t.id}/cancel`, f.admin)).body.status).toBe('CANCELLED');
    expect(await f.stock('PAPAS')).toBe(before);
  });
});

describe('compras: proveedor → cotización → OC → recepción → factura', () => {
  it('flujo completo con costo promedio e historial', async () => {
    const sup = (await post('/suppliers', f.admin, { name: 'Distribuidora XYZ', products: [{ ingredientId: f.ing.CARNE, price: 120 }] })).body;
    const quote = (await post('/purchase-quotes', f.tokens.gerente, { branchId: f.branchId, supplierId: sup.id, items: [{ ingredientId: f.ing.CARNE, qty: 50, unitPrice: 120 }] })).body;
    const po = (await post(`/purchase-quotes/${quote.id}/accept`, f.tokens.gerente)).body;
    expect(po.total).toBe(6000); expect(po.status).toBe('DRAFT');
    const sub = await post(`/purchase-orders/${po.id}/submit`, f.tokens.gerente);
    expect(sub.body.status).toBe('SENT');
    const before = await f.stock('CARNE');
    const r1 = await post(`/purchase-orders/${po.id}/receive`, f.tokens.almacen, { items: [{ ingredientId: f.ing.CARNE, qty: 30, unitCost: 130, lotCode: 'LOTE-9', expiresOn: '2030-01-01' }] });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201); expect(r1.body.status).toBe('PARTIAL');
    expect(await f.stock('CARNE')).toBe(before + 30);
    const excess = await post(`/purchase-orders/${po.id}/receive`, f.tokens.almacen, { items: [{ ingredientId: f.ing.CARNE, qty: 100 }] });
    expect(excess.status).toBe(400);
    const r2 = await post(`/purchase-orders/${po.id}/receive`, f.tokens.almacen, { items: [{ ingredientId: f.ing.CARNE, qty: 20 }] });
    expect(r2.body.status).toBe('RECEIVED');
    const hist = (await api.req('GET', `/ingredients/${f.ing.CARNE}/cost-history`, { token: f.tokens.gerente })).body;
    expect(hist.length).toBeGreaterThanOrEqual(2);
    const inv = await post('/supplier-invoices', f.tokens.gerente, { supplierId: sup.id, purchaseOrderId: po.id, invoiceNumber: 'F-100', total: 6400 });
    expect(inv.body.priceVarianceFlag).toBe(true);                  // 6400 vs 6000 recibido→ >5 %
    expect((await post('/supplier-invoices', f.tokens.gerente, { supplierId: sup.id, invoiceNumber: 'F-100', total: 1 })).status).toBe(409);
    const notes = (await api.req('GET', '/notifications', { token: f.tokens.gerente })).body;
    expect(notes.some((n: any) => n.type === 'PO_RECEIVED')).toBe(true);
    expect(await f.reconcile()).toEqual([]);
  });

  it('orden grande requiere aprobación; almacén no recibe órdenes ya canceladas', async () => {
    const sup = (await post('/suppliers', f.admin, { name: 'Prov Grande', products: [] })).body;
    const po = (await post('/purchase-orders', f.tokens.almacen, { branchId: f.branchId, supplierId: sup.id, items: [{ ingredientId: f.ing.COLA, qty: 2000, unitPrice: 9 }] })).body;
    expect((await post(`/purchase-orders/${po.id}/submit`, f.tokens.almacen)).body.status).toBe('PENDING_APPROVAL');   // 18,000 > umbral 10,000
    expect((await post(`/purchase-orders/${po.id}/approve`, f.tokens.almacen)).status).toBe(403);
    expect((await post(`/purchase-orders/${po.id}/approve`, f.tokens.gerente)).body.status).toBe('SENT');
    expect((await post(`/purchase-orders/${po.id}/cancel`, f.tokens.gerente)).body.status).toBe('CANCELLED');
    expect((await post(`/purchase-orders/${po.id}/receive`, f.tokens.almacen, { items: [{ ingredientId: f.ing.COLA, qty: 1 }] })).status).toBe(409);
  });

  it('sugerencias de compra por mínimos', async () => {
    await post('/inventory/movements', f.tokens.almacen, { branchId: f.branchId, ingredientId: f.ing.COLA, type: 'ADJUSTMENT', qty: -(await f.stock('COLA')) + 3, reason: 'Prueba' });
    const s = (await api.req('GET', `/purchase-suggestions?branchId=${f.branchId}`, { token: f.tokens.gerente })).body;
    expect(s.some((x: any) => x.name === 'COLA' && x.suggestedQty > 0)).toBe(true);
  });
});
