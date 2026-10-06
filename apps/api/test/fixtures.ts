import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Api, PASSWORD, createBranch, createUser, login, newTenant } from './helpers';

/** Restaurante mínimo para pruebas de operación (1 sucursal, 4 mesas, hamburguesa/papas/cola/combo, stock, personal). */
export interface Fixture {
  api: Api; t: { tenantId: string; slug: string; adminEmail: string };
  admin: string; branchId: string; tables: string[];
  ing: Record<string, string>; prod: Record<string, string>; groups: Record<string, string>; slots: Record<string, string>;
  tokens: { gerente: string; cajero: string; mesero: string; cocinero: string; almacen: string };
  users: Record<string, { id: string; email: string; userCode: string }>;
  stock(ing: string): Promise<number>;
  reconcile(): Promise<{ ingredient: string; qty: number; sum: number }[]>;
  sql<T = any>(text: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export async function buildFixture(api: Api, label = 'f'): Promise<Fixture> {
  const t = await newTenant(api, label);
  const admin = await login(api, t, t.adminEmail);
  const post = async (url: string, body: unknown, token = admin) => {
    const r = await api.req('POST', url, { token, body });
    if (r.status >= 300) throw new Error(`POST ${url} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const put = async (url: string, body: unknown) => {
    const r = await api.req('PUT', url, { token: admin, body });
    if (r.status >= 300) throw new Error(`PUT ${url} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  const tax = await post('/taxes', { name: 'IVA', rate: 0.16, includedInPrice: true, isDefault: true });
  const cat = await post('/categories', { name: 'Hamburguesas', sortOrder: 0, isActive: true });
  const catD = await post('/categories', { name: 'Bebidas', sortOrder: 1, isActive: true });
  const ing: Record<string, string> = {};
  for (const [sku, unit, cost] of [['CARNE', 'g', 0.12], ['PAN', 'pza', 4.5], ['QUESO', 'pza', 3], ['CEBOLLA', 'g', 0.03], ['PAPAS', 'g', 0.04], ['COLA', 'pza', 9]] as const)
    ing[sku] = (await post('/ingredients', { sku, name: sku, unit, avgCost: cost, perishable: false, defaultMin: 100, defaultMax: 1000 })).id;
  const groups: Record<string, string> = {};
  groups.extras = (await post('/modifier-groups', { name: 'Extras', type: 'EXTRA', minSelect: 0, maxSelect: 2, modifiers: [
    { name: 'Queso extra', priceDelta: 15, ingredientId: ing.QUESO, qtyDelta: 1 }, { name: 'Carne extra', priceDelta: 45, ingredientId: ing.CARNE, qtyDelta: 150 }] })).id;
  groups.remove = (await post('/modifier-groups', { name: 'Remover', type: 'REMOVE', minSelect: 0, maxSelect: 3, modifiers: [
    { name: 'Cebolla', priceDelta: 0, ingredientId: ing.CEBOLLA, qtyDelta: -20 }] })).id;
  const prod: Record<string, string> = {};
  prod.burger = (await post('/products', { categoryId: cat.id, sku: 'BURGER', name: 'Retro Burger', price: 129, taxId: tax.id, stationKey: 'PARRILLA', prepTimeSec: 420,
    modifierGroupIds: [groups.extras, groups.remove],
    recipe: [{ ingredientId: ing.CARNE, qty: 150 }, { ingredientId: ing.PAN, qty: 1 }, { ingredientId: ing.QUESO, qty: 2 }, { ingredientId: ing.CEBOLLA, qty: 20 }] })).id;
  prod.papas = (await post('/products', { categoryId: cat.id, sku: 'PAPAS', name: 'Papas Clásicas', price: 49, taxId: tax.id, stationKey: 'FREIDORA', recipe: [{ ingredientId: ing.PAPAS, qty: 200 }] })).id;
  prod.cola = (await post('/products', { categoryId: catD.id, sku: 'COLA', name: 'Cola Retro', price: 35, taxId: tax.id, stationKey: 'BEBIDAS', recipe: [{ ingredientId: ing.COLA, qty: 1 }] })).id;
  prod.agua = (await post('/products', { categoryId: catD.id, sku: 'AGUA', name: 'Agua', price: 20, taxId: tax.id, stationKey: null, isInventoriable: false })).id;
  prod.limonada = (await post('/products', { categoryId: catD.id, sku: 'LIM', name: 'Limonada', price: 39, taxId: tax.id, stationKey: 'BEBIDAS' })).id;
  prod.combo = (await post('/products', { categoryId: cat.id, kind: 'COMBO', sku: 'ARCADE', name: 'Arcade Combo', price: 179, taxId: tax.id, isInventoriable: false,
    comboSlots: [
      { name: 'Hamburguesa', defaultProductId: prod.burger, options: [] },
      { name: 'Papas', defaultProductId: prod.papas, options: [] },
      { name: 'Bebida', defaultProductId: prod.cola, options: [{ productId: prod.limonada, priceDelta: 5 }] }] })).id;
  const combo = (await api.req('GET', `/products/${prod.combo}`, { token: admin })).body;
  const slots: Record<string, string> = Object.fromEntries(combo.comboSlots.map((s: any) => [s.name, s.id]));

  const branch = await createBranch(api, admin, 'CENTRO', 'RETROBURGER CENTRO');
  const tables: string[] = [];
  for (let n = 1; n <= 4; n++) tables.push((await post(`/branches/${branch.id}/tables`, { number: n, capacity: 4 })).id);
  const unitCosts: Record<string, number> = { CARNE: 0.12, PAN: 4.5, QUESO: 3, CEBOLLA: 0.03, PAPAS: 0.04, COLA: 9 };
  for (const [sku, qty] of [['CARNE', 3000], ['PAN', 50], ['QUESO', 100], ['CEBOLLA', 500], ['PAPAS', 5000], ['COLA', 40]] as const) {
    await put('/inventory/levels', { branchId: branch.id, ingredientId: ing[sku], minQty: 10, maxQty: qty });
    await post('/inventory/movements', { branchId: branch.id, ingredientId: ing[sku], type: 'PURCHASE_IN', qty, unitCost: unitCosts[sku], lotCode: 'L1' });
  }

  const users: Fixture['users'] = {};
  const mk = async (role: string, tag: string) => { const u = await createUser(api, admin, t, role, [branch.id], tag); users[tag] = u; return login(api, t, u.email); };
  const tokens = { gerente: await mk('GERENTE', 'gerente'), cajero: await mk('CAJERO', 'cajero'), mesero: await mk('MESERO', 'mesero'),
    cocinero: await mk('COCINERO', 'cocinero'), almacen: await mk('ALMACEN', 'almacen') };

  const owner = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = async <T = any>(text: string, params: unknown[] = []): Promise<T[]> => {
    const c = await owner.connect();
    try { await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id',$1,true)", [t.tenantId]); const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; }
    finally { c.release(); }
  };
  return {
    api, t, admin, branchId: branch.id, tables, ing, prod, groups, slots, tokens, users,
    stock: async (k) => Number((await sql('SELECT qty FROM inventory WHERE branch_id=$1 AND ingredient_id=$2', [branch.id, ing[k]]))[0]?.qty ?? 0),
    reconcile: () => sql(`SELECT i.sku AS ingredient, inv.qty, COALESCE((SELECT sum(m.qty) FROM inventory_movements m WHERE m.branch_id = inv.branch_id AND m.ingredient_id = inv.ingredient_id),0) AS sum
                           FROM inventory inv JOIN ingredients i ON i.id = inv.ingredient_id WHERE abs(inv.qty - COALESCE((SELECT sum(m.qty) FROM inventory_movements m WHERE m.branch_id = inv.branch_id AND m.ingredient_id = inv.ingredient_id),0)) > 0.0001`),
    sql, close: async () => { await owner.end(); },
  };
}

export const item = (productId: string, extra: Record<string, unknown> = {}) => ({ productId, qty: 1, modifierIds: [], comboChoices: [], ...extra });
export { PASSWORD, randomUUID };
