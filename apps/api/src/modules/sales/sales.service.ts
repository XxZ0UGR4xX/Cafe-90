import { Injectable } from '@nestjs/common';
import { ORDER_TRANSITIONS, canTransition, type OrderStatus } from '@retroburger/shared';
import { DbService, Tx } from '../../database/db.service';
import { AppError, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { DomainEvents } from '../../common/domain-events';
import { AuditService } from '../audit/audit.service';
import { FloorService } from '../floor/floor.service';
import { SupervisorService, type SupervisorInput } from '../identity/supervisor.service';
import { InventoryEngine } from '../inventory/inventory.engine';
import { SettingsService } from '../tenancy/settings.service';
import { PromotionsService } from '../promotions/promotions.service';
import { LineBuilder, type BuiltLine } from './sales.lines';
import { amountToCents, centsToAmount, computeTotals, discountCents } from './pricing';

type Dict = Record<string, any>;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const ACTIVE_ITEM = `status <> 'CANCELLED'`;

@Injectable()
export class SalesService {
  constructor(
    private readonly db: DbService, private readonly lines: LineBuilder, private readonly engine: InventoryEngine,
    private readonly audit: AuditService, private readonly events: DomainEvents, private readonly floor: FloorService,
    private readonly supervisor: SupervisorService, private readonly settings: SettingsService,
    private readonly promotions: PromotionsService,
  ) {}

  private assertBranch(perm: string, branchId: string) {
    if (!ctx().principal!.can(perm, branchId)) throw forbidden({ permission: perm, branchId });
  }

  // ───────────────────────── helpers de estado ─────────────────────────
  async lockOrder(q: Tx, id: string): Promise<Dict> {
    const o = (await q.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!o) throw notFound('order');
    return o;
  }

  /** Una cuenta con CFDI vigente no se anula ni se devuelve hasta cancelar la factura (consistencia fiscal). */
  async assertNotInvoiced(q: Tx, orderId: string) {
    if ((await q.query('SELECT 1 FROM invoice_orders WHERE order_id=$1 AND active', [orderId])).rowCount) throw new AppError('INVOICE_ACTIVE', 409);
  }

  /** Cambia el estado validando la máquina de estados (a menos que sea una transición del sistema). */
  async setStatus(q: Tx, order: Dict, to: OrderStatus, opts: { force?: boolean; note?: string } = {}) {
    if (order.status === to) return;
    if (!opts.force && !canTransition(ORDER_TRANSITIONS, order.status as OrderStatus, to))
      throw new AppError('ORDER_INVALID_TRANSITION', 409, { from: order.status, to });
    await q.query('UPDATE orders SET status = $2, version = version + 1 WHERE id = $1', [order.id, to]);
    await q.query(`INSERT INTO order_events (tenant_id, order_id, from_status, to_status, user_id, note) VALUES (app_tenant_id(),$1,$2,$3,$4,$5)`,
      [order.id, order.status, to, ctx().principal?.userId ?? null, opts.note ?? null]);
    await this.events.emit(q, { type: 'OrderStatusChanged', branchId: order.branch_id, payload: { orderId: order.id, number: order.number, from: order.status, to } });
    order.status = to;
  }

  /** Un pedido pagado y entregado/listo se completa y libera su mesa. */
  async maybeComplete(q: Tx, orderId: string) {
    const o = await this.lockOrder(q, orderId);
    if (o.payment_status === 'PAID' && ['READY', 'DELIVERED'].includes(o.status)) {
      await this.setStatus(q, o, 'COMPLETED', { force: true });
      await q.query('UPDATE orders SET closed_at = COALESCE(closed_at, now()) WHERE id = $1', [orderId]);
    }
    await this.releaseTableIfDone(q, o);
  }

  async releaseTableIfDone(q: Tx, o: Dict) {
    if (!o.table_session_id) return;
    const open = (await q.query(
      `SELECT count(*)::int n FROM orders WHERE table_session_id = $1 AND status <> 'CANCELLED' AND NOT (payment_status = 'PAID')`, [o.table_session_id])).rows[0].n;
    if (open === 0) {
      const sess = (await q.query(`SELECT 1 FROM table_sessions WHERE id=$1 AND status='OPEN'`, [o.table_session_id])).rowCount;
      if (sess) await this.floor.closeSession(q, o.table_session_id, o.branch_id);
    }
  }

  /** Recalcula totales de la orden desde sus items vigentes y descuentos. */
  async recalc(q: Tx, orderId: string) {
    await this.promotions.applyTo(q, orderId);   // promociones automáticas y cupones vigentes
    const items = (await q.query(
      `SELECT id, line_total, tax_rate, tax_included, unit_cost, qty, parent_item_id FROM order_items WHERE order_id=$1 AND ${ACTIVE_ITEM}`, [orderId])).rows;
    const subtotal = items.reduce((a, i) => a + amountToCents(i.line_total), 0);
    const discounts = (await q.query('SELECT id, kind, value, amount FROM order_discounts WHERE order_id=$1', [orderId])).rows;
    let discount = 0;
    for (const d of discounts) {
      const c = d.kind === 'PERCENT' ? discountCents('PERCENT', d.value, subtotal) : amountToCents(d.amount);
      discount += c;
      if (d.kind === 'PERCENT') await q.query('UPDATE order_discounts SET amount=$2 WHERE id=$1', [d.id, centsToAmount(c)]);
    }
    const t = computeTotals(items.map((i) => ({ id: i.id, lineCents: amountToCents(i.line_total), taxRate: i.tax_rate, taxIncluded: i.tax_included })), discount);
    for (const l of t.lines) await q.query('UPDATE order_items SET line_tax=$2 WHERE id=$1', [l.id, centsToAmount(l.taxCents)]);
    const cost = items.reduce((a, i) => a + i.unit_cost * i.qty, 0);
    const fee = (await q.query('SELECT delivery_fee FROM orders WHERE id=$1', [orderId])).rows[0].delivery_fee as number;
    const tipTotal = (await q.query(`SELECT COALESCE(sum(tip),0) AS t FROM payments WHERE order_id=$1`, [orderId])).rows[0].t;
    await q.query(`UPDATE orders SET subtotal=$2, discount_total=$3, tax_total=$4, total=$5, cost_total=$6, tip_total=$7 WHERE id=$1`,
      [orderId, centsToAmount(t.subtotal), centsToAmount(t.discount), centsToAmount(t.tax), r4(centsToAmount(t.total) + fee), r4(cost), tipTotal]);
  }

  // ───────────────────────── creación ─────────────────────────
  private async insertLines(q: Tx, orderId: string, lines: BuiltLine[]) {
    const insertOne = async (l: BuiltLine, parentId: string | null) => {
      const lineTotal = centsToAmount(amountToCents(l.unitPrice) * l.qty);
      const id = (await q.query(
        `INSERT INTO order_items (tenant_id, order_id, parent_item_id, product_id, variant_id, slot_name, name, qty, unit_price, tax_rate, tax_included, unit_cost, line_total, station_key, notes)
         VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [orderId, parentId, l.productId, l.variantId, l.slotName ?? null, l.name, l.qty, l.unitPrice, l.taxRate, l.taxIncluded, l.unitCost, lineTotal, l.stationKey, l.notes ?? null])).rows[0].id as string;
      for (const m of l.modifiers)
        await q.query(`INSERT INTO order_item_modifiers (tenant_id, order_item_id, modifier_id, name, group_name, type, price_delta, ingredient_id, qty_delta) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, m.id, m.name, m.groupName, m.type, m.priceDelta, m.ingredientId, m.qtyDelta]);
      for (const c of l.children) await insertOne(c, id);
    };
    for (const l of lines) await insertOne(l, null);
  }

  async create(d: Dict) {
    this.assertBranch('sales.order.create', d.branchId);
    return this.db.tx(async (q) => {
      if (d.clientUuid) {   // idempotencia (reintentos y sincronización offline)
        const ex = (await q.query(`SELECT id FROM orders WHERE client_uuid=$1 UNION ALL SELECT order_id FROM order_client_aliases WHERE client_uuid=$1 LIMIT 1`, [d.clientUuid])).rows[0];
        if (ex) return { ...(await this.get(ex.id, q)), idempotent: true };
      }
      const b = (await q.query(`SELECT id, status, ((now() AT TIME ZONE timezone) - business_day_cutoff::interval)::date AS bdate FROM branches WHERE id=$1 AND deleted_at IS NULL`, [d.branchId])).rows[0];
      if (!b) throw notFound('branch');
      if (b.status !== 'OPEN' && !d.offline) throw new AppError('CONFLICT', 409, undefined, false, '⚠️ La sucursal no está operando.');

      // Mesa: abre sesión automáticamente o reutiliza la cuenta abierta (menos clics para el mesero)
      let sessionId: string | null = null; let tableId: string | null = d.tableId ?? null;
      if (tableId) {
        const t = (await q.query('SELECT id, branch_id, status FROM tables WHERE id=$1 AND is_active FOR UPDATE', [tableId])).rows[0];
        if (!t || t.branch_id !== d.branchId) throw notFound('table');
        let s = (await q.query(`SELECT id FROM table_sessions WHERE table_id=$1 AND status='OPEN'`, [tableId])).rows[0];
        if (!s) {
          this.assertBranch('floor.table.operate', d.branchId);
          s = (await q.query(`INSERT INTO table_sessions (tenant_id, branch_id, table_id, guests, waiter_id, customer_id, customer_name) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6) RETURNING id`,
            [d.branchId, tableId, d.guests ?? 1, ctx().principal!.userId, d.customerId ?? null, d.customerName ?? null])).rows[0];
          await q.query(`UPDATE tables SET status='OCCUPIED' WHERE id=$1`, [tableId]);
          await this.events.emit(q, { type: 'TableChanged', branchId: d.branchId, payload: { tableId, status: 'OCCUPIED' } });
        } else {
          // Un pedido por QR (anónimo) NUNCA se agrega a la cuenta del personal: va en su propia orden de la misma sesión
          const existing = (await q.query(`SELECT id FROM orders WHERE table_session_id=$1 AND status NOT IN ('CANCELLED','COMPLETED') AND payment_status <> 'PAID'
              AND (($2::text = 'QR') = (source = 'QR')) ORDER BY created_at LIMIT 1`, [s.id, d.source ?? 'STAFF'])).rows[0];
          if (existing) {
            if (d.clientUuid) await q.query('INSERT INTO order_client_aliases (tenant_id, client_uuid, order_id) VALUES (app_tenant_id(),$1,$2) ON CONFLICT DO NOTHING', [d.clientUuid, existing.id]);
            return this.addItems(existing.id, { items: d.items, send: d.send, offline: d.offline }, q);
          }
        }
        sessionId = s.id;
      }

      const built = await this.lines.build(q, d.branchId, d.items, { allowUnavailable: !!d.offline });
      const number = (await q.query(`SELECT next_counter($1) AS n`, [`order:${d.branchId}:${b.bdate}`])).rows[0].n;
      const uid = ctx().principal!.userId;
      const order = (await q.query(
        `INSERT INTO orders (tenant_id, branch_id, number, business_date, channel, status, table_session_id, table_id, customer_id, customer_name, waiter_id, guests, notes, client_uuid, needs_review, created_by, source)
         VALUES (app_tenant_id(),$1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9,$10,$11,$12,$13,$9,$14) RETURNING id`,
        [d.branchId, number, b.bdate, d.channel, sessionId, tableId, d.customerId ?? null, d.customerName ?? null, uid, d.guests ?? null, d.notes ?? null, d.clientUuid ?? null, !!d.offline, d.source ?? 'STAFF'])).rows[0];
      await this.insertLines(q, order.id, built);
      await this.recalc(q, order.id);
      await q.query(`INSERT INTO order_events (tenant_id, order_id, from_status, to_status, user_id) VALUES (app_tenant_id(),$1,NULL,'PENDING',$2)`, [order.id, uid]);
      await this.audit.record(q, { action: 'order.create', entity: 'order', entityId: order.id, branchId: d.branchId, newValue: { number, channel: d.channel, items: d.items.length } });
      if (d.send) await this.sendToKitchen(order.id, q, { allowNegative: !!d.offline });
      await this.events.emit(q, { type: 'OrderCreated', branchId: d.branchId, payload: { orderId: order.id, number } });
      return this.get(order.id, q);
    });
  }

  async addItems(orderId: string, d: { items: Dict[]; send?: boolean; offline?: boolean }, tx?: Tx) {
    const run = async (q: Tx) => {
      const o = await this.lockOrder(q, orderId);
      this.assertBranch('sales.order.update', o.branch_id);
      this.assertOwner(o);
      if (['CANCELLED', 'COMPLETED'].includes(o.status) || o.payment_status === 'PAID') throw new AppError('ORDER_INVALID_TRANSITION', 409, { status: o.status });
      const built = await this.lines.build(q, o.branch_id, d.items, { allowUnavailable: !!d.offline });
      await this.insertLines(q, orderId, built);
      await this.recalc(q, orderId);
      await this.audit.record(q, { action: 'order.add_items', entity: 'order', entityId: orderId, branchId: o.branch_id, newValue: { items: d.items.length } });
      if (d.send) await this.sendToKitchen(orderId, q, { allowNegative: !!d.offline });
      return this.get(orderId, q);
    };
    return tx ? run(tx) : this.db.tx(run);
  }

  /** Meseros sólo editan sus propias órdenes salvo que tengan acceso a todas. */
  private assertOwner(o: Dict) {
    if (o.source === 'PUBLIC' || o.source === 'QR') return;   // pedidos en línea/QR: cualquier personal de la sucursal puede atenderlos
    const p = ctx().principal!;
    if (!p.can('sales.order.readAll', o.branch_id) && o.waiter_id !== p.userId && o.created_by !== p.userId) throw forbidden({ reason: 'orden ajena' });
  }

  async patch(orderId: string, d: Dict) {
    return this.db.tx(async (q) => {
      const o = await this.lockOrder(q, orderId);
      this.assertBranch('sales.order.update', o.branch_id); this.assertOwner(o);
      if (['CANCELLED', 'COMPLETED'].includes(o.status)) throw new AppError('ORDER_INVALID_TRANSITION', 409);
      await q.query(`UPDATE orders SET notes = CASE WHEN $2::boolean THEN $3 ELSE notes END, customer_id = CASE WHEN $4::boolean THEN $5::uuid ELSE customer_id END,
                     customer_name = CASE WHEN $6::boolean THEN $7 ELSE customer_name END, guests = COALESCE($8, guests) WHERE id=$1`,
        [orderId, 'notes' in d, d.notes ?? null, 'customerId' in d, d.customerId ?? null, 'customerName' in d, d.customerName ?? null, d.guests ?? null]);
      await this.audit.record(q, { action: 'order.update', entity: 'order', entityId: orderId, branchId: o.branch_id, oldValue: { notes: o.notes }, newValue: d });
      return this.get(orderId, q);
    });
  }

  async updateItem(orderId: string, itemId: string, d: { qty?: number; notes?: string | null }) {
    return this.db.tx(async (q) => {
      const o = await this.lockOrder(q, orderId);
      this.assertBranch('sales.order.update', o.branch_id); this.assertOwner(o);
      const it = (await q.query('SELECT * FROM order_items WHERE id=$1 AND order_id=$2 FOR UPDATE', [itemId, orderId])).rows[0];
      if (!it) throw notFound('item');
      if (it.status !== 'PENDING') throw new AppError('CONFLICT', 409, undefined, false, '⚠️ El producto ya fue enviado a cocina. Cancélalo y vuelve a agregarlo.');
      const qty = d.qty ?? it.qty;
      await q.query(`UPDATE order_items SET qty=$2::int, notes = CASE WHEN $3::boolean AND id = $1::uuid THEN $4::text ELSE notes END, line_total = unit_price * $2::int WHERE id=$1::uuid OR parent_item_id=$1::uuid`, [itemId, qty, 'notes' in d, d.notes ?? null]);
      await this.recalc(q, orderId);
      await this.enforceDiscountLimit(q, orderId, o.branch_id);
      return this.get(orderId, q);
    });
  }

  async cancelItem(orderId: string, itemId: string, d: { reason: string; supervisor?: SupervisorInput }) {
    return this.db.tx(async (q) => {
      const o = await this.lockOrder(q, orderId);
      this.assertBranch('sales.order.update', o.branch_id); this.assertOwner(o);
      if (['CANCELLED', 'COMPLETED'].includes(o.status) || o.paid_total > 0) throw new AppError('ORDER_INVALID_TRANSITION', 409, undefined, false, '⚠️ Esta cuenta ya tiene pagos; usa una devolución.');
      const it = (await q.query('SELECT * FROM order_items WHERE id=$1 AND order_id=$2 AND parent_item_id IS NULL FOR UPDATE', [itemId, orderId])).rows[0];
      if (!it || it.status === 'CANCELLED') throw notFound('item');
      let authBy = ctx().principal!.userId;
      if (it.status !== 'PENDING') authBy = await this.supervisor.authorize('sales.order.cancel', o.branch_id, d.supervisor);
      const ids = (await q.query('SELECT id, status FROM order_items WHERE id=$1 OR parent_item_id=$1', [itemId])).rows;
      await this.engine.lockForRefs(q, 'order_item', ids.map((r) => r.id));
      for (const row of ids) await this.cancelSentItem(q, row.id, row.status, d.reason);
      await q.query(`UPDATE order_items SET status='CANCELLED' WHERE id = ANY($1::uuid[])`, [ids.map((r) => r.id)]);
      await this.recalc(q, orderId);
      await this.enforceDiscountLimit(q, orderId, o.branch_id);
      await this.audit.record(q, { action: 'order.cancel_item', entity: 'order_item', entityId: itemId, branchId: o.branch_id, oldValue: { name: it.name, qty: it.qty, status: it.status }, reason: d.reason, newValue: { authorizedBy: authBy } });
      await this.afterItemsChanged(q, orderId);
      return this.get(orderId, q);
    });
  }

  /** Revierte inventario si el ticket de cocina no ha iniciado; marca/retira el item en cocina. */
  private async cancelSentItem(q: Tx, itemId: string, status: string, reason: string) {
    if (status === 'PENDING') return;
    const k = (await q.query(`SELECT koi.id AS koi_id, ko.id AS ko_id, ko.status FROM kitchen_order_items koi JOIN kitchen_orders ko ON ko.id = koi.kitchen_order_id WHERE koi.order_item_id=$1`, [itemId])).rows[0];
    if (!k || k.status === 'NEW') await this.engine.reverse(q, { type: 'order_item', id: itemId }, `Cancelación: ${reason}`, true);
    if (k) {
      if (k.status === 'NEW') {
        await q.query('DELETE FROM kitchen_order_items WHERE id=$1', [k.koi_id]);
        const left = (await q.query('SELECT count(*)::int n FROM kitchen_order_items WHERE kitchen_order_id=$1', [k.ko_id])).rows[0].n;
        if (!left) await q.query(`UPDATE kitchen_orders SET status='CANCELLED' WHERE id=$1`, [k.ko_id]);
      } else await q.query(`UPDATE kitchen_order_items SET notes = 'CANCELADO' WHERE id=$1`, [k.koi_id]);
      const o = (await q.query('SELECT branch_id, order_id FROM kitchen_orders WHERE id=$1', [k.ko_id])).rows[0];
      await this.events.emit(q, { type: 'KitchenChanged', branchId: o.branch_id, payload: { ticketId: k.ko_id, orderId: o.order_id } });
    }
  }

  /** Tras cambios en items, reevalúa el estado de la orden. */
  private async afterItemsChanged(q: Tx, orderId: string) {
    const o = await this.lockOrder(q, orderId);
    const left = (await q.query(`SELECT count(*)::int n FROM order_items WHERE order_id=$1 AND ${ACTIVE_ITEM} AND parent_item_id IS NULL`, [orderId])).rows[0].n;
    if (left === 0 && !['CANCELLED', 'COMPLETED'].includes(o.status)) {
      await q.query(`UPDATE orders SET cancelled_at=now(), cancelled_by=$2, cancel_reason='Todos los productos cancelados' WHERE id=$1`, [orderId, ctx().principal!.userId]);
      await this.setStatus(q, o, 'CANCELLED', { force: true });
      await this.releaseTableIfDone(q, o);
    }
  }

  // ───────────────────────── envío a cocina + consumo de inventario ─────────────────────────
  async sendToKitchen(orderId: string, tx?: Tx, opts: { allowNegative?: boolean } = {}) {
    const run = async (q: Tx) => {
      const o = await this.lockOrder(q, orderId);
      this.assertBranch('sales.order.update', o.branch_id);
      if (['CANCELLED', 'COMPLETED'].includes(o.status)) throw new AppError('ORDER_INVALID_TRANSITION', 409, { status: o.status });
      if (o.source === 'PUBLIC' || o.source === 'QR') {   // quien confirma un pedido en línea/QR se vuelve su mesero responsable
        const me = ctx().principal!.userId;
        await q.query(`UPDATE orders SET waiter_id=$2 WHERE id=$1 AND waiter_id IN (SELECT id FROM users WHERE is_system)`, [orderId, me]);
        if (o.table_session_id) await q.query(`UPDATE table_sessions SET waiter_id=$2 WHERE id=$1 AND waiter_id IN (SELECT id FROM users WHERE is_system)`, [o.table_session_id, me]);
      }
      const pending = (await q.query(`SELECT id, parent_item_id, station_key, product_id FROM order_items WHERE order_id=$1 AND status='PENDING' ORDER BY created_at, id`, [orderId])).rows;
      if (!pending.length) return this.get(orderId, q);

      // 1) consumo de inventario por item (bloqueo ordenado → sin deadlocks ni sobreventa)
      const allowNeg = opts.allowNegative ?? ((await this.settings.get('inventory.allowNegativeSales', o.branch_id, false)) === true);
      await this.consumeItems(q, o, pending.map((p) => p.id), allowNeg);

      // 2) estado de los items: con estación → SENT (ticket); contenedores de combo → SENT; sin estación → DELIVERED
      const kitchenIds = pending.filter((p) => p.station_key).map((p) => p.id);
      const comboParents = pending.filter((p) => !p.station_key && pending.some((c) => c.parent_item_id === p.id)).map((p) => p.id);
      const noStation = pending.filter((p) => !p.station_key && !comboParents.includes(p.id)).map((p) => p.id);
      if (kitchenIds.length || comboParents.length) await q.query(`UPDATE order_items SET status='SENT', sent_at=now() WHERE id = ANY($1::uuid[])`, [[...kitchenIds, ...comboParents]]);
      if (noStation.length) await q.query(`UPDATE order_items SET status='DELIVERED', sent_at=now() WHERE id = ANY($1::uuid[])`, [noStation]);
      await q.query('UPDATE orders SET sent_at = COALESCE(sent_at, now()) WHERE id=$1', [orderId]);

      // 3) estado de la orden
      if (kitchenIds.length) {
        await this.setStatus(q, o, 'CONFIRMED', { force: ['READY', 'DELIVERED', 'PREPARING'].includes(o.status) });
        const table = o.table_id ? (await q.query('SELECT number FROM tables WHERE id=$1', [o.table_id])).rows[0]?.number : null;
        await this.events.emit(q, { type: 'OrderSent', branchId: o.branch_id, payload: { orderId, number: o.number, channel: o.channel, tableNumber: table, itemIds: kitchenIds } });
      } else {
        // sólo productos sin cocina (p. ej. bebida embotellada): listo y entregado de inmediato
        if (o.status === 'PENDING' || o.status === 'DRAFT') await this.setStatus(q, o, 'CONFIRMED');
        await this.setStatus(q, o, 'READY', { force: true });
        await this.setStatus(q, o, 'DELIVERED', { force: true });
        await this.maybeComplete(q, orderId);
      }
      await this.audit.record(q, { action: 'order.send_kitchen', entity: 'order', entityId: orderId, branchId: o.branch_id, newValue: { items: pending.length } });
      return this.get(orderId, q);
    };
    return tx ? run(tx) : this.db.tx(run);
  }

  /** Receta × variante + modificadores → movimientos SALE_OUT por item. */
  private async consumeItems(q: Tx, order: Dict, itemIds: string[], allowNegative: boolean) {
    const rec = (await q.query(
      `SELECT oi.id AS item_id, oi.qty, COALESCE(v.qty_factor,1) AS factor, ri.ingredient_id, ri.qty AS rqty, ri.waste_pct
         FROM order_items oi JOIN products p ON p.id = oi.product_id AND p.is_inventoriable
         LEFT JOIN product_variants v ON v.id = oi.variant_id
         JOIN recipes r ON r.product_id = oi.product_id AND r.active JOIN recipe_items ri ON ri.recipe_id = r.id
        WHERE oi.id = ANY($1::uuid[])`, [itemIds])).rows;
    const mods = (await q.query(
      `SELECT oi.id AS item_id, oim.ingredient_id, oim.qty_delta * oi.qty AS qty FROM order_item_modifiers oim JOIN order_items oi ON oi.id = oim.order_item_id
        WHERE oi.id = ANY($1::uuid[]) AND oim.ingredient_id IS NOT NULL`, [itemIds])).rows;
    const perItem = new Map<string, Map<string, number>>();
    const add = (item: string, ing: string, qty: number) => {
      const m = perItem.get(item) ?? new Map<string, number>();
      m.set(ing, r4((m.get(ing) ?? 0) + qty)); perItem.set(item, m);
    };
    for (const r of rec) add(r.item_id, r.ingredient_id, (r.rqty * r.factor * r.qty) / (1 - r.waste_pct));
    for (const m of mods) add(m.item_id, m.ingredient_id, m.qty);
    const ingredientIds = [...perItem.values()].flatMap((m) => [...m.keys()]);
    await this.engine.lockMany(q, order.branch_id, ingredientIds);
    for (const [itemId, m] of perItem)
      for (const [ing, qty] of [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
        if (qty > 0) await this.engine.apply(q, { branchId: order.branch_id, ingredientId: ing, type: 'SALE_OUT', qty: -qty, refType: 'order_item', refId: itemId, reason: `Venta #${order.number}`, allowNegative });
    if (allowNegative) {
      const neg = (await q.query(`SELECT 1 FROM inventory WHERE branch_id=$1 AND ingredient_id = ANY($2::uuid[]) AND qty < 0`, [order.branch_id, ingredientIds])).rowCount;
      if (neg) await q.query('UPDATE orders SET needs_review = true WHERE id=$1', [order.id]);
    }
  }

  // ───────────────────────── descuentos ─────────────────────────
  /** Umbral (%) de descuento manual sin supervisor. Un valor inválido NUNCA desactiva el control: cae al 10 %. */
  private async discountThreshold(branchId: string): Promise<number> {
    const n = Number(await this.settings.get('sales.discountThresholdPct', branchId, 10));
    return Number.isFinite(n) && n >= 0 ? n : 10;
  }

  /**
   * Tras reducir la cuenta (cancelar/cambiar partidas, dividir) un descuento fijo ya aplicado pesa más en proporción.
   * Los descuentos manuales autoaprobados que superen el umbral se revocan (más recientes primero); los autorizados por supervisor se conservan.
   */
  private async enforceDiscountLimit(q: Tx, orderId: string, branchId: string) {
    const threshold = await this.discountThreshold(branchId);
    for (;;) {
      const o = (await q.query('SELECT subtotal FROM orders WHERE id=$1', [orderId])).rows[0];
      const subtotal = amountToCents(o.subtotal);
      if (!subtotal) return;
      const rows = (await q.query(`SELECT id, kind, value, amount, self_approved FROM order_discounts WHERE order_id=$1 AND kind IN ('PERCENT','FIXED') ORDER BY created_at DESC, id DESC`, [orderId])).rows;
      const total = rows.reduce((a, r) => a + amountToCents(r.amount), 0);
      if ((total / subtotal) * 100 <= threshold) return;
      const revocable = rows.find((r) => r.self_approved);
      if (!revocable) return;
      await q.query('DELETE FROM order_discounts WHERE id=$1', [revocable.id]);
      await this.audit.record(q, { action: 'order.discount_revoked', entity: 'order', entityId: orderId, branchId, oldValue: { kind: revocable.kind, value: revocable.value, amount: revocable.amount }, reason: 'Excede el umbral tras cambiar la cuenta' });
      await this.recalc(q, orderId);
    }
  }

  async discount(orderId: string, d: Dict) {
    return this.db.tx(async (q) => {
      const o = await this.lockOrder(q, orderId);
      this.assertBranch('sales.discount.apply', o.branch_id);
      if (['CANCELLED', 'COMPLETED'].includes(o.status) || o.payment_status === 'PAID' || o.paid_total > 0)
        throw new AppError('ORDER_INVALID_TRANSITION', 409, undefined, false, '⚠️ La cuenta ya tiene pagos: no se pueden aplicar descuentos.');
      const subtotal = amountToCents(o.subtotal);
      const amount = discountCents(d.kind, d.value, subtotal);
      // Umbral sobre el ACUMULADO de descuentos manuales (existentes + nuevo): varios descuentos pequeños no eluden al supervisor.
      const manual = amountToCents((await q.query(`SELECT COALESCE(sum(amount),0) AS s FROM order_discounts WHERE order_id=$1 AND kind IN ('PERCENT','FIXED')`, [orderId])).rows[0].s);
      const pct = subtotal ? ((manual + amount) / subtotal) * 100 : 0;
      const threshold = await this.discountThreshold(o.branch_id);
      const selfApproved = pct <= threshold;
      const authBy = selfApproved ? ctx().principal!.userId : await this.supervisor.authorize('sales.discount.override', o.branch_id, d.supervisor);
      await q.query(`INSERT INTO order_discounts (tenant_id, order_id, kind, value, amount, reason, authorized_by, created_by, self_approved) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8)`,
        [orderId, d.kind, d.value, centsToAmount(amount), d.reason, authBy, ctx().principal!.userId, selfApproved]);
      await this.recalc(q, orderId);
      await this.audit.record(q, { action: 'order.discount', entity: 'order', entityId: orderId, branchId: o.branch_id, newValue: { ...d, supervisor: undefined, amount: centsToAmount(amount), authorizedBy: authBy }, reason: d.reason });
      return this.get(orderId, q);
    });
  }

  async removeDiscount(orderId: string, discountId: string) {
    return this.db.tx(async (q) => {
      const o = await this.lockOrder(q, orderId);
      this.assertBranch('sales.discount.override', o.branch_id);
      if (o.payment_status === 'PAID') throw new AppError('ORDER_ALREADY_PAID', 409);
      const r = await q.query('DELETE FROM order_discounts WHERE id=$1 AND order_id=$2 RETURNING kind, value, amount', [discountId, orderId]);
      if (!r.rowCount) throw notFound('discount');
      await this.recalc(q, orderId);
      await this.audit.record(q, { action: 'order.discount_removed', entity: 'order', entityId: orderId, branchId: o.branch_id, oldValue: r.rows[0] });
      return this.get(orderId, q);
    });
  }

  // ───────────────────────── cancelación ─────────────────────────
  async cancel(orderId: string, d: { reason: string; supervisor?: SupervisorInput }) {
    return this.db.tx(async (q) => {
      const o = await this.lockOrder(q, orderId);
      this.assertBranch('sales.order.update', o.branch_id); this.assertOwner(o);
      if (o.status === 'CANCELLED') return this.get(orderId, q);
      if (o.paid_total > 0) throw new AppError('ORDER_INVALID_TRANSITION', 409, undefined, false, '⚠️ La cuenta ya tiene pagos: realiza una devolución.');
      if (o.status === 'COMPLETED') throw new AppError('ORDER_INVALID_TRANSITION', 409);
      const sent = (await q.query(`SELECT count(*)::int n FROM order_items WHERE order_id=$1 AND status NOT IN ('PENDING','CANCELLED')`, [orderId])).rows[0].n;
      const authBy = sent > 0 ? await this.supervisor.authorize('sales.order.cancel', o.branch_id, d.supervisor) : ctx().principal!.userId;
      await this.voidOrder(q, o, d.reason, authBy);
      return this.get(orderId, q);
    });
  }

  /** Anula la orden: items, tickets de cocina, inventario (sólo lo no preparado) y mesa. */
  async voidOrder(q: Tx, o: Dict, reason: string, authorizedBy: string, refunded = false) {
    await this.assertNotInvoiced(q, o.id);
    const items = (await q.query(`SELECT id, status FROM order_items WHERE order_id=$1 AND ${ACTIVE_ITEM}`, [o.id])).rows;
    await this.engine.lockForRefs(q, 'order_item', items.map((r) => r.id));   // mismo orden de bloqueo que las ventas (evita deadlocks)
    for (const it of items) await this.cancelSentItem(q, it.id, it.status, reason);
    await q.query(`UPDATE order_items SET status='CANCELLED' WHERE order_id=$1`, [o.id]);
    await q.query(`UPDATE kitchen_orders SET status='CANCELLED' WHERE order_id=$1 AND status IN ('NEW','PREPARING','READY')`, [o.id]);
    await q.query(`UPDATE orders SET cancel_reason=$2, cancelled_by=$3, cancelled_at=now(), closed_at=now() WHERE id=$1`, [o.id, reason, ctx().principal!.userId]);
    await this.setStatus(q, o, 'CANCELLED', { force: true, note: reason });
    await this.audit.record(q, { action: refunded ? 'order.refund_cancel' : 'order.cancel', entity: 'order', entityId: o.id, branchId: o.branch_id,
      oldValue: { number: o.number, total: o.total, status: o.status }, reason, newValue: { authorizedBy } });
    await this.events.emit(q, { type: 'OrderCancelled', branchId: o.branch_id, payload: { orderId: o.id, number: o.number, refunded } });
    await this.releaseTableIfDone(q, o);
  }

  // ───────────────────────── dividir cuenta ─────────────────────────
  /** Mueve items a una nueva orden de la misma mesa (cada comensal paga la suya). */
  async splitItems(orderId: string, itemIds: string[]) {
    return this.db.tx(async (q) => {
      const o = await this.lockOrder(q, orderId);
      this.assertBranch('sales.order.update', o.branch_id); this.assertOwner(o);
      if (o.paid_total > 0 || ['CANCELLED', 'COMPLETED'].includes(o.status)) throw new AppError('ORDER_INVALID_TRANSITION', 409);
      const top = (await q.query(`SELECT id FROM order_items WHERE order_id=$1 AND parent_item_id IS NULL AND ${ACTIVE_ITEM} AND id = ANY($2::uuid[])`, [orderId, itemIds])).rows.map((r) => r.id);
      const all = (await q.query(`SELECT count(*)::int n FROM order_items WHERE order_id=$1 AND parent_item_id IS NULL AND ${ACTIVE_ITEM}`, [orderId])).rows[0].n;
      if (top.length !== new Set(itemIds).size || top.length === 0) throw new AppError('VALIDATION_ERROR', 400, { field: 'itemIds' });
      if (top.length === all) throw new AppError('VALIDATION_ERROR', 400, { field: 'itemIds', message: 'Deja al menos un producto en la cuenta original' });
      const bdate = o.business_date;
      const number = (await q.query(`SELECT next_counter($1) AS n`, [`order:${o.branch_id}:${bdate instanceof Date ? bdate.toISOString().slice(0, 10) : bdate}`])).rows[0].n;
      const n = (await q.query(
        `INSERT INTO orders (tenant_id, branch_id, number, business_date, channel, status, table_session_id, table_id, customer_id, customer_name, waiter_id, guests, created_by, sent_at)
         SELECT tenant_id, branch_id, $2, business_date, channel, status, table_session_id, table_id, customer_id, customer_name, waiter_id, guests, created_by, sent_at FROM orders WHERE id=$1 RETURNING id`, [orderId, number])).rows[0];
      await q.query(`UPDATE order_items SET order_id=$2 WHERE id = ANY($1::uuid[]) OR parent_item_id = ANY($1::uuid[])`, [top, n.id]);
      await this.recalc(q, orderId); await this.recalc(q, n.id);
      await this.enforceDiscountLimit(q, orderId, o.branch_id); await this.enforceDiscountLimit(q, n.id, o.branch_id);
      await this.audit.record(q, { action: 'order.split', entity: 'order', entityId: orderId, branchId: o.branch_id, newValue: { newOrderId: n.id, items: top.length } });
      return { source: await this.get(orderId, q), created: await this.get(n.id, q) };
    });
  }

  // ───────────────────────── lectura ─────────────────────────
  async get(id: string, tx?: Tx) {
    const run = async (q: Tx) => {
      const o = (await q.query(
        `SELECT o.id, o.branch_id AS "branchId", o.number, o.business_date AS "businessDate", o.channel, o.status, o.payment_status AS "paymentStatus",
                o.table_session_id AS "tableSessionId", o.table_id AS "tableId", t.number AS "tableNumber", o.customer_id AS "customerId", o.customer_name AS "customerName",
                o.waiter_id AS "waiterId", w.full_name AS "waiterName", o.guests, o.subtotal, o.discount_total AS "discountTotal", o.tax_total AS "taxTotal", o.tip_total AS "tipTotal",
                o.total, o.paid_total AS "paidTotal", o.refunded_total AS "refundedTotal", o.notes, o.needs_review AS "needsReview", o.cancel_reason AS "cancelReason", o.created_at AS "createdAt", o.sent_at AS "sentAt", o.closed_at AS "closedAt",
                o.version, o.source, o.client_uuid AS "clientUuid", ${ctx().principal!.can('catalog.cost.read', undefined) ? 'o.cost_total' : 'NULL::numeric'} AS "costTotal"
           FROM orders o LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN users w ON w.id = o.waiter_id WHERE o.id=$1`, [id])).rows[0];
      if (!o) throw notFound('order');
      this.assertBranch('sales.order.read', o.branchId);
      this.assertOwner({ branch_id: o.branchId, waiter_id: o.waiterId, created_by: o.waiterId, source: o.source });
      const items = (await q.query(
        `SELECT oi.id, oi.parent_item_id AS "parentItemId", oi.product_id AS "productId", oi.variant_id AS "variantId", oi.slot_name AS "slotName", oi.name, oi.qty, oi.unit_price AS "unitPrice",
                oi.line_total AS "lineTotal", oi.status, oi.station_key AS "stationKey", oi.notes,
                COALESCE((SELECT json_agg(json_build_object('id', m.id, 'name', m.name, 'type', m.type, 'priceDelta', m.price_delta) ORDER BY m.name) FROM order_item_modifiers m WHERE m.order_item_id = oi.id), '[]') AS modifiers
           FROM order_items oi WHERE oi.order_id=$1 ORDER BY oi.created_at, oi.id`, [id])).rows;
      o.items = items;
      o.payments = (await q.query(`SELECT id, kind, method, amount, tip, reference, at FROM payments WHERE order_id=$1 ORDER BY at`, [id])).rows;
      o.discounts = (await q.query(`SELECT id, kind, value, amount, reason FROM order_discounts WHERE order_id=$1 ORDER BY created_at`, [id])).rows;
      o.remaining = o.paymentStatus === 'PAID' || o.status === 'CANCELLED' ? 0 : r4(Math.max(o.total - o.paidTotal, 0));
      return o;
    };
    return tx ? run(tx) : this.db.tx(run);
  }

  async list(f: Dict) {
    this.assertBranch('sales.order.read', f.branchId);
    const p = ctx().principal!;
    const onlyMine = f.mine || !p.can('sales.order.readAll', f.branchId);
    return this.db.tx(async (q) => (await q.query(
      `SELECT o.id, o.number, o.channel, o.status, o.payment_status AS "paymentStatus", o.total, o.paid_total AS "paidTotal", t.number AS "tableNumber", o.customer_name AS "customerName",
              w.full_name AS "waiterName", o.created_at AS "createdAt", o.needs_review AS "needsReview",
              (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id AND i.status <> 'CANCELLED' AND i.parent_item_id IS NULL) AS "itemCount"
         FROM orders o LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN users w ON w.id = o.waiter_id
        WHERE o.branch_id = $1 AND ($2::text IS NULL OR o.status = ANY(string_to_array($2, ','))) AND ($3::text IS NULL OR o.payment_status = $3)
          AND ($4::uuid IS NULL OR o.table_id = $4) AND ($5::date IS NULL OR o.business_date >= $5) AND ($6::date IS NULL OR o.business_date <= $6)
          AND ($7::text IS NULL OR o.channel = $7) AND (NOT $8 OR o.waiter_id = $9 OR o.created_by = $9)
        ORDER BY o.created_at DESC LIMIT $10 OFFSET $11`,
      [f.branchId, f.status ?? null, f.paymentStatus ?? null, f.tableId ?? null, f.from ?? null, f.to ?? null, f.channel ?? null, onlyMine, p.userId, f.limit, f.offset])).rows);
  }

  /** Datos estructurados del ticket (la capa de impresión los formatea). */
  async receipt(id: string) {
    const o = await this.get(id);
    const branch = await this.db.tx(async (q) => (await q.query(`SELECT b.name, b.address, b.phone, r.name AS restaurant, r.tax_id AS "taxId", r.currency FROM branches b JOIN restaurants r ON r.id = b.tenant_id WHERE b.id=$1`, [o.branchId])).rows[0]);
    return { ...o, branch, items: o.items.filter((i: Dict) => i.status !== 'CANCELLED'), printedAt: new Date().toISOString() };
  }
}
