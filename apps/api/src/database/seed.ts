/**
 * Seed de demostración RETROBURGER. Se ejecuta contra la API real (inject), así ejerce validaciones y auditoría.
 * Uso: pnpm db:seed   (requiere DATABASE_URL, JWT_ACCESS_SECRET). Datos SOLO para desarrollo/demostración.
 */
import 'reflect-metadata';
import { createApp } from '../bootstrap';
import { ProvisionerService } from '../modules/tenancy/provisioner.service';
import { DbService } from './db.service';
import { seedHistory } from './seed-history';
import { BRANCHES, CATEGORIES, COMBOS, CUSTOMERS, INGREDIENTS, MODIFIER_GROUPS, PRODUCTS, STAFF, SUPPLIERS } from './seed-data';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@retroburger.test';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Retro90!Burger';
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? 'Retro90!Staff';
const STAFF_PIN = process.env.SEED_STAFF_PIN ?? '1990';

export async function seedDemo(log: (m: string) => void = console.log) {
  // Crea un tenant con credenciales CONOCIDAS: jamás en producción (salvo autorización explícita y consciente).
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true')
    throw new Error('El seed de demostración crea usuarios con contraseñas conocidas: no se ejecuta con NODE_ENV=production.');
  const app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const db = app.get(DbService);
  const prov = app.get(ProvisionerService);

  const call = async (method: string, url: string, token?: string, body?: unknown) => {
    const r = await app.inject({ method: method as any, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body as any });
    if (r.statusCode >= 300) throw new Error(`${method} ${url} → ${r.statusCode} ${r.body}`);
    return r.body ? r.json() : null;
  };

  const exists = (await db.system('SELECT resolve_tenant($1) AS t', ['retroburger'])).rows[0].t;
  if (exists) { log('⚠️  El tenant "retroburger" ya existe: seed omitido.'); await app.close(); return null; }

  log('🍔 Creando tenant RETROBURGER…');
  await prov.createTenant({ slug: 'retroburger', name: 'RETROBURGER', legalName: 'Retroburger S.A. de C.V.', admin: { email: ADMIN_EMAIL, fullName: 'Dueño Retroburger', password: ADMIN_PASSWORD } } as any);
  const login = async (email: string, password: string) => (await call('POST', '/auth/login', undefined, { tenant: 'retroburger', email, password })).accessToken as string;
  const T = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  const tax = await call('POST', '/taxes', T, { name: 'IVA 16%', rate: 0.16, includedInPrice: true, isDefault: true });
  const cats: Record<string, string> = {};
  let i = 0;
  for (const c of CATEGORIES) cats[c.name] = (await call('POST', '/categories', T, { ...c, sortOrder: i++, isActive: true })).id;

  const ing: Record<string, string> = {};
  for (const x of INGREDIENTS) ing[x.sku] = (await call('POST', '/ingredients', T, { sku: x.sku, name: x.name, unit: x.unit, perishable: x.perishable, avgCost: x.avgCost, defaultMin: x.min, defaultMax: x.max })).id;

  const groups: Record<string, string> = {};
  for (const g of MODIFIER_GROUPS)
    groups[g.name] = (await call('POST', '/modifier-groups', T, { name: g.name, type: g.type, minSelect: g.min, maxSelect: g.max,
      modifiers: g.modifiers.map((m) => ({ name: m.name, priceDelta: m.priceDelta, ingredientId: ing[m.ing], qtyDelta: m.qty, isActive: true })) })).id;

  const prod: Record<string, string> = {};
  for (const p of PRODUCTS) {
    prod[p.sku] = (await call('POST', '/products', T, {
      categoryId: cats[p.cat], kind: 'SIMPLE', sku: p.sku, name: p.name, description: p.desc, price: p.price, taxId: tax.id, stationKey: p.station,
      prepTimeSec: p.prep, isAvailable: true, isInventoriable: true, sortOrder: 0,
      variants: (p.variants ?? []).map((v) => ({ name: v.name, priceDelta: v.priceDelta, qtyFactor: v.qtyFactor ?? 1 })),
      modifierGroupIds: (p.groups ?? []).map((g) => groups[g]),
      recipe: Object.entries(p.recipe).map(([sku, qty]) => ({ ingredientId: ing[sku], qty, wastePct: 0 })),
    })).id;
  }
  for (const c of COMBOS)
    prod[c.sku] = (await call('POST', '/products', T, {
      categoryId: cats['Combos'], kind: 'COMBO', sku: c.sku, name: c.name, description: c.desc, price: c.price, taxId: tax.id, stationKey: null, prepTimeSec: 600,
      isAvailable: true, isInventoriable: false, sortOrder: 0, variants: [], modifierGroupIds: [],
      comboSlots: c.slots.map((s) => ({ name: s.name, defaultProductId: prod[s.default], options: s.options.map(([sku, d]) => ({ productId: prod[sku as string], priceDelta: d })) })),
    })).id;

  for (const s of SUPPLIERS)
    await call('POST', '/suppliers', T, { name: s.name, contactName: s.contact, phone: s.phone, leadTimeDays: 2, paymentTermsDays: 15, isActive: true,
      products: Object.entries(s.items).map(([sku, price]) => ({ ingredientId: ing[sku], price })) });

  const branchIds: Record<string, string> = {};
  for (const b of BRANCHES) {
    const br = await call('POST', '/branches', T, { name: b.name, code: b.code, address: b.address, phone: b.phone, status: 'OPEN', timezone: 'America/Mexico_City', postalCode: '06600' });
    branchIds[b.code] = br.id;
    // mesas 1..10 en cuadrícula 5×2
    for (let n = 1; n <= 10; n++)
      await call('POST', `/branches/${br.id}/tables`, T, { number: n, capacity: n % 4 === 0 ? 6 : n % 3 === 0 ? 2 : 4, shape: n % 3 === 0 ? 'ROUND' : 'SQUARE', x: ((n - 1) % 5) * 2, y: Math.floor((n - 1) / 5) * 2, w: 1, h: 1, isActive: true });
    // inventario inicial (entrada por compra con costo) + mínimos/máximos
    for (const x of INGREDIENTS) {
      await call('PUT', '/inventory/levels', T, { branchId: br.id, ingredientId: ing[x.sku], minQty: x.min, maxQty: x.max });
      const start = Math.round(x.max * (b.code === 'SUR' ? 0.45 : b.code === 'NORTE' ? 0.7 : 0.85));
      await call('POST', '/inventory/movements', T, { branchId: br.id, ingredientId: ing[x.sku], type: 'PURCHASE_IN', qty: start, unitCost: x.avgCost, lotCode: 'INI-001',
        expiresOn: x.perishable ? new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) : undefined, reason: 'Inventario inicial' });
    }
    // personal por sucursal
    const staff = b.code === 'CENTRO' ? STAFF : STAFF.filter((s) => !['REPARTIDOR'].includes(s.role));
    for (const s of staff) {
      const code = `${s.tag}-${b.code.toLowerCase()}`;
      await call('POST', '/users', T, { email: `${code}@retroburger.test`, fullName: `${s.name} (${b.code})`, password: STAFF_PASSWORD, pin: STAFF_PIN, userCode: code, roles: [{ role: s.role, branchIds: [br.id] }] });
    }
  }

  for (const [name, phone, email] of CUSTOMERS) await call('POST', '/customers', T, { name, phone, email, marketingConsent: true }).catch(() => undefined);

  // Facturación: RFC de pruebas públicos del SAT + proveedor simulado (sin validez fiscal)
  await call('PUT', '/fiscal/profile', T, { rfc: 'EKU9003173C9', legalName: 'Escuela Kemper Urgate', regimenFiscal: '601', postalCode: '06600', series: 'A', enabled: true }).catch(() => undefined);

  const tenantId = (await db.system('SELECT resolve_tenant($1) AS t', ['retroburger'])).rows[0].t as string;
  if (process.env.SEED_HISTORY !== 'false') await seedHistory(db, tenantId, 21, log);
  log(`✅ Seed completo. Tenant: retroburger | Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  log(`   Personal de demo: <rol><n>-<sucursal>@retroburger.test (ej. cajero-centro@retroburger.test) / ${STAFF_PASSWORD} — PIN ${STAFF_PIN}`);
  await app.close();
  return { branchIds, prod, ing };
}

if (require.main === module) {
  seedDemo().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
