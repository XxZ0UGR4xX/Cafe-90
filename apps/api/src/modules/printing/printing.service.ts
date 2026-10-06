import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { DbService, Tx } from '../../database/db.service';
import { forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { DomainEvents } from '../../common/domain-events';
import { AuditService } from '../audit/audit.service';
import { renderCashClose, renderKitchenTicket, renderPurchaseOrder, renderReceipt } from './ticket.format';

type Dict = Record<string, any>;

/** Cola de impresión: renderiza texto y lo encola por impresora; un agente local (ESC/POS) lo recoge y confirma. */
@Injectable()
export class PrintingService {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly events: DomainEvents, @Inject(ENV) private readonly env: Env) {}

  register() {
    this.events.on('KitchenChanged', async (q, e) => { if (e.payload.new) await this.enqueueKitchen(q, e.payload.ticketId, e.branchId!); });
    this.events.on('OrderPaid', async (q, e) => { await this.enqueueReceipt(q, e.payload.orderId, e.branchId!); });
    this.events.on('CashShiftClosed', async (q, e) => {
      const r = e.payload.report as Dict;
      await this.enqueue(q, { branchId: e.branchId!, kind: 'CASH_CLOSE', refId: e.payload.shiftId, role: 'CASH', content: (w) => renderCashClose(r, w) });
    });
  }

  // ───────── impresoras ─────────
  printers(branchId: string) {
    return this.db.tx(async (q) => (await q.query(`SELECT id, branch_id AS "branchId", name, role, connection, columns, station_keys AS "stationKeys", is_active AS "isActive" FROM printers WHERE branch_id=$1 ORDER BY name`, [branchId])).rows);
  }
  savePrinter(id: string | null, d: Dict) {
    if (!ctx().principal!.can('printing.manage', d.branchId)) throw forbidden();
    return this.db.tx(async (q) => {
      const vals = [d.branchId, d.name, d.role, JSON.stringify(d.connection), d.columns, d.stationKeys, d.isActive];
      const r = id
        ? await q.query(`UPDATE printers SET branch_id=$1,name=$2,role=$3,connection=$4,columns=$5,station_keys=$6,is_active=$7 WHERE id=$8 RETURNING id`, [...vals, id])
        : await q.query(`INSERT INTO printers (tenant_id, branch_id, name, role, connection, columns, station_keys, is_active) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7) RETURNING id`, vals);
      if (!r.rows[0]) throw notFound('printer');
      await this.audit.record(q, { action: id ? 'printer.update' : 'printer.create', entity: 'printer', entityId: r.rows[0].id, branchId: d.branchId, newValue: d });
      return { id: r.rows[0].id, ...d };
    });
  }

  // ───────── cola ─────────
  private async enqueue(q: Tx, j: { branchId: string; kind: string; refId?: string; role: 'KITCHEN' | 'CASH' | 'BAR'; station?: string; content: (width: number) => string }) {
    const printer = (await q.query(
      `SELECT id, columns FROM printers WHERE branch_id=$1 AND is_active AND ((cardinality(station_keys) > 0 AND $3::text = ANY(station_keys)) OR (cardinality(station_keys)=0 AND role=$2))
        ORDER BY (cardinality(station_keys) > 0 AND $3::text = ANY(station_keys)) DESC LIMIT 1`, [j.branchId, j.role, j.station ?? null])).rows[0];
    if (!printer) return;   // sin impresora configurada: no se encola
    await q.query(`INSERT INTO print_jobs (tenant_id, branch_id, printer_id, kind, ref_id, content) VALUES (app_tenant_id(),$1,$2,$3,$4,$5)`, [j.branchId, printer.id, j.kind, j.refId ?? null, j.content(printer.columns)]);
  }

  async ticketData(q: Tx, ticketId: string) {
    const t = (await q.query(
      `SELECT ko.id, ko.station_key AS "stationKey", ko.round, ko.created_at AS "createdAt", o.number, o.channel, tb.number AS "tableNumber",
              (SELECT json_agg(json_build_object('qty', i.qty, 'name', i.name, 'modifiers', i.modifiers, 'notes', i.notes)) FROM kitchen_order_items i WHERE i.kitchen_order_id = ko.id) AS items
         FROM kitchen_orders ko JOIN orders o ON o.id = ko.order_id LEFT JOIN tables tb ON tb.id = o.table_id WHERE ko.id=$1`, [ticketId])).rows[0];
    return t;
  }
  private async enqueueKitchen(q: Tx, ticketId: string, branchId: string) {
    const t = await this.ticketData(q, ticketId);
    if (t) await this.enqueue(q, { branchId, kind: 'KITCHEN_TICKET', refId: ticketId, role: 'KITCHEN', station: t.stationKey, content: (w) => renderKitchenTicket(t, w) });
  }
  private async enqueueReceipt(q: Tx, orderId: string, branchId: string) {
    const o = await this.receiptData(q, orderId);
    await this.enqueue(q, { branchId, kind: 'RECEIPT', refId: orderId, role: 'CASH', content: (w) => renderReceipt(o, w) });
  }

  async receiptData(q: Tx, orderId: string): Promise<Dict> {
    const o = (await q.query(
      `SELECT o.id, o.number, o.channel, o.created_at AS "createdAt", o.subtotal, o.discount_total AS "discountTotal", o.tax_total AS "taxTotal", o.tip_total AS "tipTotal", o.total,
              o.delivery_fee AS "deliveryFee", o.invoice_code AS "invoiceCode", t.number AS "tableNumber", w.full_name AS "waiterName",
              json_build_object('name', b.name, 'address', b.address, 'restaurant', r.name, 'taxId', r.tax_id) AS branch
         FROM orders o JOIN branches b ON b.id = o.branch_id JOIN restaurants r ON r.id = o.tenant_id LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN users w ON w.id = o.waiter_id WHERE o.id=$1`, [orderId])).rows[0];
    o.invoiceUrl = `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/factura`;
    o.items = (await q.query(`SELECT i.id, i.parent_item_id AS "parentItemId", i.name, i.qty, i.line_total AS "lineTotal",
        COALESCE((SELECT json_agg(json_build_object('type', m.type, 'name', m.name, 'priceDelta', m.price_delta)) FROM order_item_modifiers m WHERE m.order_item_id = i.id), '[]') AS modifiers
        FROM order_items i WHERE i.order_id=$1 AND i.status <> 'CANCELLED' ORDER BY i.created_at, i.id`, [orderId])).rows;
    o.payments = (await q.query('SELECT kind, method, amount FROM payments WHERE order_id=$1 ORDER BY at', [orderId])).rows;
    return o;
  }

  receiptText(orderId: string, width = 42) { return this.db.tx(async (q) => renderReceipt(await this.receiptData(q, orderId), width)); }
  purchaseOrderText(po: Dict, width = 42) { return renderPurchaseOrder(po, width); }

  pending(printerId: string) {
    return this.db.tx(async (q) => (await q.query(`SELECT id, kind, content, created_at AS "createdAt" FROM print_jobs WHERE printer_id=$1 AND status='PENDING' ORDER BY created_at LIMIT 50`, [printerId])).rows);
  }
  ack(id: string, ok: boolean) {
    return this.db.tx(async (q) => {
      const r = await q.query(`UPDATE print_jobs SET status = CASE WHEN $2 THEN 'PRINTED' ELSE CASE WHEN attempts >= 2 THEN 'FAILED' ELSE 'PENDING' END END, attempts = attempts + 1, printed_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1 RETURNING id, status`, [id, ok]);
      if (!r.rows[0]) throw notFound('print_job');
      return r.rows[0];
    });
  }
  reprint(kind: 'RECEIPT', orderId: string, branchId: string) {
    return this.db.tx(async (q) => { await this.enqueueReceipt(q, orderId, branchId); return { queued: true }; });
  }
}
