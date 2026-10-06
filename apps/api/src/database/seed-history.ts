/**
 * Historial de ventas de demostración (21 días) generado por SQL con una distribución realista:
 * picos de comida/cena, más ventas en fin de semana, mezcla de métodos de pago, propinas y algunos cancelados.
 * Determinista (semilla fija) para que los reportes sean reproducibles.
 */
import { DbService } from './db.service';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = <T,>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)]!;
const HOURS = [12, 13, 13, 14, 14, 15, 16, 18, 19, 19, 20, 20, 21, 22];

export async function seedHistory(db: DbService, tenantId: string, days = 21, log: (m: string) => void = console.log) {
  const r = rng(1990);
  await db.tx(async (q) => {
    const branches = (await q.query(`SELECT id, code, timezone FROM branches WHERE deleted_at IS NULL ORDER BY code`)).rows;
    const products = (await q.query(`SELECT p.id, p.name, p.price, p.station_key, p.kind, COALESCE(t.rate,0) AS rate,
        COALESCE((SELECT sum(ri.qty * i.avg_cost / (1 - ri.waste_pct)) FROM recipes r JOIN recipe_items ri ON ri.recipe_id = r.id JOIN ingredients i ON i.id = ri.ingredient_id WHERE r.product_id = p.id AND r.active),0) AS cost
        FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.deleted_at IS NULL AND p.kind = 'SIMPLE'`)).rows as { id: string; name: string; price: number; station_key: string | null; rate: number; cost: number }[];
    const burgers = products.filter((p) => p.station_key === 'PARRILLA'); const sides = products.filter((p) => p.station_key === 'FREIDORA'); const drinks = products.filter((p) => p.station_key === 'BEBIDAS'); const sweets = products.filter((p) => p.station_key === 'POSTRES');
    const customers = (await q.query(`SELECT id FROM customers WHERE deleted_at IS NULL`)).rows.map((c) => c.id as string);
    const waiters = (await q.query(`SELECT DISTINCT u.id, ur.branch_id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.key IN ('MESERO','CAJERO')`)).rows;
    let total = 0;
    for (const b of branches) {
      const bw = waiters.filter((w) => w.branch_id === b.id).map((w) => w.id as string);
      const scale = b.code === 'CENTRO' ? 1 : b.code === 'NORTE' ? 0.75 : 0.55;
      for (let d = days; d >= 0; d--) {
        const date = (await q.query(`SELECT ((now() AT TIME ZONE $2) - $1 * interval '1 day')::date AS d, EXTRACT(dow FROM ((now() AT TIME ZONE $2) - $1 * interval '1 day'))::int AS dow`, [d, b.timezone])).rows[0];
        const weekend = date.dow === 0 || date.dow === 5 || date.dow === 6;
        let n = Math.round((weekend ? 46 : 30) * scale * (0.85 + r() * 0.3));
        if (d === 0) n = Math.round(n * 0.45);
        for (let k = 0; k < n; k++) {
          const hour = pick(r, HOURS); const minute = Math.floor(r() * 60);
          const ts = `${date.d.toISOString?.().slice(0, 10) ?? String(date.d).slice(0, 10)} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
          const lines: { p: (typeof products)[number]; qty: number }[] = [{ p: pick(r, burgers), qty: r() < 0.3 ? 2 : 1 }];
          if (r() < 0.7) lines.push({ p: pick(r, sides), qty: 1 }); if (r() < 0.85) lines.push({ p: pick(r, drinks), qty: r() < 0.3 ? 2 : 1 }); if (r() < 0.25) lines.push({ p: pick(r, sweets), qty: 1 });
          const subtotal = Math.round(lines.reduce((a, l) => a + l.p.price * l.qty, 0) * 100) / 100;
          const tax = Math.round((subtotal - subtotal / 1.16) * 100) / 100; const cost = lines.reduce((a, l) => a + l.p.cost * l.qty, 0);
          const cancelled = r() < 0.03; const method = pick(r, ['CASH', 'CASH', 'CARD', 'CARD', 'CARD', 'TRANSFER', 'QR']); const tip = !cancelled && r() < 0.55 ? Math.round(subtotal * pick(r, [0.1, 0.15, 0.2])) : 0;
          const channel = pick(r, ['DINE_IN', 'DINE_IN', 'DINE_IN', 'TAKEAWAY', 'TAKEAWAY', 'DELIVERY']); const waiter = bw.length ? pick(r, bw) : null; const cust = r() < 0.35 && customers.length ? pick(r, customers) : null;
          const num = (await q.query(`SELECT next_counter($1) AS n`, [`order:${b.id}:${String(date.d.toISOString?.().slice(0, 10) ?? date.d).slice(0, 10)}`])).rows[0].n;
          const o = (await q.query(
            `INSERT INTO orders (tenant_id, branch_id, number, business_date, channel, status, payment_status, customer_id, waiter_id, created_by, subtotal, tax_total, tip_total, total, paid_total, cost_total, source, created_at, updated_at, closed_at, sent_at, cancel_reason)
             VALUES (app_tenant_id(),$1,$2,$3::date,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,'STAFF',$15::timestamp AT TIME ZONE $16,$15::timestamp AT TIME ZONE $16,$15::timestamp AT TIME ZONE $16,$15::timestamp AT TIME ZONE $16,$17) RETURNING id`,
            [b.id, num, String(date.d.toISOString?.().slice(0, 10) ?? date.d).slice(0, 10), channel, cancelled ? 'CANCELLED' : 'COMPLETED', cancelled ? 'PENDING' : 'PAID', cust, waiter, subtotal, tax, tip, subtotal, cancelled ? 0 : subtotal, cancelled ? 0 : cost, ts, b.timezone, cancelled ? 'Cliente se retiró' : null])).rows[0];
          for (const l of lines)
            await q.query(`INSERT INTO order_items (tenant_id, order_id, product_id, name, qty, unit_price, tax_rate, tax_included, unit_cost, line_total, line_tax, status, station_key, created_at)
                           VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12::timestamp AT TIME ZONE $13)`,
              [o.id, l.p.id, l.p.name, l.qty, l.p.price, l.p.rate, l.p.cost, l.p.price * l.qty, Math.round((l.p.price * l.qty - (l.p.price * l.qty) / 1.16) * 100) / 100, cancelled ? 'CANCELLED' : 'DELIVERED', l.p.station_key, ts, b.timezone]);
          if (!cancelled) await q.query(`INSERT INTO payments (tenant_id, branch_id, order_id, method, amount, tip, received_by, at) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7::timestamp AT TIME ZONE $8)`, [b.id, o.id, method, subtotal, tip, waiter, ts, b.timezone]);
          total++;
        }
      }
    }
    await q.query(`UPDATE customers c SET visits = s.v, total_spent = s.t, last_visit_at = s.l FROM (SELECT customer_id, count(*) v, sum(total) t, max(created_at) l FROM orders WHERE customer_id IS NOT NULL AND payment_status='PAID' GROUP BY customer_id) s WHERE c.id = s.customer_id`);
    log(`📈 Historial de demostración: ${total} pedidos de los últimos ${days} días.`);
  }, tenantId);
}
