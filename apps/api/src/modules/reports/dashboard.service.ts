import { Injectable } from '@nestjs/common';
import { DbService, Tx } from '../../database/db.service';
import { ctx } from '../../common/request-context';
import { forbidden } from '../../common/errors';
import { ReportsService } from './reports.service';
import { resolveRange, type RangeKey } from './range';

type Dict = Record<string, any>;
const r2 = (n: number) => Math.round(n * 100) / 100;
const SALE = `o.payment_status = 'PAID' AND o.status <> 'CANCELLED'`;

@Injectable()
export class DashboardService {
  constructor(private readonly db: DbService, private readonly reports: ReportsService) {}

  /** Dashboard corporativo: KPIs, gráficas y ranking de sucursales (comparado contra el periodo previo). */
  async corporate(f: { range: RangeKey; from?: string; to?: string; branchId?: string }) {
    const branches = this.reports.scopeFor('reports.corporate.read', f.branchId);
    return this.db.tx(async (q) => {
      const today = await this.reports.tenantToday(q);
      const r = resolveRange(f.range, today, f.from, f.to);
      const cur = await this.reports.metrics(q, branches, r.from, r.to);
      const prev = await this.reports.metrics(q, branches, r.prevFrom, r.prevTo);
      const mtd = resolveRange('month', today);
      const month = await this.reports.metrics(q, branches, mtd.from, mtd.to);
      const todayM = await this.reports.metrics(q, branches, today, today);
      const salesByDay = (await q.query(`SELECT to_char(o.business_date,'YYYY-MM-DD') AS d, sum(o.total - o.refunded_total) AS sales, sum(o.total - o.refunded_total - o.tax_total - o.cost_total) AS profit, round(avg(o.total - o.refunded_total),2) AS "avgTicket", count(*)::int AS orders
        FROM orders o WHERE ${SALE} AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[])) GROUP BY 1 ORDER BY 1`, [r.from, r.to, branches])).rows;
      const salesByHour = (await q.query(`SELECT EXTRACT(hour FROM (o.created_at AT TIME ZONE b.timezone))::int AS h, sum(o.total - o.refunded_total) AS sales, count(*)::int AS orders FROM orders o JOIN branches b ON b.id = o.branch_id
        WHERE ${SALE} AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[])) GROUP BY 1 ORDER BY 1`, [r.from, r.to, branches])).rows;
      const byCategory = (await q.query(`SELECT COALESCE(c.name,'Sin categoría') AS category, sum(oi.line_total) AS sales FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${SALE} AND oi.status <> 'CANCELLED' AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[])) GROUP BY 1 ORDER BY 2 DESC`, [r.from, r.to, branches])).rows;
      const top = (await q.query(`SELECT p.name, sum(oi.qty)::int AS qty, sum(oi.line_total) AS sales FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
        WHERE ${SALE} AND oi.status <> 'CANCELLED' AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[])) GROUP BY p.name ORDER BY qty DESC, sales DESC LIMIT 5`, [r.from, r.to, branches])).rows;
      const monthly = (await q.query(`SELECT to_char(date_trunc('month', o.business_date),'YYYY-MM') AS m, sum(o.total - o.refunded_total) AS sales FROM orders o WHERE ${SALE} AND o.business_date >= (date_trunc('month', $1::date) - interval '5 months') AND o.business_date <= $1::date
        AND ($2::uuid[] IS NULL OR o.branch_id = ANY($2::uuid[])) GROUP BY 1 ORDER BY 1`, [today, branches])).rows;
      const newCustomers = (await q.query(`SELECT count(*)::int AS n FROM customers WHERE deleted_at IS NULL AND created_at::date BETWEEN $1 AND $2`, [r.from, r.to])).rows[0].n;
      const ranking = await this.ranking(q, branches, r.from, r.to, r.prevFrom, r.prevTo);
      return {
        range: r,
        kpis: { salesToday: todayM.revenue, salesMonth: month.revenue, averageTicket: cur.averageTicket, orders: cur.orders, estimatedProfit: cur.grossProfit, productCost: cur.cogs,
          topBranch: ranking[0]?.branch ?? null, topProduct: top[0]?.name ?? null, newCustomers },
        comparison: { sales: this.reports.pct(cur.revenue, prev.revenue), orders: this.reports.pct(cur.orders, prev.orders), profit: this.reports.pct(cur.grossProfit, prev.grossProfit), averageTicket: this.reports.pct(cur.averageTicket, prev.averageTicket) },
        charts: { salesByDay, salesByHour, salesByBranch: ranking.map((x) => ({ branch: x.branch, sales: x.sales })), salesByCategory: byCategory, profitByDay: salesByDay.map((d) => ({ d: d.d, profit: d.profit })), monthly, averageTicketByDay: salesByDay.map((d) => ({ d: d.d, avgTicket: d.avgTicket })) },
        topProducts: top, ranking, analytics: cur,
      };
    });
  }

  private async ranking(q: Tx, branches: string[] | null, from: string, to: string, pFrom: string, pTo: string) {
    const rows = (await q.query(
      `SELECT b.id, b.name AS branch,
          COALESCE(sum(o.total - o.refunded_total) FILTER (WHERE o.business_date BETWEEN $1 AND $2),0) AS sales,
          count(*) FILTER (WHERE o.business_date BETWEEN $1 AND $2)::int AS orders,
          COALESCE(sum(o.total - o.refunded_total - o.tax_total - o.cost_total) FILTER (WHERE o.business_date BETWEEN $1 AND $2),0) AS profit,
          COALESCE(sum(o.cost_total) FILTER (WHERE o.business_date BETWEEN $1 AND $2),0) AS cogs,
          COALESCE(sum(o.total - o.refunded_total - o.tax_total) FILTER (WHERE o.business_date BETWEEN $1 AND $2),0) AS net,
          count(DISTINCT o.customer_id) FILTER (WHERE o.business_date BETWEEN $1 AND $2)::int AS customers,
          COALESCE(sum(o.total - o.refunded_total) FILTER (WHERE o.business_date BETWEEN $3 AND $4),0) AS prev_sales
         FROM branches b LEFT JOIN orders o ON o.branch_id = b.id AND ${SALE}
        WHERE b.deleted_at IS NULL AND ($5::uuid[] IS NULL OR b.id = ANY($5::uuid[])) GROUP BY b.id, b.name ORDER BY sales DESC`, [from, to, pFrom, pTo, branches])).rows;
    return rows.map((r, i) => ({ rank: i + 1, branchId: r.id, branch: r.branch, sales: r2(r.sales), orders: r.orders, avgTicket: r.orders ? r2(r.sales / r.orders) : 0, profit: r2(r.profit),
      foodCostPct: r.net ? r2((r.cogs / r.net) * 100) : 0, customers: r.customers, growth: this.reports.pct(r.sales, r.prev_sales) }));
  }

  /** Tarjetas del listado de sucursales (/branches): ventas del día, pedidos, empleados activos, inventario. */
  async branchCards() {
    const scope = ctx().principal!.branchScope('tenancy.branch.read');
    return this.db.tx(async (q) => {
      const rows = (await q.query(
        `SELECT b.id, b.name, b.code, b.address, b.status,
            COALESCE((SELECT sum(o.total - o.refunded_total) FROM orders o WHERE o.branch_id=b.id AND ${SALE} AND o.business_date = (((now() AT TIME ZONE b.timezone) - b.business_day_cutoff::interval)::date)),0) AS "salesToday",
            COALESCE((SELECT count(*) FROM orders o WHERE o.branch_id=b.id AND o.status <> 'CANCELLED' AND o.business_date = (((now() AT TIME ZONE b.timezone) - b.business_day_cutoff::interval)::date)),0)::int AS "ordersToday",
            (SELECT count(*) FROM cash_shifts s WHERE s.branch_id=b.id AND s.status='OPEN')::int AS "openShifts",
            (SELECT count(DISTINCT ur.user_id) FROM user_roles ur WHERE ur.branch_id = b.id)::int AS employees,
            (SELECT count(*) FROM inventory i WHERE i.branch_id=b.id AND i.qty <= 0)::int AS "outOfStock",
            (SELECT count(*) FROM inventory i WHERE i.branch_id=b.id AND i.qty > 0 AND i.qty <= i.min_qty)::int AS "low"
           FROM branches b WHERE b.deleted_at IS NULL AND ($1::uuid[] IS NULL OR b.id = ANY($1::uuid[])) ORDER BY b.name`, [scope])).rows;
      return rows.map((r) => ({ ...r, avgTicket: r.ordersToday ? r2(r.salesToday / r.ordersToday) : 0, inventory: r.outOfStock > 0 ? 'CRITICO' : r.low > 0 ? 'BAJO' : 'NORMAL' }));
    });
  }

  /** Dashboard de gerente: hoy vs ayer vs misma fecha de la semana anterior, alertas y problemas. */
  async manager(branchId: string) {
    if (!ctx().principal!.can('reports.sales.read', branchId)) throw forbidden();
    return this.db.tx(async (q) => {
      const today = (await q.query(`SELECT (((now() AT TIME ZONE timezone) - business_day_cutoff::interval)::date)::text AS d FROM branches WHERE id=$1`, [branchId])).rows[0].d as string;
      const day = (d: string) => this.reports.metrics(q, [branchId], d, d);
      const shift = (d: string, n: number) => new Date(new Date(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
      const [t, y, w] = [await day(today), await day(shift(today, -1)), await day(shift(today, -7))];
      const status = (await q.query(`SELECT status, count(*)::int AS n FROM orders WHERE branch_id=$1 AND business_date=$2 GROUP BY status`, [branchId, today])).rows;
      const inv = (await q.query(`SELECT count(*) FILTER (WHERE qty <= 0)::int AS out, count(*) FILTER (WHERE qty > 0 AND qty <= min_qty * 0.5)::int AS critical, count(*) FILTER (WHERE qty > min_qty * 0.5 AND qty <= min_qty)::int AS low, count(*) FILTER (WHERE needs_review)::int AS review FROM inventory WHERE branch_id=$1`, [branchId])).rows[0];
      const staff = (await q.query(`SELECT count(DISTINCT user_id)::int AS n FROM user_roles WHERE branch_id=$1`, [branchId])).rows[0].n;
      const openShifts = (await q.query(`SELECT count(*)::int AS n FROM cash_shifts WHERE branch_id=$1 AND status='OPEN'`, [branchId])).rows[0].n;
      const problems = (await q.query(`SELECT
          (SELECT count(*)::int FROM orders WHERE branch_id=$1 AND needs_review AND business_date >= $2::date - 7) AS "ordersToReview",
          (SELECT count(*)::int FROM sync_operations WHERE branch_id=$1 AND status IN ('NEEDS_REVIEW','FAILED')) AS "syncExceptions",
          (SELECT count(*)::int FROM kitchen_orders WHERE branch_id=$1 AND status IN ('NEW','PREPARING') AND created_at < now() - interval '10 minutes') AS "delayedTickets",
          (SELECT count(*)::int FROM cash_shifts WHERE branch_id=$1 AND status='CLOSED' AND abs(COALESCE(difference,0)) > 50 AND closed_at > now() - interval '7 days') AS "cashDifferences"`, [branchId, today])).rows[0];
      const alerts = (await q.query(`SELECT id, type, severity, title, created_at AS "createdAt" FROM notifications WHERE branch_id=$1 ORDER BY created_at DESC LIMIT 10`, [branchId])).rows;
      const customers = (await q.query(`SELECT count(DISTINCT customer_id)::int AS n FROM orders WHERE branch_id=$1 AND business_date=$2 AND customer_id IS NOT NULL`, [branchId, today])).rows[0].n;
      return { date: today, sales: t.revenue, profit: t.grossProfit, orders: t.orders, averageTicket: t.averageTicket, customers, staff, openShifts, ordersByStatus: status, inventory: inv, alerts, problems,
        vsYesterday: { sales: this.reports.pct(t.revenue, y.revenue), orders: this.reports.pct(t.orders, y.orders), profit: this.reports.pct(t.grossProfit, y.grossProfit) },
        vsLastWeek: { sales: this.reports.pct(t.revenue, w.revenue), orders: this.reports.pct(t.orders, w.orders), profit: this.reports.pct(t.grossProfit, w.grossProfit) } };
    });
  }

  /** Cajero: únicamente caja, ventas, pedidos, métodos de pago y corte (sin costos ni utilidad). */
  async cashier(branchId: string) {
    const p = ctx().principal!;
    return this.db.tx(async (q) => {
      const shift = (await q.query(`SELECT id, opened_at AS "openedAt", opening_float AS "openingFloat" FROM cash_shifts WHERE user_id=$1 AND status='OPEN' AND branch_id=$2`, [p.userId, branchId])).rows[0] ?? null;
      let methods: Dict[] = []; let orders = { count: 0, total: 0 };
      if (shift) {
        methods = (await q.query(`SELECT method, sum(amount) AS total, count(*)::int AS n FROM cash_movements WHERE shift_id=$1 AND type='SALE' GROUP BY method ORDER BY method`, [shift.id])).rows;
        orders = (await q.query(`SELECT count(DISTINCT order_id)::int AS count, COALESCE(sum(amount),0) AS total FROM cash_movements WHERE shift_id=$1 AND type='SALE'`, [shift.id])).rows[0];
      }
      const pending = (await q.query(`SELECT id, number, total, paid_total AS "paidTotal", payment_status AS "paymentStatus" FROM orders WHERE branch_id=$1 AND payment_status <> 'PAID' AND status NOT IN ('CANCELLED','COMPLETED') ORDER BY created_at LIMIT 20`, [branchId])).rows;
      return { shift, salesTotal: r2(orders.total), ordersCount: orders.count, methods, pendingOrders: pending, canClose: !!shift };
    });
  }

  /** Mesero: mesas, pedidos, propinas y ventas propias. */
  async waiter(branchId: string) {
    const p = ctx().principal!;
    return this.db.tx(async (q) => {
      const today = (await q.query(`SELECT (((now() AT TIME ZONE timezone) - business_day_cutoff::interval)::date) AS d FROM branches WHERE id=$1`, [branchId])).rows[0].d;
      const tables = (await q.query(`SELECT count(*) FILTER (WHERE status='OCCUPIED')::int AS occupied, count(*) FILTER (WHERE status='FREE')::int AS free, count(*) FILTER (WHERE status='CLEANING')::int AS cleaning, count(*)::int AS total FROM tables WHERE branch_id=$1 AND is_active`, [branchId])).rows[0];
      const mine = (await q.query(`SELECT count(*) FILTER (WHERE status NOT IN ('CANCELLED','COMPLETED'))::int AS open, COALESCE(sum(total - refunded_total) FILTER (WHERE ${SALE}),0) AS sales, COALESCE(sum(tip_total) FILTER (WHERE ${SALE}),0) AS tips
        FROM orders o WHERE o.branch_id=$1 AND o.waiter_id=$2 AND o.business_date=$3`, [branchId, p.userId, today])).rows[0];
      const openOrders = (await q.query(`SELECT o.id, o.number, t.number AS "tableNumber", o.total, o.status, o.payment_status AS "paymentStatus" FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.branch_id=$1 AND o.waiter_id=$2 AND o.status NOT IN ('CANCELLED','COMPLETED') ORDER BY o.created_at DESC LIMIT 20`, [branchId, p.userId])).rows;
      const ready = (await q.query(`SELECT ko.id, o.number, t.number AS "tableNumber", ko.station_key AS station FROM kitchen_orders ko JOIN orders o ON o.id = ko.order_id LEFT JOIN tables t ON t.id = o.table_id WHERE ko.branch_id=$1 AND ko.status='READY' AND o.waiter_id=$2`, [branchId, p.userId])).rows;
      return { tables, openOrders: mine.open, sales: r2(mine.sales), tips: r2(mine.tips), orders: openOrders, readyForPickup: ready };
    });
  }

  /** Almacén: inventario, bajos/agotados, caducidades, entradas/salidas, transferencias y compras. */
  async warehouse(branchId: string) {
    return this.db.tx(async (q) => {
      const s = (await q.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE qty <= 0)::int AS out, count(*) FILTER (WHERE qty > 0 AND qty <= min_qty)::int AS low, COALESCE(sum(GREATEST(inv.qty,0) * i.avg_cost),0) AS value
        FROM inventory inv JOIN ingredients i ON i.id = inv.ingredient_id WHERE inv.branch_id=$1`, [branchId])).rows[0];
      const lowItems = (await q.query(`SELECT i.name, i.unit, inv.qty, inv.min_qty AS "minQty" FROM inventory inv JOIN ingredients i ON i.id = inv.ingredient_id WHERE inv.branch_id=$1 AND inv.qty <= inv.min_qty ORDER BY inv.qty / NULLIF(inv.min_qty,0) NULLS FIRST LIMIT 15`, [branchId])).rows;
      const expiring = (await q.query(`SELECT i.name, l.expires_on AS "expiresOn", l.qty_remaining AS qty FROM inventory_lots l JOIN ingredients i ON i.id = l.ingredient_id WHERE l.branch_id=$1 AND l.qty_remaining > 0 AND l.expires_on <= tenant_today() + 7 ORDER BY l.expires_on LIMIT 15`, [branchId])).rows;
      const flow = (await q.query(`SELECT COALESCE(sum(qty) FILTER (WHERE qty > 0),0) AS entries, COALESCE(-sum(qty) FILTER (WHERE qty < 0),0) AS exits FROM inventory_movements WHERE branch_id=$1 AND at > now() - interval '24 hours'`, [branchId])).rows[0];
      const transfers = (await q.query(`SELECT status, count(*)::int AS n FROM stock_transfers WHERE (from_branch_id=$1 OR to_branch_id=$1) AND status IN ('REQUESTED','APPROVED','IN_TRANSIT') GROUP BY status`, [branchId])).rows;
      const purchases = (await q.query(`SELECT status, count(*)::int AS n FROM purchase_orders WHERE branch_id=$1 AND status IN ('DRAFT','PENDING_APPROVAL','SENT','PARTIAL') GROUP BY status`, [branchId])).rows;
      return { summary: { ...s, value: r2(s.value) }, lowItems, expiring, flow24h: { entries: flow.entries, exits: flow.exits }, transfers, purchases };
    });
  }
}
