import { Injectable } from '@nestjs/common';
import { DbService, Tx } from '../../database/db.service';
import { AppError, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { DomainEvents } from '../../common/domain-events';
import { AuditService } from '../audit/audit.service';
import { SupervisorService, type SupervisorInput } from '../identity/supervisor.service';
import { SalesService } from '../sales/sales.service';

type Dict = Record<string, any>;
const COLS = `d.id, d.order_id AS "orderId", o.number, d.branch_id AS "branchId", d.customer_name AS "customerName", d.phone, d.address, d.address_notes AS "addressNotes", d.fee,
  d.status, d.driver_id AS "driverId", u.full_name AS "driverName", d.payment_method AS "paymentMethod", d.eta_at AS "etaAt", d.created_at AS "createdAt",
  o.total, o.paid_total AS "paidTotal", o.payment_status AS "paymentStatus"`;
const NEXT: Record<string, string[]> = {
  RECEIVED: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['PREPARING', 'READY', 'CANCELLED'], PREPARING: ['READY', 'CANCELLED'],
  READY: ['ON_THE_WAY', 'CANCELLED'], ON_THE_WAY: ['DELIVERED', 'CANCELLED'], DELIVERED: [], CANCELLED: [],
};

@Injectable()
export class DeliveryService {
  constructor(private readonly db: DbService, private readonly sales: SalesService, private readonly audit: AuditService, private readonly events: DomainEvents, private readonly supervisor: SupervisorService) {}

  register() {
    // El avance de cocina mueve el estado del delivery (sin acoplar módulos).
    this.events.on('OrderStatusChanged', async (q, e) => {
      const to = e.payload.to as string;
      if (!['PREPARING', 'READY'].includes(to)) return;
      const d = (await q.query('SELECT id, status FROM delivery_orders WHERE order_id=$1', [e.payload.orderId])).rows[0];
      if (d && NEXT[d.status]!.includes(to)) await this.setDeliveryStatus(q, d.id, to, true);
    });
  }

  private async setDeliveryStatus(q: Tx, id: string, to: string, system = false) {
    await q.query(`UPDATE delivery_orders SET status=$2, delivered_at = CASE WHEN $2='DELIVERED' THEN now() ELSE delivered_at END WHERE id=$1`, [id, to]);
    await q.query(`INSERT INTO delivery_status_history (tenant_id, delivery_id, status, user_id) VALUES (app_tenant_id(),$1,$2,$3)`, [id, to, system ? null : ctx().principal?.userId ?? null]);
    const d = (await q.query('SELECT branch_id, order_id FROM delivery_orders WHERE id=$1', [id])).rows[0];
    await this.events.emit(q, { type: 'DeliveryChanged', branchId: d.branch_id, payload: { deliveryId: id, orderId: d.order_id, status: to } });
  }

  /** Crea el pedido a domicilio (orden canal DELIVERY + datos de entrega). */
  create(d: Dict) {
    if (!ctx().principal!.can('delivery.order.write', d.branchId)) throw forbidden({ permission: 'delivery.order.write' });
    return this.db.tx(async (q) => {
      const order = await this.sales.create({ branchId: d.branchId, channel: 'DELIVERY', customerId: d.customerId, customerName: d.customerName, notes: d.notes, items: d.items, clientUuid: d.clientUuid, send: false });
      const exists = (await q.query('SELECT id FROM delivery_orders WHERE order_id=$1', [order.id])).rows[0];
      if (exists) return this.byId(q, exists.id);
      await q.query('UPDATE orders SET delivery_fee=$2, source=$3 WHERE id=$1', [order.id, d.fee ?? 0, d.source ?? 'STAFF']);
      await this.sales.recalc(q, order.id);
      const row = (await q.query(
        `INSERT INTO delivery_orders (tenant_id, branch_id, order_id, customer_name, phone, address, address_notes, fee, payment_method) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [d.branchId, order.id, d.customerName, d.phone, d.address, d.addressNotes ?? null, d.fee ?? 0, d.paymentMethod])).rows[0];
      await q.query(`INSERT INTO delivery_status_history (tenant_id, delivery_id, status, user_id) VALUES (app_tenant_id(),$1,'RECEIVED',$2)`, [row.id, ctx().principal?.userId ?? null]);
      await this.audit.record(q, { action: 'delivery.create', entity: 'delivery_order', entityId: row.id, branchId: d.branchId, newValue: { orderId: order.id, address: d.address } });
      await this.events.emit(q, { type: 'DeliveryChanged', branchId: d.branchId, payload: { deliveryId: row.id, orderId: order.id, status: 'RECEIVED' } });
      return this.byId(q, row.id);
    });
  }

  private async byId(q: Tx, id: string) {
    const r = (await q.query(`SELECT ${COLS} FROM delivery_orders d JOIN orders o ON o.id = d.order_id LEFT JOIN users u ON u.id = d.driver_id WHERE d.id=$1`, [id])).rows[0];
    if (!r) throw notFound('delivery');
    r.history = (await q.query('SELECT status, at FROM delivery_status_history WHERE delivery_id=$1 ORDER BY at', [id])).rows;
    return r;
  }
  async get(id: string) {
    const r = await this.db.tx((q) => this.byId(q, id));
    const p = ctx().principal!;
    if (!p.can('delivery.order.read', r.branchId)) throw forbidden();   // el guard solo ve el id de la ruta: se valida la sucursal del pedido
    return r;
  }

  list(f: { branchId: string; status?: string; mine?: boolean }) {
    const p = ctx().principal!;
    const own = f.mine || (!p.can('delivery.order.read', f.branchId) && p.can('delivery.order.own', f.branchId));
    return this.db.tx(async (q) => (await q.query(
      `SELECT ${COLS} FROM delivery_orders d JOIN orders o ON o.id = d.order_id LEFT JOIN users u ON u.id = d.driver_id
        WHERE d.branch_id=$1 AND ($2::text IS NULL OR d.status = ANY(string_to_array($2, ','))) AND (NOT $3 OR d.driver_id = $4) ORDER BY d.created_at DESC LIMIT 200`,
      [f.branchId, f.status ?? null, own, p.userId])).rows);
  }

  assign(id: string, driverId: string) {
    return this.db.tx(async (q) => {
      const d = (await q.query('SELECT branch_id, status FROM delivery_orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!d) throw notFound('delivery');
      if (!ctx().principal!.can('delivery.order.write', d.branch_id)) throw forbidden();
      if (['DELIVERED', 'CANCELLED'].includes(d.status)) throw new AppError('CONFLICT', 409);
      const ok = (await q.query(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
        WHERE u.id=$1 AND u.status='ACTIVE' AND r.key='REPARTIDOR' AND (ur.branch_id IS NULL OR ur.branch_id=$2)`, [driverId, d.branch_id])).rowCount;
      if (!ok) throw new AppError('VALIDATION_ERROR', 400, { field: 'driverId', message: 'El usuario no es repartidor de esta sucursal' });
      await q.query('UPDATE delivery_orders SET driver_id=$2 WHERE id=$1', [id, driverId]);
      await this.audit.record(q, { action: 'delivery.assign', entity: 'delivery_order', entityId: id, branchId: d.branch_id, newValue: { driverId } });
      await this.events.emit(q, { type: 'DeliveryChanged', branchId: d.branch_id, payload: { deliveryId: id, driverId } });
      return this.byId(q, id);
    });
  }

  setStatus(id: string, to: string, reason?: string, supervisor?: SupervisorInput) {
    return this.db.tx(async (q) => {
      const d = (await q.query('SELECT * FROM delivery_orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!d) throw notFound('delivery');
      const p = ctx().principal!;
      const isDriver = d.driver_id === p.userId && p.can('delivery.order.own', d.branch_id);
      if (!p.can('delivery.order.write', d.branch_id) && !(isDriver && ['ON_THE_WAY', 'DELIVERED'].includes(to))) throw forbidden();
      if (!NEXT[d.status]!.includes(to)) throw new AppError('CONFLICT', 409, { from: d.status, to });
      if (to === 'ON_THE_WAY' && !d.driver_id) throw new AppError('VALIDATION_ERROR', 400, { field: 'driverId', message: 'Asigna un repartidor antes de salir' });
      if (to === 'CONFIRMED') await this.sales.sendToKitchen(d.order_id, q);
      if (to === 'CANCELLED') {
        if (!reason) throw new AppError('VALIDATION_ERROR', 400, { field: 'reason' });
        const o = await this.sales.lockOrder(q, d.order_id);
        if (o.paid_total > 0) throw new AppError('CONFLICT', 409, undefined, false, '⚠️ El pedido ya tiene pagos: realiza una devolución.');
        // Igual que cancelar una cuenta: con productos ya enviados a cocina se exige permiso de cancelación o PIN de supervisor
        const sent = (await q.query(`SELECT count(*)::int n FROM order_items WHERE order_id=$1 AND status NOT IN ('PENDING','CANCELLED')`, [d.order_id])).rows[0].n;
        const authBy = sent > 0 ? await this.supervisor.authorize('sales.order.cancel', d.branch_id, supervisor) : p.userId;
        if (!['CANCELLED', 'COMPLETED'].includes(o.status)) await this.sales.voidOrder(q, o, reason, authBy);
      }
      if (to === 'DELIVERED') {
        const o = await this.sales.lockOrder(q, d.order_id);
        if (!['DELIVERED', 'COMPLETED'].includes(o.status)) await this.sales.setStatus(q, o, 'DELIVERED', { force: true });
        await this.sales.maybeComplete(q, d.order_id);
      }
      await this.setDeliveryStatus(q, id, to);
      await this.audit.record(q, { action: `delivery.${to.toLowerCase()}`, entity: 'delivery_order', entityId: id, branchId: d.branch_id, oldValue: { status: d.status }, reason });
      return this.byId(q, id);
    });
  }
}
