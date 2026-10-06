import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { OrderCreateDto, AddItemsDto, CancelDto, PayDto } from '@retroburger/shared';
import { DbService } from '../../database/db.service';
import { AppError, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from '../catalog/catalog.service';
import { CashService } from '../cash/cash.service';
import { FloorService } from '../floor/floor.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PaymentsService } from '../sales/payments.service';
import { SalesService } from '../sales/sales.service';

type Dict = Record<string, any>;
const uuid = z.string().uuid();
const SCHEMAS = {
  ORDER_CREATE: OrderCreateDto.extend({ clientUuid: uuid }),
  ORDER_ADD_ITEMS: AddItemsDto.extend({ orderClientUuid: uuid }),
  ORDER_PAY: PayDto.extend({ orderClientUuid: uuid }),
  ORDER_CANCEL: CancelDto.extend({ orderClientUuid: uuid }),
} as const;

/**
 * Sincronización de operaciones capturadas offline.
 * Principios: (1) idempotencia por opId, (2) una venta ya consumada NUNCA se descarta: si no puede aplicarse
 * queda en la bandeja de excepciones (NEEDS_REVIEW) con su payload íntegro, (3) orden de aplicación = orden de captura.
 */
@Injectable()
export class SyncService {
  constructor(private readonly db: DbService, private readonly sales: SalesService, private readonly payments: PaymentsService, private readonly audit: AuditService,
    private readonly catalog: CatalogService, private readonly floor: FloorService, private readonly promos: PromotionsService, private readonly cash: CashService) {}

  private async orderIdByClientUuid(cu: string): Promise<string> {
    const r = await this.db.tx(async (q) => (await q.query('SELECT id FROM orders WHERE client_uuid=$1', [cu])).rows[0]);
    if (!r) throw notFound('order');
    return r.id;
  }

  private async apply(type: keyof typeof SCHEMAS, payload: Dict) {
    const schema = SCHEMAS[type];
    const p = schema.parse(payload) as Dict;
    switch (type) {
      case 'ORDER_CREATE': { const o = await this.sales.create({ ...p, offline: true }); return { orderId: o.id, number: o.number }; }
      case 'ORDER_ADD_ITEMS': { const o = await this.sales.addItems(await this.orderIdByClientUuid(p.orderClientUuid), { items: p.items, send: p.send, offline: true }); return { orderId: o.id }; }
      case 'ORDER_PAY': { const o = await this.payments.pay(await this.orderIdByClientUuid(p.orderClientUuid), { payments: p.payments }); return { orderId: o.id, paymentStatus: o.paymentStatus }; }
      case 'ORDER_CANCEL': { const o = await this.sales.cancel(await this.orderIdByClientUuid(p.orderClientUuid), { reason: p.reason, supervisor: p.supervisor }); return { orderId: o.id }; }
    }
  }

  async push(d: { deviceId: string; branchId: string; operations: { opId: string; type: keyof typeof SCHEMAS; createdAt: string; payload: Dict }[] }) {
    if (!ctx().principal!.can('sales.order.create', d.branchId)) throw forbidden();
    const ops = [...d.operations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const results: Dict[] = [];
    for (const op of ops) {
      const prior = await this.db.tx(async (q) => (await q.query('SELECT status, result, error FROM sync_operations WHERE op_id=$1', [op.opId])).rows[0]);
      if (prior && prior.status !== 'NEEDS_REVIEW' && prior.status !== 'FAILED') { results.push({ opId: op.opId, status: 'DUPLICATE', result: prior.result }); continue; }
      if (prior) { results.push({ opId: op.opId, status: prior.status, error: prior.error }); continue; }   // ya en bandeja: no se reintenta solo
      try {
        const result = await this.db.tx(async (q) => {
          const r = await this.apply(op.type, op.payload);
          await q.query(`INSERT INTO sync_operations (tenant_id, branch_id, device_id, op_id, type, payload, status, result, client_created_at, user_id) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,'APPLIED',$6,$7,$8)`,
            [d.branchId, d.deviceId, op.opId, op.type, JSON.stringify(op.payload), JSON.stringify(r), op.createdAt, ctx().principal!.userId]);
          return r;
        });
        results.push({ opId: op.opId, status: 'APPLIED', result });
      } catch (e) {
        const malformed = e instanceof z.ZodError;
        const msg = e instanceof AppError ? `${e.code}: ${JSON.stringify(e.details ?? e.message)}` : (e as Error).message;
        await this.db.independent(async (q) => {
          await q.query(`INSERT INTO sync_operations (tenant_id, branch_id, device_id, op_id, type, payload, status, error, client_created_at, user_id) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id, op_id) DO NOTHING`,
            [d.branchId, d.deviceId, op.opId, op.type, JSON.stringify(op.payload), malformed ? 'FAILED' : 'NEEDS_REVIEW', msg.slice(0, 1000), op.createdAt, ctx().principal!.userId]);
        });
        results.push({ opId: op.opId, status: malformed ? 'FAILED' : 'NEEDS_REVIEW', error: msg });
      }
    }
    return { results, applied: results.filter((r) => r.status === 'APPLIED').length, needsReview: results.filter((r) => r.status === 'NEEDS_REVIEW').length };
  }

  /** Snapshot para caché offline del POS (menú, mesas, promociones vigentes, turno). */
  async pull(branchId: string) {
    if (!ctx().principal!.can('catalog.product.read', branchId)) throw forbidden();
    const [menu, tables, promotions, shift] = await Promise.all([
      this.catalog.menu(branchId), this.floor.list(branchId), this.promos.listActive(branchId), this.cash.current(branchId).catch(() => null),
    ]);
    return { serverTime: new Date().toISOString(), branchId, menu, tables, promotions, shift: shift ? { id: shift.id, openedAt: shift.openedAt } : null };
  }

  exceptions(branchId: string) {
    if (!ctx().principal!.can('sales.order.readAll', branchId)) throw forbidden();
    return this.db.tx(async (q) => (await q.query(
      `SELECT id, device_id AS "deviceId", op_id AS "opId", type, status, error, payload, client_created_at AS "clientCreatedAt", received_at AS "receivedAt"
         FROM sync_operations WHERE branch_id=$1 AND status IN ('NEEDS_REVIEW','FAILED') ORDER BY received_at DESC LIMIT 200`, [branchId])).rows);
  }

  async retry(id: string) {
    const op = await this.db.tx(async (q) => (await q.query('SELECT * FROM sync_operations WHERE id=$1', [id])).rows[0]);
    if (!op) throw notFound('sync_operation');
    if (!ctx().principal!.can('sales.order.readAll', op.branch_id)) throw forbidden();
    try {
      const result = await this.db.tx(async (q) => {
        const r = await this.apply(op.type, op.payload);
        await q.query(`UPDATE sync_operations SET status='APPLIED', result=$2, error=NULL WHERE id=$1`, [id, JSON.stringify(r)]);
        await this.audit.record(q, { action: 'sync.retry_applied', entity: 'sync_operation', entityId: id, branchId: op.branch_id });
        return r;
      });
      return { status: 'APPLIED', result };
    } catch (e) {
      const msg = e instanceof AppError ? `${e.code}: ${JSON.stringify(e.details ?? e.message)}` : (e as Error).message;
      await this.db.independent(async (q) => { await q.query('UPDATE sync_operations SET error=$2 WHERE id=$1', [id, msg.slice(0, 1000)]); });
      return { status: 'NEEDS_REVIEW', error: msg };
    }
  }

  resolve(id: string, note: string) {
    return this.db.tx(async (q) => {
      const op = (await q.query('SELECT branch_id FROM sync_operations WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!op) throw notFound('sync_operation');
      if (!ctx().principal!.can('sales.order.readAll', op.branch_id)) throw forbidden();
      await q.query(`UPDATE sync_operations SET status='RESOLVED', error = COALESCE(error,'') || ' | resuelto: ' || $2 WHERE id=$1`, [id, note]);
      await this.audit.record(q, { action: 'sync.resolved', entity: 'sync_operation', entityId: id, branchId: op.branch_id, reason: note });
      return { id, status: 'RESOLVED' };
    });
  }
}
