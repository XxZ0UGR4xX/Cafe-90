import { Injectable } from '@nestjs/common';
import { DbService, Tx } from '../../database/db.service';
import { AppError, forbidden } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { resolveRange, todayIn, type DateRange, type RangeKey } from './range';

type Dict = Record<string, any>;
export interface ReportResult { columns: { key: string; label: string; type: 'text' | 'number' | 'money' | 'percent' | 'date' }[]; rows: Dict[]; totals?: Dict }
const r2 = (n: number) => Math.round(n * 100) / 100;
const pctChange = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : null) : r2(((cur - prev) / prev) * 100));
/** Ventas = órdenes pagadas y no canceladas. */
const SALE = `o.payment_status = 'PAID' AND o.status <> 'CANCELLED'`;

const PERM: Record<string, string> = {
  sales: 'reports.sales.read', products: 'reports.sales.read', employees: 'reports.sales.read', customers: 'reports.sales.read', promotions: 'reports.sales.read',
  cash: 'reports.sales.read', tips: 'reports.sales.read', delivery: 'reports.sales.read', reservations: 'reports.sales.read',
  profit: 'reports.profit.read', costs: 'reports.profit.read', inventory: 'reports.inventory.read', purchases: 'reports.inventory.read', waste: 'reports.inventory.read',
};

@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  /** Sucursales permitidas para el reporte (intersección entre alcance del rol y filtro solicitado). */
  private scope(perm: string, branchId?: string): string[] | null {
    const s = ctx().principal!.branchScope(perm);
    if (branchId) {
      if (s && !s.includes(branchId)) throw forbidden({ permission: perm, branchId });
      return [branchId];
    }
    if (s && s.length === 0) throw forbidden({ permission: perm });
    return s;   // null = todas
  }

  /**
   * «Hoy» del negocio = DÍA OPERATIVO, no el día calendario: una venta a las 00:30 pertenece al día que empezó antes (corte
   * `business_day_cutoff`, 04:00 por defecto), igual que `orders.business_date`. Con el día calendario el dashboard marcaba $0
   * entre la medianoche y el corte (justo en pleno servicio de cena/noche).
   */
  async tenantToday(q: Tx): Promise<string> {
    const r = (await q.query(
      `SELECT ((now() AT TIME ZONE r.timezone) - COALESCE((SELECT min(b.business_day_cutoff) FROM branches b WHERE b.deleted_at IS NULL), '04:00'::time)::interval)::date::text AS d
         FROM restaurants r LIMIT 1`)).rows[0];
    return r?.d ?? todayIn('America/Mexico_City');
  }

  async run(type: string, f: Dict): Promise<ReportResult> {
    const perm = PERM[type];
    if (!perm) throw new AppError('NOT_FOUND', 404, { report: type });
    const branches = this.scope(perm, f.branchId);
    if (!ctx().principal!.can(perm)) throw forbidden({ permission: perm });
    return this.db.tx(async (q) => {
      const p = { branches, from: f.from, to: f.to, employeeId: f.employeeId ?? null, categoryId: f.categoryId ?? null, productId: f.productId ?? null, method: f.method ?? null };
      switch (type) {
        case 'sales': return this.sales(q, p, f.groupBy);
        case 'products': return this.products(q, p);
        case 'profit': return this.profit(q, p);
        case 'costs': return this.costs(q, p);
        case 'inventory': return this.inventory(q, p);
        case 'purchases': return this.purchases(q, p);
        case 'waste': return this.waste(q, p);
        case 'employees': return this.employees(q, p);
        case 'customers': return this.customers(q, p);
        case 'promotions': return this.promotions(q, p);
        case 'cash': return this.cashReport(q, p);
        case 'tips': return this.tips(q, p);
        case 'delivery': return this.delivery(q, p);
        default: return this.reservations(q, p);
      }
    });
  }

  private async sales(q: Tx, p: Dict, groupBy: string): Promise<ReportResult> {
    const key = groupBy === 'hour' ? `to_char(o.created_at AT TIME ZONE b.timezone, 'HH24":00"')` : groupBy === 'branch' ? 'b.name' : `to_char(o.business_date, 'YYYY-MM-DD')`;
    const rows = (await q.query(
      `SELECT ${key} AS period, count(*)::int AS orders, COALESCE(sum(o.subtotal),0) AS gross, COALESCE(sum(o.discount_total),0) AS discounts, COALESCE(sum(o.tax_total),0) AS tax,
              COALESCE(sum(o.total - o.refunded_total),0) AS net, COALESCE(sum(o.tip_total),0) AS tips, COALESCE(round(avg(o.total - o.refunded_total),2),0) AS "avgTicket"
         FROM orders o JOIN branches b ON b.id = o.branch_id
        WHERE ${SALE} AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[])) AND ($4::uuid IS NULL OR o.waiter_id = $4)
          AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM payments pm WHERE pm.order_id = o.id AND pm.method = $5 AND pm.kind='PAYMENT'))
        GROUP BY 1 ORDER BY 1`, [p.from, p.to, p.branches, p.employeeId, p.method])).rows;
    const t = rows.reduce((a, r) => ({ orders: a.orders + r.orders, gross: a.gross + r.gross, discounts: a.discounts + r.discounts, tax: a.tax + r.tax, net: a.net + r.net, tips: a.tips + r.tips }), { orders: 0, gross: 0, discounts: 0, tax: 0, net: 0, tips: 0 });
    return { columns: [{ key: 'period', label: groupBy === 'hour' ? 'Hora' : groupBy === 'branch' ? 'Sucursal' : 'Fecha', type: 'text' }, { key: 'orders', label: 'Pedidos', type: 'number' }, { key: 'gross', label: 'Venta bruta', type: 'money' },
      { key: 'discounts', label: 'Descuentos', type: 'money' }, { key: 'tax', label: 'IVA', type: 'money' }, { key: 'net', label: 'Venta neta', type: 'money' }, { key: 'tips', label: 'Propinas', type: 'money' }, { key: 'avgTicket', label: 'Ticket prom.', type: 'money' }],
      rows, totals: { ...t, avgTicket: t.orders ? r2(t.net / t.orders) : 0 } };
  }

  private async products(q: Tx, p: Dict): Promise<ReportResult> {
    const showCost = ctx().principal!.can('catalog.cost.read');
    const rows = (await q.query(
      `SELECT pr.name AS product, COALESCE(c.name,'—') AS category, sum(oi.qty)::int AS qty, COALESCE(sum(oi.line_total),0) AS revenue,
              ${showCost ? 'COALESCE(sum(oi.unit_cost * oi.qty),0)' : 'NULL::numeric'} AS cost,
              ${showCost ? 'COALESCE(sum(oi.line_total - oi.unit_cost * oi.qty),0)' : 'NULL::numeric'} AS profit
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products pr ON pr.id = oi.product_id LEFT JOIN categories c ON c.id = pr.category_id
        WHERE ${SALE} AND oi.status <> 'CANCELLED' AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR pr.category_id = $4) AND ($5::uuid IS NULL OR pr.id = $5) AND (oi.unit_price > 0 OR oi.parent_item_id IS NULL OR true)
        GROUP BY pr.name, c.name ORDER BY revenue DESC`, [p.from, p.to, p.branches, p.categoryId, p.productId])).rows;
    const cols: ReportResult['columns'] = [{ key: 'product', label: 'Producto', type: 'text' }, { key: 'category', label: 'Categoría', type: 'text' }, { key: 'qty', label: 'Unidades', type: 'number' }, { key: 'revenue', label: 'Ingreso', type: 'money' }];
    if (showCost) cols.push({ key: 'cost', label: 'Costo', type: 'money' }, { key: 'profit', label: 'Utilidad', type: 'money' });
    return { columns: cols, rows, totals: { qty: rows.reduce((a, r) => a + r.qty, 0), revenue: r2(rows.reduce((a, r) => a + r.revenue, 0)) } };
  }

  private async profit(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT to_char(o.business_date,'YYYY-MM-DD') AS period, COALESCE(sum(o.total - o.refunded_total - o.tax_total),0) AS revenue, COALESCE(sum(o.cost_total),0) AS cogs,
              COALESCE(sum(o.total - o.refunded_total - o.tax_total - o.cost_total),0) AS profit
         FROM orders o WHERE ${SALE} AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[])) GROUP BY 1 ORDER BY 1`, [p.from, p.to, p.branches])).rows
      .map((r) => ({ ...r, margin: r.revenue ? r2((r.profit / r.revenue) * 100) : 0 }));
    const t = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, cogs: a.cogs + r.cogs, profit: a.profit + r.profit }), { revenue: 0, cogs: 0, profit: 0 });
    return { columns: [{ key: 'period', label: 'Fecha', type: 'text' }, { key: 'revenue', label: 'Ingreso neto', type: 'money' }, { key: 'cogs', label: 'Costo de ventas', type: 'money' }, { key: 'profit', label: 'Utilidad bruta', type: 'money' }, { key: 'margin', label: 'Margen %', type: 'percent' }],
      rows, totals: { ...t, margin: t.revenue ? r2((t.profit / t.revenue) * 100) : 0 } };
  }

  private async costs(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT i.name AS ingredient, i.unit, -sum(m.qty) AS qty, -sum(m.qty * m.unit_cost) AS cost FROM inventory_movements m JOIN ingredients i ON i.id = m.ingredient_id
        WHERE m.type IN ('SALE_OUT','SALE_REVERSAL') AND m.at >= $1::date AND m.at < $2::date + 1 AND ($3::uuid[] IS NULL OR m.branch_id = ANY($3::uuid[])) GROUP BY i.name, i.unit HAVING sum(m.qty) <> 0 ORDER BY cost DESC`, [p.from, p.to, p.branches])).rows;
    return { columns: [{ key: 'ingredient', label: 'Ingrediente', type: 'text' }, { key: 'unit', label: 'Unidad', type: 'text' }, { key: 'qty', label: 'Consumo', type: 'number' }, { key: 'cost', label: 'Costo', type: 'money' }], rows, totals: { cost: r2(rows.reduce((a, r) => a + r.cost, 0)) } };
  }

  private async inventory(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT b.name AS branch, i.name AS ingredient, i.unit, inv.qty, inv.min_qty AS "minQty", round(inv.qty * i.avg_cost, 2) AS value,
              CASE WHEN inv.qty <= 0 THEN 'AGOTADO' WHEN inv.qty <= inv.min_qty * 0.5 THEN 'CRÍTICO' WHEN inv.qty <= inv.min_qty THEN 'BAJO' ELSE 'NORMAL' END AS status
         FROM inventory inv JOIN ingredients i ON i.id = inv.ingredient_id JOIN branches b ON b.id = inv.branch_id WHERE ($1::uuid[] IS NULL OR inv.branch_id = ANY($1::uuid[])) ORDER BY b.name, i.name`, [p.branches])).rows;
    return { columns: [{ key: 'branch', label: 'Sucursal', type: 'text' }, { key: 'ingredient', label: 'Ingrediente', type: 'text' }, { key: 'unit', label: 'Unidad', type: 'text' }, { key: 'qty', label: 'Existencia', type: 'number' }, { key: 'minQty', label: 'Mínimo', type: 'number' }, { key: 'value', label: 'Valor', type: 'money' }, { key: 'status', label: 'Estado', type: 'text' }],
      rows, totals: { value: r2(rows.reduce((a, r) => a + Math.max(r.value, 0), 0)) } };
  }

  private async purchases(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT s.name AS supplier, count(DISTINCT po.id)::int AS orders, COALESCE(sum(poi.qty_received * poi.unit_price),0) AS received, COALESCE(sum(poi.qty * poi.unit_price),0) AS ordered
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
        WHERE po.status <> 'CANCELLED' AND po.created_at >= $1::date AND po.created_at < $2::date + 1 AND ($3::uuid[] IS NULL OR po.branch_id = ANY($3::uuid[])) GROUP BY s.name ORDER BY received DESC`, [p.from, p.to, p.branches])).rows;
    return { columns: [{ key: 'supplier', label: 'Proveedor', type: 'text' }, { key: 'orders', label: 'Órdenes', type: 'number' }, { key: 'ordered', label: 'Ordenado', type: 'money' }, { key: 'received', label: 'Recibido', type: 'money' }], rows, totals: { ordered: r2(rows.reduce((a, r) => a + r.ordered, 0)), received: r2(rows.reduce((a, r) => a + r.received, 0)) } };
  }

  private async waste(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT i.name AS ingredient, i.unit, -sum(m.qty) AS qty, -sum(m.qty * m.unit_cost) AS cost, string_agg(DISTINCT m.reason, '; ') AS reasons FROM inventory_movements m JOIN ingredients i ON i.id = m.ingredient_id
        WHERE m.type = 'WASTE' AND m.at >= $1::date AND m.at < $2::date + 1 AND ($3::uuid[] IS NULL OR m.branch_id = ANY($3::uuid[])) GROUP BY i.name, i.unit ORDER BY cost DESC`, [p.from, p.to, p.branches])).rows;
    return { columns: [{ key: 'ingredient', label: 'Ingrediente', type: 'text' }, { key: 'unit', label: 'Unidad', type: 'text' }, { key: 'qty', label: 'Cantidad', type: 'number' }, { key: 'cost', label: 'Costo', type: 'money' }, { key: 'reasons', label: 'Motivos', type: 'text' }], rows, totals: { cost: r2(rows.reduce((a, r) => a + r.cost, 0)) } };
  }

  private async employees(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT COALESCE(u.full_name,'—') AS employee, count(*)::int AS orders, COALESCE(sum(o.total - o.refunded_total),0) AS sales, COALESCE(round(avg(o.total - o.refunded_total),2),0) AS "avgTicket", COALESCE(sum(o.tip_total),0) AS tips
         FROM orders o LEFT JOIN users u ON u.id = o.waiter_id WHERE ${SALE} AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[])) AND ($4::uuid IS NULL OR o.waiter_id = $4)
        GROUP BY u.full_name ORDER BY sales DESC`, [p.from, p.to, p.branches, p.employeeId])).rows;
    return { columns: [{ key: 'employee', label: 'Empleado', type: 'text' }, { key: 'orders', label: 'Pedidos', type: 'number' }, { key: 'sales', label: 'Ventas', type: 'money' }, { key: 'avgTicket', label: 'Ticket prom.', type: 'money' }, { key: 'tips', label: 'Propinas', type: 'money' }], rows, totals: { sales: r2(rows.reduce((a, r) => a + r.sales, 0)) } };
  }

  private async customers(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT c.name AS customer, c.phone, count(*)::int AS visits, COALESCE(sum(o.total - o.refunded_total),0) AS spent, COALESCE(round(avg(o.total - o.refunded_total),2),0) AS "avgTicket", max(o.created_at) AS "lastVisit"
         FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${SALE} AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[])) GROUP BY c.id ORDER BY spent DESC LIMIT 200`, [p.from, p.to, p.branches])).rows;
    return { columns: [{ key: 'customer', label: 'Cliente', type: 'text' }, { key: 'phone', label: 'Teléfono', type: 'text' }, { key: 'visits', label: 'Visitas', type: 'number' }, { key: 'spent', label: 'Gastado', type: 'money' }, { key: 'avgTicket', label: 'Ticket prom.', type: 'money' }, { key: 'lastVisit', label: 'Última visita', type: 'date' }], rows };
  }

  private async promotions(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT pr.name AS promotion, pr.type, count(*)::int AS redemptions, COALESCE(sum(r.amount),0) AS discounted FROM promotion_redemptions r JOIN promotions pr ON pr.id = r.promotion_id JOIN orders o ON o.id = r.order_id
        WHERE o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[])) GROUP BY pr.name, pr.type ORDER BY discounted DESC`, [p.from, p.to, p.branches])).rows;
    return { columns: [{ key: 'promotion', label: 'Promoción', type: 'text' }, { key: 'type', label: 'Tipo', type: 'text' }, { key: 'redemptions', label: 'Canjes', type: 'number' }, { key: 'discounted', label: 'Descuento otorgado', type: 'money' }], rows, totals: { discounted: r2(rows.reduce((a, r) => a + r.discounted, 0)) } };
  }

  private async cashReport(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT b.name AS branch, u.full_name AS cashier, s.opened_at AS "openedAt", s.closed_at AS "closedAt", s.opening_float AS "openingFloat", s.expected_cash AS expected, s.counted_cash AS counted, s.difference
         FROM cash_shifts s JOIN branches b ON b.id = s.branch_id JOIN users u ON u.id = s.user_id WHERE s.opened_at >= $1::date AND s.opened_at < $2::date + 1 AND ($3::uuid[] IS NULL OR s.branch_id = ANY($3::uuid[])) ORDER BY s.opened_at DESC`, [p.from, p.to, p.branches])).rows;
    return { columns: [{ key: 'branch', label: 'Sucursal', type: 'text' }, { key: 'cashier', label: 'Cajero', type: 'text' }, { key: 'openedAt', label: 'Apertura', type: 'date' }, { key: 'closedAt', label: 'Cierre', type: 'date' }, { key: 'openingFloat', label: 'Fondo', type: 'money' }, { key: 'expected', label: 'Esperado', type: 'money' }, { key: 'counted', label: 'Contado', type: 'money' }, { key: 'difference', label: 'Diferencia', type: 'money' }],
      rows, totals: { difference: r2(rows.reduce((a, r) => a + (r.difference ?? 0), 0)) } };
  }

  private async tips(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT COALESCE(u.full_name,'—') AS employee, pm.method, COALESCE(sum(pm.tip),0) AS tips, count(*)::int AS payments FROM payments pm JOIN orders o ON o.id = pm.order_id LEFT JOIN users u ON u.id = o.waiter_id
        WHERE pm.kind='PAYMENT' AND pm.tip > 0 AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR pm.branch_id = ANY($3::uuid[])) GROUP BY u.full_name, pm.method ORDER BY tips DESC`, [p.from, p.to, p.branches])).rows;
    return { columns: [{ key: 'employee', label: 'Mesero', type: 'text' }, { key: 'method', label: 'Método', type: 'text' }, { key: 'payments', label: 'Pagos', type: 'number' }, { key: 'tips', label: 'Propinas', type: 'money' }], rows, totals: { tips: r2(rows.reduce((a, r) => a + r.tips, 0)) } };
  }

  private async delivery(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT d.status, count(*)::int AS orders, COALESCE(sum(d.fee),0) AS fees, COALESCE(round(avg(EXTRACT(EPOCH FROM (d.delivered_at - d.created_at))/60) FILTER (WHERE d.delivered_at IS NOT NULL)),0) AS "avgMinutes"
         FROM delivery_orders d JOIN orders o ON o.id = d.order_id WHERE o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR d.branch_id = ANY($3::uuid[])) GROUP BY d.status ORDER BY d.status`, [p.from, p.to, p.branches])).rows;
    return { columns: [{ key: 'status', label: 'Estado', type: 'text' }, { key: 'orders', label: 'Pedidos', type: 'number' }, { key: 'fees', label: 'Cargo de envío', type: 'money' }, { key: 'avgMinutes', label: 'Min. promedio', type: 'number' }], rows };
  }

  private async reservations(q: Tx, p: Dict): Promise<ReportResult> {
    const rows = (await q.query(
      `SELECT status, count(*)::int AS reservations, COALESCE(sum(party_size),0)::int AS guests FROM reservations WHERE starts_at >= $1::date AND starts_at < $2::date + 1 AND ($3::uuid[] IS NULL OR branch_id = ANY($3::uuid[])) GROUP BY status ORDER BY status`, [p.from, p.to, p.branches])).rows;
    return { columns: [{ key: 'status', label: 'Estado', type: 'text' }, { key: 'reservations', label: 'Reservaciones', type: 'number' }, { key: 'guests', label: 'Personas', type: 'number' }], rows };
  }

  // ───────── Analítica ─────────
  async metrics(q: Tx, branches: string[] | null, from: string, to: string) {
    const s = (await q.query(
      `SELECT count(*)::int AS orders, COALESCE(sum(o.total - o.refunded_total),0) AS revenue, COALESCE(sum(o.total - o.refunded_total - o.tax_total),0) AS net_sales, COALESCE(sum(o.cost_total),0) AS cogs,
              COALESCE(sum(o.discount_total),0) AS discounts, COALESCE(sum(o.tip_total),0) AS tips, count(DISTINCT o.customer_id)::int AS customers
         FROM orders o WHERE ${SALE} AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[]))`, [from, to, branches])).rows[0];
    const ret = (await q.query(
      `SELECT count(*) FILTER (WHERE n >= 2)::int AS returning, count(*)::int AS total FROM (SELECT o.customer_id, count(*) n FROM orders o
         WHERE ${SALE} AND o.customer_id IS NOT NULL AND o.business_date BETWEEN $1 AND $2 AND ($3::uuid[] IS NULL OR o.branch_id = ANY($3::uuid[])) GROUP BY o.customer_id) x`, [from, to, branches])).rows[0];
    const days = Math.max((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 + 1, 1);
    const payroll = (await q.query(`SELECT COALESCE(sum(salary),0) AS monthly FROM employees WHERE deleted_at IS NULL AND status='ACTIVE' AND ($1::uuid[] IS NULL OR branch_id = ANY($1::uuid[]))`, [branches])).rows[0].monthly as number;
    const labor = r2((payroll / 30) * days);
    const gross = s.net_sales - s.cogs;
    return {
      revenue: r2(s.revenue), netSales: r2(s.net_sales), cogs: r2(s.cogs), grossProfit: r2(gross), averageTicket: s.orders ? r2(s.revenue / s.orders) : 0, orders: s.orders,
      customers: s.customers, retention: ret.total ? r2((ret.returning / ret.total) * 100) : 0, foodCostPct: s.net_sales ? r2((s.cogs / s.net_sales) * 100) : 0,
      laborCost: labor, laborCostPct: s.net_sales ? r2((labor / s.net_sales) * 100) : 0, profitMarginPct: s.net_sales ? r2(((gross - labor) / s.net_sales) * 100) : 0,
      discounts: r2(s.discounts), tips: r2(s.tips),
    };
  }

  async analytics(f: { branchId?: string; from: string; to: string }) {
    const perm = 'reports.profit.read';
    const branches = this.scope(perm, f.branchId);
    return this.db.tx(async (q) => {
      const cur = await this.metrics(q, branches, f.from, f.to);
      const days = Math.round((new Date(f.to).getTime() - new Date(f.from).getTime()) / 86_400_000) + 1;
      const prevTo = new Date(new Date(f.from).getTime() - 86_400_000); const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
      const prev = await this.metrics(q, branches, prevFrom.toISOString().slice(0, 10), prevTo.toISOString().slice(0, 10));
      return { current: cur, previous: prev, change: Object.fromEntries((Object.keys(cur) as (keyof typeof cur)[]).map((k) => [k, pctChange(cur[k] as number, prev[k] as number)])) };
    });
  }

  rangeFor(q: Tx, today: string, key: RangeKey, from?: string, to?: string): DateRange { void q; return resolveRange(key, today, from, to); }
  pct = pctChange;
  scopeFor = (perm: string, branchId?: string) => this.scope(perm, branchId);
}
