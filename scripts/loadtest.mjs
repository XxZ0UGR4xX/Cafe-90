#!/usr/bin/env node
/**
 * Prueba de carga del flujo central del POS contra una API EN EJECUCIÓN (nunca contra producción con clientes reales):
 * cada usuario virtual repite  crear orden (con envío a cocina) → cobrar  y consulta el menú/tablero entre ventas.
 *   API_URL=http://localhost:3000 TENANT=retroburger EMAIL=cajero-centro@retroburger.test PASSWORD='Retro90!Staff' \
 *   VUS=20 DURATION_S=30 node scripts/loadtest.mjs
 * Requiere datos de demostración (pnpm db:seed). Usa una caja abierta del cajero y consume inventario real de la base.
 */
const { API_URL = 'http://localhost:3000', TENANT = 'retroburger', EMAIL = 'cajero-centro@retroburger.test', PASSWORD = 'Retro90!Staff', VUS = '20', DURATION_S = '30' } = process.env;
const vus = Number(VUS), until = Date.now() + Number(DURATION_S) * 1000;

const call = async (method, path, token, body) => {
  const t0 = performance.now();
  const r = await fetch(`${API_URL}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ms = performance.now() - t0; const j = await r.json().catch(() => null);
  return { status: r.status, ms, body: j };
};
const login = async () => { const r = await call('POST', '/auth/login', null, { tenant: TENANT, email: EMAIL, password: PASSWORD }); if (!r.body?.accessToken) throw new Error(`login falló (${r.status}) ${JSON.stringify(r.body)}`); return r.body.accessToken; };

const stats = new Map(); const errors = new Map();
const rec = (name, r) => { const s = stats.get(name) ?? { ms: [], n: 0, bad: 0 }; s.ms.push(r.ms); s.n++; if (r.status >= 400) { s.bad++; const k = `${name} → ${r.status} ${r.body?.code ?? ''}`; errors.set(k, (errors.get(k) ?? 0) + 1); } stats.set(name, s); return r; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };

const token = await login();
const branches = (await call('GET', '/branches', token)).body; const branch = branches.find((b) => b.code === 'CENTRO') ?? branches[0];
const products = (await call('GET', '/products?limit=100', token)).body.filter((p) => p.kind === 'SIMPLE' && p.isAvailable);
const shift = await call('POST', '/cash/shifts/open', token, { branchId: branch.id, openingFloat: 1000 });
if (shift.status >= 400 && shift.body?.code !== 'SHIFT_ALREADY_OPEN') throw new Error(`no se pudo abrir caja: ${JSON.stringify(shift.body)}`);

let sales = 0;
const vu = async (id) => {
  while (Date.now() < until) {
    const items = Array.from({ length: 1 + (id % 3) }, (_, i) => ({ productId: products[(id * 7 + i * 3 + sales) % products.length].id, qty: 1 + ((id + i) % 2), modifierIds: [], comboChoices: [] }));
    const o = rec('POST /orders (crear+enviar)', await call('POST', '/orders', token, { branchId: branch.id, channel: 'TAKEAWAY', items, send: true }));
    if (o.status === 201) { const p = rec('POST /orders/:id/pay', await call('POST', `/orders/${o.body.id}/pay`, token, { payments: [{ method: 'CASH', amount: o.body.total }] })); if (p.status === 200) sales++; }
    rec('GET /tables', await call('GET', `/tables?branchId=${branch.id}`, token));
    rec('GET /orders (lista)', await call('GET', `/orders?branchId=${branch.id}&limit=30`, token));
  }
};
const t0 = Date.now();
await Promise.all(Array.from({ length: vus }, (_, i) => vu(i)));
const secs = (Date.now() - t0) / 1000;

console.log(`\nCarga: ${vus} usuarios virtuales · ${secs.toFixed(0)} s · ${sales} ventas completas (${(sales / secs).toFixed(1)} ventas/s)\n`);
console.log('endpoint'.padEnd(32), 'n'.padStart(6), 'p50'.padStart(7), 'p95'.padStart(7), 'p99'.padStart(7), 'errores'.padStart(8));
for (const [name, s] of stats) console.log(name.padEnd(32), String(s.n).padStart(6), `${pct(s.ms, .5).toFixed(0)}ms`.padStart(7), `${pct(s.ms, .95).toFixed(0)}ms`.padStart(7), `${pct(s.ms, .99).toFixed(0)}ms`.padStart(7), String(s.bad).padStart(8));
if (errors.size) { console.log('\nErrores:'); for (const [k, n] of errors) console.log(`  ${n} × ${k}`); }
const fiveXX = [...errors.keys()].filter((k) => / → 5\d\d /.test(k));
process.exit(fiveXX.length ? 1 : 0);
