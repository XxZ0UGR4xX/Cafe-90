import { Injectable } from '@nestjs/common';
import { DbService, Tx } from '../../database/db.service';
import { AppError, conflict, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { InventoryEngine } from '../inventory/inventory.engine';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../tenancy/settings.service';

type Dict = Record<string, any>;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const DEFAULT_APPROVAL_THRESHOLD = 10_000;
const PRICE_VARIANCE = 0.05;

@Injectable()
export class PurchasingService {
  constructor(private readonly db: DbService, private readonly engine: InventoryEngine, private readonly audit: AuditService,
    private readonly notifications: NotificationsService, private readonly settings: SettingsService) {}

  private assertBranch(perm: string, branchId: string) {
    if (!ctx().principal!.can(perm, branchId)) throw forbidden({ permission: perm, branchId });
  }

  // ───────── Proveedores ─────────
  listSuppliers() {
    return this.db.tx(async (q) => (await q.query(
      `SELECT s.id, s.name, s.contact_name AS "contactName", s.phone, s.email, s.tax_id AS "taxId", s.address, s.lead_time_days AS "leadTimeDays",
              s.payment_terms_days AS "paymentTermsDays", s.is_active AS "isActive",
              COALESCE(json_agg(json_build_object('ingredientId', sp.ingredient_id, 'ingredient', i.name, 'price', sp.price)) FILTER (WHERE sp.ingredient_id IS NOT NULL), '[]') AS products
         FROM suppliers s LEFT JOIN supplier_products sp ON sp.supplier_id = s.id LEFT JOIN ingredients i ON i.id = sp.ingredient_id
        WHERE s.deleted_at IS NULL GROUP BY s.id ORDER BY s.name`)).rows);
  }

  saveSupplier(id: string | null, d: Dict) {
    return this.db.tx(async (q) => {
      const vals = [d.name, d.contactName ?? null, d.phone ?? null, d.email ?? null, d.taxId ?? null, d.address ?? null, d.leadTimeDays, d.paymentTermsDays, d.isActive];
      let sid = id;
      if (id) {
        const r = await q.query(`UPDATE suppliers SET name=$2,contact_name=$3,phone=$4,email=$5,tax_id=$6,address=$7,lead_time_days=$8,payment_terms_days=$9,is_active=$10 WHERE id=$1 AND deleted_at IS NULL`, [id, ...vals]);
        if (!r.rowCount) throw notFound('supplier');
      } else {
        sid = (await q.query(`INSERT INTO suppliers (tenant_id,name,contact_name,phone,email,tax_id,address,lead_time_days,payment_terms_days,is_active) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, vals)).rows[0].id;
      }
      await q.query('DELETE FROM supplier_products WHERE supplier_id=$1', [sid]);
      for (const p of d.products) await q.query('INSERT INTO supplier_products (tenant_id, supplier_id, ingredient_id, price) VALUES (app_tenant_id(),$1,$2,$3)', [sid, p.ingredientId, p.price]);
      await this.audit.record(q, { action: id ? 'supplier.update' : 'supplier.create', entity: 'supplier', entityId: sid, newValue: d });
      return { id: sid, ...d };
    }).catch((e) => { if (e.code === '23505') throw conflict({ field: 'name' }, '⚠️ Ya existe un proveedor con ese nombre.'); throw e; });
  }

  deleteSupplier(id: string) {
    return this.db.tx(async (q) => {
      const r = await q.query('UPDATE suppliers SET deleted_at = now(), is_active=false WHERE id=$1 AND deleted_at IS NULL', [id]);
      if (!r.rowCount) throw notFound('supplier');
      await this.audit.record(q, { action: 'supplier.delete', entity: 'supplier', entityId: id });
    });
  }

  // ───────── Cotizaciones ─────────
  createQuote(d: Dict) {
    this.assertBranch('purchasing.order.write', d.branchId);
    return this.db.tx(async (q) => {
      const id = (await q.query(`INSERT INTO purchase_quotes (tenant_id, branch_id, supplier_id, valid_until, notes, created_by) VALUES (app_tenant_id(),$1,$2,$3,$4,$5) RETURNING id`,
        [d.branchId, d.supplierId, d.validUntil ?? null, d.notes ?? null, ctx().principal!.userId])).rows[0].id;
      for (const it of d.items) await q.query('INSERT INTO purchase_quote_items (tenant_id, quote_id, ingredient_id, qty, unit_price) VALUES (app_tenant_id(),$1,$2,$3,$4)', [id, it.ingredientId, it.qty, it.unitPrice]);
      return { id };
    });
  }

  listQuotes(branchId?: string) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT qt.id, qt.branch_id AS "branchId", s.name AS supplier, qt.status, qt.valid_until AS "validUntil",
              COALESCE(sum(i.qty * i.unit_price),0) AS total, qt.created_at AS "createdAt"
         FROM purchase_quotes qt JOIN suppliers s ON s.id = qt.supplier_id LEFT JOIN purchase_quote_items i ON i.quote_id = qt.id
        WHERE $1::uuid IS NULL OR qt.branch_id = $1 GROUP BY qt.id, s.name ORDER BY qt.created_at DESC LIMIT 100`, [branchId ?? null])).rows);
  }

  /** Acepta la cotización y genera la orden de compra en borrador. */
  acceptQuote(id: string) {
    return this.db.tx(async (q) => {
      const qt = (await q.query(`SELECT branch_id, supplier_id, status FROM purchase_quotes WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!qt) throw notFound('quote');
      this.assertBranch('purchasing.order.write', qt.branch_id);
      if (qt.status !== 'OPEN') throw new AppError('CONFLICT', 409);
      const items = (await q.query('SELECT ingredient_id, qty, unit_price FROM purchase_quote_items WHERE quote_id=$1', [id])).rows;
      await q.query(`UPDATE purchase_quotes SET status='ACCEPTED' WHERE id=$1`, [id]);
      return this.insertOrder(q, { branchId: qt.branch_id, supplierId: qt.supplier_id, quoteId: id,
        items: items.map((i) => ({ ingredientId: i.ingredient_id, qty: i.qty, unitPrice: i.unit_price })) });
    });
  }

  // ───────── Órdenes de compra ─────────
  private async insertOrder(q: Tx, d: Dict) {
    const number = (await q.query(`SELECT next_counter($1) AS n`, [`po:${d.branchId}`])).rows[0].n;
    const subtotal = r4(d.items.reduce((a: number, i: Dict) => a + i.qty * i.unitPrice, 0));
    const id = (await q.query(
      `INSERT INTO purchase_orders (tenant_id, branch_id, supplier_id, quote_id, number, subtotal, total, expected_on, notes, created_by)
       VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$5,$6,$7,$8) RETURNING id`,
      [d.branchId, d.supplierId, d.quoteId ?? null, number, subtotal, d.expectedOn ?? null, d.notes ?? null, ctx().principal!.userId])).rows[0].id;
    for (const it of d.items) await q.query('INSERT INTO purchase_order_items (tenant_id, purchase_order_id, ingredient_id, qty, unit_price) VALUES (app_tenant_id(),$1,$2,$3,$4)', [id, it.ingredientId, it.qty, it.unitPrice]);
    await this.audit.record(q, { action: 'purchase_order.create', entity: 'purchase_order', entityId: id, branchId: d.branchId, newValue: { number, subtotal } });
    return this.orderById(q, id);
  }

  createOrder(d: Dict) {
    this.assertBranch('purchasing.order.write', d.branchId);
    return this.db.tx((q) => this.insertOrder(q, d));
  }

  private async orderById(q: Tx, id: string, lock = false) {
    const o = (await q.query(
      `SELECT po.id, po.branch_id AS "branchId", po.supplier_id AS "supplierId", s.name AS supplier, po.number, po.status, po.subtotal, po.tax_total AS "taxTotal", po.total,
              po.expected_on AS "expectedOn", po.notes, po.created_at AS "createdAt"
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id=$1 ${lock ? 'FOR UPDATE OF po' : ''}`, [id])).rows[0];
    if (!o) throw notFound('purchase_order');
    o.items = (await q.query(
      `SELECT poi.ingredient_id AS "ingredientId", i.name, i.unit, poi.qty, poi.qty_received AS "qtyReceived", poi.unit_price AS "unitPrice"
         FROM purchase_order_items poi JOIN ingredients i ON i.id = poi.ingredient_id WHERE poi.purchase_order_id=$1 ORDER BY i.name`, [id])).rows;
    return o;
  }

  listOrders(branchId?: string, status?: string) {
    const scope = ctx().principal!.branchScope('purchasing.order.read');
    return this.db.tx(async (q) => (await q.query(
      `SELECT po.id, po.number, po.branch_id AS "branchId", s.name AS supplier, po.status, po.total, po.expected_on AS "expectedOn", po.created_at AS "createdAt"
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE ($1::uuid IS NULL OR po.branch_id=$1) AND ($2::text IS NULL OR po.status=$2) AND ($3::uuid[] IS NULL OR po.branch_id = ANY($3::uuid[]))
        ORDER BY po.created_at DESC LIMIT 200`, [branchId ?? null, status ?? null, scope])).rows);
  }

  getOrder(id: string) { return this.db.tx((q) => this.orderById(q, id)); }

  /** DRAFT → SENT, o PENDING_APPROVAL si supera el umbral configurable. */
  submitOrder(id: string) {
    return this.db.tx(async (q) => {
      const o = await this.orderById(q, id, true);
      this.assertBranch('purchasing.order.write', o.branchId);
      if (o.status !== 'DRAFT') throw new AppError('CONFLICT', 409);
      const threshold = Number(await this.settings.get('purchasing.approvalThreshold', o.branchId, DEFAULT_APPROVAL_THRESHOLD));
      const needsApproval = o.total > threshold && !ctx().principal!.can('purchasing.order.approve', o.branchId);
      const next = needsApproval ? 'PENDING_APPROVAL' : 'SENT';
      await q.query(`UPDATE purchase_orders SET status=$2, sent_at = CASE WHEN $2='SENT' THEN now() ELSE sent_at END, approved_by = CASE WHEN $2='SENT' AND $3 THEN $4::uuid ELSE approved_by END WHERE id=$1`,
        [id, next, o.total > threshold, ctx().principal!.userId]);
      await this.audit.record(q, { action: 'purchase_order.submit', entity: 'purchase_order', entityId: id, branchId: o.branchId, newValue: { status: next } });
      return this.orderById(q, id);
    });
  }

  approveOrder(id: string) {
    return this.db.tx(async (q) => {
      const o = await this.orderById(q, id, true);
      this.assertBranch('purchasing.order.approve', o.branchId);
      if (o.status !== 'PENDING_APPROVAL') throw new AppError('CONFLICT', 409);
      await q.query(`UPDATE purchase_orders SET status='SENT', sent_at=now(), approved_by=$2 WHERE id=$1`, [id, ctx().principal!.userId]);
      await this.audit.record(q, { action: 'purchase_order.approve', entity: 'purchase_order', entityId: id, branchId: o.branchId });
      return this.orderById(q, id);
    });
  }

  cancelOrder(id: string) {
    return this.db.tx(async (q) => {
      const o = await this.orderById(q, id, true);
      this.assertBranch('purchasing.order.write', o.branchId);
      if (!['DRAFT', 'PENDING_APPROVAL', 'SENT'].includes(o.status) || o.items.some((i: Dict) => i.qtyReceived > 0)) throw new AppError('CONFLICT', 409);
      await q.query(`UPDATE purchase_orders SET status='CANCELLED' WHERE id=$1`, [id]);
      await this.audit.record(q, { action: 'purchase_order.cancel', entity: 'purchase_order', entityId: id, branchId: o.branchId });
      return this.orderById(q, id);
    });
  }

  /** Recepción (parcial o total): genera PURCHASE_IN con lote/caducidad y actualiza costo promedio. */
  receive(id: string, d: Dict) {
    return this.db.tx(async (q) => {
      const o = await this.orderById(q, id, true);
      this.assertBranch('purchasing.receive.write', o.branchId);
      if (!['SENT', 'PARTIAL'].includes(o.status)) throw new AppError('CONFLICT', 409, { status: o.status }, false, '⚠️ La orden no está lista para recibirse.');
      const receiptId = (await q.query(`INSERT INTO goods_receipts (tenant_id, branch_id, purchase_order_id, notes, received_by) VALUES (app_tenant_id(),$1,$2,$3,$4) RETURNING id`,
        [o.branchId, id, d.notes ?? null, ctx().principal!.userId])).rows[0].id;
      const lines = [...d.items].sort((a: Dict, b: Dict) => (a.ingredientId < b.ingredientId ? -1 : 1));
      for (const it of lines) {
        const line = o.items.find((x: Dict) => x.ingredientId === it.ingredientId);
        if (!line) throw new AppError('VALIDATION_ERROR', 400, { ingredientId: it.ingredientId, message: 'No pertenece a la orden' });
        if (r4(line.qtyReceived + it.qty) > line.qty * 1.1) throw new AppError('VALIDATION_ERROR', 400, { ingredient: line.name, message: 'Excede lo ordenado (+10 % tolerancia)' });
        const unitCost = it.unitCost ?? line.unitPrice;
        await q.query('UPDATE purchase_order_items SET qty_received = qty_received + $3 WHERE purchase_order_id=$1 AND ingredient_id=$2', [id, it.ingredientId, it.qty]);
        await q.query('INSERT INTO goods_receipt_items (tenant_id, receipt_id, ingredient_id, qty, unit_cost, lot_code, expires_on) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6)', [receiptId, it.ingredientId, it.qty, unitCost, it.lotCode ?? null, it.expiresOn ?? null]);
        await this.engine.apply(q, { branchId: o.branchId, ingredientId: it.ingredientId, type: 'PURCHASE_IN', qty: it.qty, unitCost, lotCode: it.lotCode, expiresOn: it.expiresOn, refType: 'purchase_order', refId: id, reason: `OC #${o.number}`, supplierId: o.supplierId });
      }
      const done = (await q.query('SELECT bool_and(qty_received >= qty) AS all FROM purchase_order_items WHERE purchase_order_id=$1', [id])).rows[0].all;
      await q.query('UPDATE purchase_orders SET status=$2 WHERE id=$1', [id, done ? 'RECEIVED' : 'PARTIAL']);
      await this.notifications.emit(q, { type: 'PO_RECEIVED', branchId: o.branchId, title: `📦 Orden de compra #${o.number} ${done ? 'recibida' : 'recibida parcialmente'}`, body: o.supplier });
      await this.audit.record(q, { action: 'purchase_order.receive', entity: 'purchase_order', entityId: id, branchId: o.branchId, newValue: { items: d.items.length, complete: done } });
      return this.orderById(q, id);
    });
  }

  // ───────── Facturas de proveedor (cotejo OC ↔ recepción ↔ factura) ─────────
  createInvoice(d: Dict) {
    return this.db.tx(async (q) => {
      let flag = false;
      if (d.purchaseOrderId) {
        const received = (await q.query(`SELECT COALESCE(sum(qty_received * unit_price),0) AS v FROM purchase_order_items WHERE purchase_order_id=$1`, [d.purchaseOrderId])).rows[0].v as number;
        flag = received > 0 ? Math.abs(d.total - received) / received > PRICE_VARIANCE : true;
      }
      const row = (await q.query(
        `INSERT INTO supplier_invoices (tenant_id, supplier_id, purchase_order_id, invoice_number, total, issued_on, due_on, price_variance_flag)
         VALUES (app_tenant_id(),$1,$2,$3,$4,COALESCE($5::date, tenant_today()),$6,$7) RETURNING id, status, price_variance_flag AS "priceVarianceFlag"`,
        [d.supplierId, d.purchaseOrderId ?? null, d.invoiceNumber, d.total, d.issuedOn ?? null, d.dueOn ?? null, flag])).rows[0];
      await this.audit.record(q, { action: 'supplier_invoice.create', entity: 'supplier_invoice', entityId: row.id, newValue: d });
      return row;
    }).catch((e) => { if (e.code === '23505') throw conflict({ field: 'invoiceNumber' }, '⚠️ Esa factura ya fue registrada.'); throw e; });
  }

  listInvoices(status?: string) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT si.id, s.name AS supplier, si.invoice_number AS "invoiceNumber", si.total, si.issued_on AS "issuedOn", si.due_on AS "dueOn", si.status, si.price_variance_flag AS "priceVarianceFlag"
         FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id WHERE $1::text IS NULL OR si.status = $1 ORDER BY si.issued_on DESC LIMIT 200`, [status ?? null])).rows);
  }

  payInvoice(id: string) {
    return this.db.tx(async (q) => {
      const r = await q.query(`UPDATE supplier_invoices SET status='PAID', paid_at=now() WHERE id=$1 AND status='PENDING' RETURNING id`, [id]);
      if (!r.rowCount) throw new AppError('CONFLICT', 409);
      await this.audit.record(q, { action: 'supplier_invoice.pay', entity: 'supplier_invoice', entityId: id });
      return { id, status: 'PAID' };
    });
  }

  costHistory(ingredientId: string) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT unit_cost AS "unitCost", at FROM ingredient_cost_history WHERE ingredient_id=$1 ORDER BY at DESC LIMIT 100`, [ingredientId])).rows);
  }

  /** Sugerencias de compra: existencia ≤ mínimo → llevar a máximo. */
  suggestions(branchId: string) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT i.id AS "ingredientId", i.name, i.unit, inv.qty, inv.min_qty AS "minQty", inv.max_qty AS "maxQty",
              GREATEST(inv.max_qty - inv.qty, 0) AS "suggestedQty",
              (SELECT json_build_object('supplierId', s.id, 'supplier', s.name, 'price', sp.price) FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id
                WHERE sp.ingredient_id = i.id AND s.is_active AND s.deleted_at IS NULL ORDER BY sp.price LIMIT 1) AS "bestSupplier"
         FROM inventory inv JOIN ingredients i ON i.id = inv.ingredient_id AND i.deleted_at IS NULL
        WHERE inv.branch_id = $1 AND inv.qty <= inv.min_qty ORDER BY i.name`, [branchId])).rows);
  }
}
