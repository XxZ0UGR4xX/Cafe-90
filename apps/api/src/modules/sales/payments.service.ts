import { Injectable } from '@nestjs/common';
import { DbService } from '../../database/db.service';
import { AppError, forbidden } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { DomainEvents } from '../../common/domain-events';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.service';
import { SupervisorService, type SupervisorInput } from '../identity/supervisor.service';
import { SalesService } from './sales.service';

type Dict = Record<string, any>;
const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class PaymentsService {
  constructor(private readonly db: DbService, private readonly sales: SalesService, private readonly cash: CashService,
    private readonly audit: AuditService, private readonly events: DomainEvents, private readonly supervisor: SupervisorService) {}

  /**
   * Cobro (único, mixto o parcial). Todo en UNA transacción:
   * orden bloqueada → validación de montos → pagos append-only → caja → estado → eventos (lealtad, mesa).
   * Idempotente por `clientUuid` de cada pago.
   */
  async pay(orderId: string, d: { payments: Dict[] }) {
    return this.db.tx(async (q) => {
      const o = await this.sales.lockOrder(q, orderId);
      const p = ctx().principal!;
      if (!p.can('sales.order.pay', o.branch_id)) throw forbidden({ permission: 'sales.order.pay' });

      const uuids = d.payments.map((x) => x.clientUuid).filter(Boolean);
      if (uuids.length && (await q.query('SELECT 1 FROM payments WHERE client_uuid = ANY($1::uuid[])', [uuids])).rowCount)
        return { ...(await this.sales.get(orderId, q)), idempotent: true };

      if (o.status === 'CANCELLED') throw new AppError('ORDER_INVALID_TRANSITION', 409);
      if (o.payment_status === 'PAID') throw new AppError('ORDER_ALREADY_PAID', 409);
      if (o.total <= 0) throw new AppError('VALIDATION_ERROR', 400, { message: 'La cuenta no tiene importe por cobrar' });

      const shiftId = await this.cash.openShiftId(q, p.userId, o.branch_id);
      if (!shiftId) throw new AppError('SHIFT_NOT_OPEN', 409);

      // Productos pendientes se envían a cocina al cobrar (flujo mostrador / pago anticipado)
      const unsent = (await q.query(`SELECT 1 FROM order_items WHERE order_id=$1 AND status='PENDING'`, [orderId])).rowCount;
      if (unsent) await this.sales.sendToKitchen(orderId, q);

      const fresh = await this.sales.lockOrder(q, orderId);
      const remaining = r2(fresh.total - fresh.paid_total);
      const sum = r2(d.payments.reduce((a, x) => a + x.amount, 0));
      if (sum > remaining + 0.001) throw new AppError('PAYMENT_AMOUNT_MISMATCH', 409, { remaining, received: sum });

      const results: Dict[] = [];
      for (const x of d.payments) {
        if (x.method === 'CASH' && x.tendered !== undefined && x.tendered < x.amount) throw new AppError('PAYMENT_AMOUNT_MISMATCH', 409, { message: 'El efectivo recibido es menor al importe' });
        const pay = (await q.query(
          `INSERT INTO payments (tenant_id, branch_id, order_id, method, amount, tip, tendered, reference, cash_shift_id, client_uuid, received_by)
           VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [o.branch_id, orderId, x.method, x.amount, x.tip ?? 0, x.tendered ?? null, x.reference ?? null, shiftId, x.clientUuid ?? null, p.userId])).rows[0];
        await this.cash.recordSale(q, { shiftId, branchId: o.branch_id, orderId, paymentId: pay.id, method: x.method, amount: x.amount, tip: x.tip ?? 0 });
        results.push({ id: pay.id, method: x.method, amount: x.amount, change: x.method === 'CASH' && x.tendered ? r2(x.tendered - x.amount) : 0 });
      }
      const paid = r2(fresh.paid_total + sum);
      const full = r2(fresh.total - paid) <= 0.001;
      await q.query(`UPDATE orders SET paid_total=$2, payment_status=$3, closed_at = CASE WHEN $4 THEN COALESCE(closed_at, now()) ELSE closed_at END WHERE id=$1`,
        [orderId, paid, full ? 'PAID' : 'PARTIAL', full]);
      await this.sales.recalc(q, orderId);
      await this.audit.record(q, { action: 'order.pay', entity: 'order', entityId: orderId, branchId: o.branch_id, newValue: { payments: results, status: full ? 'PAID' : 'PARTIAL' } });
      if (full) {
        await this.events.emit(q, { type: 'OrderPaid', branchId: o.branch_id, payload: { orderId, number: o.number, customerId: o.customer_id, total: fresh.total, subtotal: fresh.subtotal, tip: 0 } });
        await this.sales.maybeComplete(q, orderId);
      }
      await this.events.emit(q, { type: 'PaymentReceived', branchId: o.branch_id, payload: { orderId, number: o.number, amount: sum, full } });
      return { ...(await this.sales.get(orderId, q)), change: results.reduce((a, r) => a + r.change, 0), receipts: results };
    });
  }

  /** Devolución total o parcial con contra-asientos (pago negativo, caja, inventario no preparado, puntos). */
  async refund(orderId: string, d: { amount?: number; method: string; reason: string; supervisor?: SupervisorInput }) {
    return this.db.tx(async (q) => {
      const o = await this.sales.lockOrder(q, orderId);
      await this.sales.assertNotInvoiced(q, orderId);
      const authBy = await this.supervisor.authorize('sales.order.refund', o.branch_id, d.supervisor);
      if (o.paid_total <= 0) throw new AppError('VALIDATION_ERROR', 400, { message: 'La cuenta no tiene pagos que devolver' });
      const amount = r2(d.amount ?? o.paid_total);
      if (amount <= 0 || amount > o.paid_total + 0.001) throw new AppError('PAYMENT_AMOUNT_MISMATCH', 409, { paid: o.paid_total, requested: amount });
      const p = ctx().principal!;
      const shiftId = await this.cash.openShiftId(q, p.userId, o.branch_id);
      if (!shiftId && d.method === 'CASH') throw new AppError('SHIFT_NOT_OPEN', 409);
      const pay = (await q.query(
        `INSERT INTO payments (tenant_id, branch_id, order_id, kind, method, amount, cash_shift_id, received_by, reason) VALUES (app_tenant_id(),$1,$2,'REFUND',$3,$4,$5,$6,$7) RETURNING id`,
        [o.branch_id, orderId, d.method, -amount, shiftId, p.userId, d.reason])).rows[0];
      if (shiftId) await this.cash.recordRefund(q, { shiftId, branchId: o.branch_id, orderId, paymentId: pay.id, method: d.method, amount, reason: d.reason, authorizedBy: authBy });
      const paid = r2(o.paid_total - amount);
      const full = paid <= 0.001;
      await q.query(`UPDATE orders SET paid_total=$2, payment_status=$3 WHERE id=$1`, [orderId, Math.max(paid, 0), full ? 'REFUNDED' : 'PARTIAL']);
      if (full) await this.sales.voidOrder(q, { ...o, paid_total: 0 }, d.reason, authBy, true);
      await this.audit.record(q, { action: 'order.refund', entity: 'order', entityId: orderId, branchId: o.branch_id, newValue: { amount, full, authorizedBy: authBy }, reason: d.reason });
      await this.events.emit(q, { type: 'OrderRefunded', branchId: o.branch_id, payload: { orderId, customerId: o.customer_id, amount, full, total: o.total } });
      return this.sales.get(orderId, q);
    });
  }
}
