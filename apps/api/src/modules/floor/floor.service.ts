import { Injectable } from '@nestjs/common';
import { DbService, Tx } from '../../database/db.service';
import { AppError, conflict, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { DomainEvents } from '../../common/domain-events';

type Dict = Record<string, any>;

@Injectable()
export class FloorService {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly events: DomainEvents) {}

  private assertBranch(perm: string, branchId: string) {
    if (!ctx().principal!.can(perm, branchId)) throw forbidden({ permission: perm, branchId });
  }

  /** Mapa de mesas con sesión, tiempo ocupada y total actual. */
  list(branchId: string) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT t.id, t.number, t.capacity, t.shape, t.x, t.y, t.w, t.h, t.is_active AS "isActive", t.status, t.qr_token AS "qrToken",
              ts.id AS "sessionId", ts.guests, ts.customer_name AS "customerName", ts.opened_at AS "openedAt", w.full_name AS "waiterName", ts.waiter_id AS "waiterId",
              EXTRACT(EPOCH FROM (now() - ts.opened_at))::int AS "occupiedSeconds",
              COALESCE((SELECT sum(o.total) FROM orders o WHERE o.table_session_id = ts.id AND o.status <> 'CANCELLED'), 0) AS "currentTotal",
              COALESCE((SELECT sum(o.paid_total) FROM orders o WHERE o.table_session_id = ts.id AND o.status <> 'CANCELLED'), 0) AS "paidTotal",
              (SELECT array_agg(table_id) FROM table_session_tables WHERE session_id = ts.id) AS "mergedTableIds"
         FROM tables t LEFT JOIN table_sessions ts ON ts.table_id = t.id AND ts.status = 'OPEN' LEFT JOIN users w ON w.id = ts.waiter_id
        WHERE t.branch_id = $1 ORDER BY t.number`, [branchId])).rows);
  }

  save(branchId: string, id: string | null, d: Dict) {
    this.assertBranch('floor.table.write', branchId);
    return this.db.tx(async (q) => {
      const r = id
        ? await q.query(`UPDATE tables SET number=$3,capacity=$4,shape=$5,x=$6,y=$7,w=$8,h=$9,is_active=$10 WHERE id=$1 AND branch_id=$2 RETURNING id, number`, [id, branchId, d.number, d.capacity, d.shape, d.x, d.y, d.w, d.h, d.isActive])
        : await q.query(`INSERT INTO tables (tenant_id, branch_id, number, capacity, shape, x, y, w, h, is_active) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, number`, [branchId, d.number, d.capacity, d.shape, d.x, d.y, d.w, d.h, d.isActive]);
      if (!r.rows[0]) throw notFound('table');
      await this.audit.record(q, { action: id ? 'table.update' : 'table.create', entity: 'table', entityId: r.rows[0].id, branchId, newValue: d });
      return r.rows[0];
    }).catch((e) => { if (e.code === '23505') throw conflict({ field: 'number' }, '⚠️ Ya existe una mesa con ese número.'); throw e; });
  }

  remove(branchId: string, id: string) {
    this.assertBranch('floor.table.write', branchId);
    return this.db.tx(async (q) => {
      if ((await q.query(`SELECT 1 FROM table_sessions WHERE table_id=$1 AND status='OPEN'`, [id])).rowCount) throw conflict(undefined, '⚠️ La mesa está ocupada.');
      const r = await q.query('UPDATE tables SET is_active=false WHERE id=$1 AND branch_id=$2', [id, branchId]);
      if (!r.rowCount) throw notFound('table');
      await this.audit.record(q, { action: 'table.deactivate', entity: 'table', entityId: id, branchId });
    });
  }

  private async tableRow(q: Tx, id: string, lock = true) {
    const t = (await q.query(`SELECT id, branch_id, number, status, is_active FROM tables WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
    if (!t) throw notFound('table');
    return t;
  }

  /** Abre una mesa (sesión de cuenta). */
  async open(tableId: string, d: Dict) {
    return this.db.tx(async (q) => {
      const t = await this.tableRow(q, tableId);
      this.assertBranch('floor.table.operate', t.branch_id);
      if (!t.is_active) throw new AppError('CONFLICT', 409);
      if (t.status === 'OCCUPIED' || (await q.query(`SELECT 1 FROM table_sessions WHERE table_id=$1 AND status='OPEN'`, [tableId])).rowCount)
        throw conflict(undefined, '⚠️ La mesa ya está abierta.');
      const s = (await q.query(
        `INSERT INTO table_sessions (tenant_id, branch_id, table_id, guests, waiter_id, customer_id, customer_name) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6) RETURNING id`,
        [t.branch_id, tableId, d.guests, ctx().principal!.userId, d.customerId ?? null, d.customerName ?? null])).rows[0];
      await q.query(`UPDATE tables SET status='OCCUPIED' WHERE id=$1`, [tableId]);
      await this.audit.record(q, { action: 'table.open', entity: 'table', entityId: tableId, branchId: t.branch_id, newValue: { sessionId: s.id } });
      await this.events.emit(q, { type: 'TableChanged', branchId: t.branch_id, payload: { tableId, status: 'OCCUPIED' } });
      return { sessionId: s.id, tableId };
    });
  }

  /** Mueve la cuenta a otra mesa libre. */
  async move(tableId: string, toTableId: string) {
    return this.db.tx(async (q) => {
      const [from, to] = [await this.tableRow(q, tableId), await this.tableRow(q, toTableId)];
      this.assertBranch('floor.table.operate', from.branch_id);
      if (from.branch_id !== to.branch_id) throw new AppError('VALIDATION_ERROR', 400, { field: 'toTableId' });
      if (to.status !== 'FREE' || !to.is_active) throw conflict(undefined, '⚠️ La mesa destino no está libre.');
      const s = (await q.query(`SELECT id FROM table_sessions WHERE table_id=$1 AND status='OPEN' FOR UPDATE`, [tableId])).rows[0];
      if (!s) throw notFound('session');
      await q.query('UPDATE table_sessions SET table_id=$2 WHERE id=$1', [s.id, toTableId]);
      await q.query('UPDATE orders SET table_id=$2 WHERE table_session_id=$1', [s.id, toTableId]);
      await q.query(`UPDATE tables SET status='OCCUPIED' WHERE id=$1`, [toTableId]);
      await q.query(`UPDATE tables SET status='CLEANING' WHERE id=$1`, [tableId]);
      await this.audit.record(q, { action: 'table.move', entity: 'table_session', entityId: s.id, branchId: from.branch_id, oldValue: { table: from.number }, newValue: { table: to.number } });
      await this.events.emit(q, { type: 'TableChanged', branchId: from.branch_id, payload: { tableId, toTableId } });
      return { sessionId: s.id, tableId: toTableId };
    });
  }

  /** Une mesas libres a la cuenta de una mesa abierta. */
  async merge(tableId: string, tableIds: string[]) {
    return this.db.tx(async (q) => {
      const base = await this.tableRow(q, tableId);
      this.assertBranch('floor.table.operate', base.branch_id);
      const s = (await q.query(`SELECT id FROM table_sessions WHERE table_id=$1 AND status='OPEN' FOR UPDATE`, [tableId])).rows[0];
      if (!s) throw notFound('session');
      for (const id of [...new Set(tableIds)].filter((x) => x !== tableId).sort()) {
        const t = await this.tableRow(q, id);
        if (t.branch_id !== base.branch_id || t.status !== 'FREE' || !t.is_active) throw conflict({ table: t.number }, `⚠️ La mesa ${t.number} no está libre.`);
        await q.query('INSERT INTO table_session_tables (tenant_id, session_id, table_id) VALUES (app_tenant_id(),$1,$2)', [s.id, id]);
        await q.query(`UPDATE tables SET status='OCCUPIED' WHERE id=$1`, [id]);
      }
      await this.audit.record(q, { action: 'table.merge', entity: 'table_session', entityId: s.id, branchId: base.branch_id, newValue: { tableIds } });
      await this.events.emit(q, { type: 'TableChanged', branchId: base.branch_id, payload: { tableId } });
      return { sessionId: s.id };
    });
  }

  /** Transfiere la mesa a otro mesero. */
  async transfer(tableId: string, waiterId: string) {
    return this.db.tx(async (q) => {
      const t = await this.tableRow(q, tableId);
      this.assertBranch('floor.table.operate', t.branch_id);
      const w = (await q.query(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
                                  WHERE u.id=$1 AND u.status='ACTIVE' AND (ur.branch_id IS NULL OR ur.branch_id=$2)`, [waiterId, t.branch_id])).rowCount;
      if (!w) throw new AppError('VALIDATION_ERROR', 400, { field: 'waiterId' });
      const s = (await q.query(`UPDATE table_sessions SET waiter_id=$2 WHERE table_id=$1 AND status='OPEN' RETURNING id`, [tableId, waiterId])).rows[0];
      if (!s) throw notFound('session');
      await q.query('UPDATE orders SET waiter_id=$2 WHERE table_session_id=$1', [s.id, waiterId]);
      await this.audit.record(q, { action: 'table.transfer', entity: 'table_session', entityId: s.id, branchId: t.branch_id, newValue: { waiterId } });
      return { sessionId: s.id, waiterId };
    });
  }

  /** Libera la mesa: sólo si no hay cuentas pendientes de pago. */
  async release(tableId: string) {
    return this.db.tx(async (q) => {
      const t = await this.tableRow(q, tableId);
      this.assertBranch('floor.table.operate', t.branch_id);
      const s = (await q.query(`SELECT id FROM table_sessions WHERE table_id=$1 AND status='OPEN' FOR UPDATE`, [tableId])).rows[0];
      if (!s) throw notFound('session');
      const pending = (await q.query(`SELECT count(*)::int n FROM orders WHERE table_session_id=$1 AND status NOT IN ('CANCELLED','COMPLETED') AND payment_status <> 'PAID'`, [s.id])).rows[0].n;
      if (pending) throw conflict({ pending }, '⚠️ La mesa tiene cuentas sin pagar.');
      await this.closeSession(q, s.id, t.branch_id);
      return { tableId, status: 'CLEANING' };
    });
  }

  /** Cierra una sesión y deja sus mesas en limpieza. Reutilizable por ventas al cobrar. */
  async closeSession(q: Tx, sessionId: string, branchId: string) {
    const tables = (await q.query(`SELECT table_id FROM table_sessions WHERE id=$1 UNION SELECT table_id FROM table_session_tables WHERE session_id=$1`, [sessionId])).rows.map((r) => r.table_id);
    await q.query(`UPDATE table_sessions SET status='CLOSED', closed_at=now() WHERE id=$1 AND status='OPEN'`, [sessionId]);
    await q.query(`UPDATE tables SET status='CLEANING' WHERE id = ANY($1::uuid[])`, [tables]);
    await this.events.emit(q, { type: 'TableChanged', branchId, payload: { tableIds: tables, status: 'CLEANING' } });
  }

  async clean(tableId: string) {
    return this.db.tx(async (q) => {
      const t = await this.tableRow(q, tableId);
      this.assertBranch('floor.table.operate', t.branch_id);
      if (t.status !== 'CLEANING') throw new AppError('CONFLICT', 409);
      await q.query(`UPDATE tables SET status='FREE' WHERE id=$1`, [tableId]);
      await this.events.emit(q, { type: 'TableChanged', branchId: t.branch_id, payload: { tableId, status: 'FREE' } });
      return { tableId, status: 'FREE' };
    });
  }
}
