import { Injectable } from '@nestjs/common';
import { DbService, Tx } from '../../database/db.service';
import { AppError, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { DomainEvents } from '../../common/domain-events';
import { AuditService } from '../audit/audit.service';
import { SupervisorService } from '../identity/supervisor.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../tenancy/settings.service';

type Dict = Record<string, any>;
const r2 = (n: number) => Math.round(n * 100) / 100;
const DEFAULT_TOLERANCE = 50;
const DEFAULT_EXPENSE_LIMIT = 500;

@Injectable()
export class CashService {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly supervisor: SupervisorService,
    private readonly notifications: NotificationsService, private readonly settings: SettingsService, private readonly events: DomainEvents) {}

  private assertBranch(perm: string, branchId: string) {
    if (!ctx().principal!.can(perm, branchId)) throw forbidden({ permission: perm, branchId });
  }

  // ───────── Cajas ─────────
  listRegisters(branchId: string) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT r.id, r.name, r.is_active AS "isActive", s.id AS "openShiftId" FROM cash_registers r
         LEFT JOIN cash_shifts s ON s.register_id = r.id AND s.status = 'OPEN' WHERE r.branch_id = $1 ORDER BY r.name`, [branchId])).rows);
  }
  createRegister(d: { branchId: string; name: string }) {
    this.assertBranch('cash.shift.approve', d.branchId);
    return this.db.tx(async (q) => {
      const r = (await q.query(`INSERT INTO cash_registers (tenant_id, branch_id, name) VALUES (app_tenant_id(),$1,$2) RETURNING id, name`, [d.branchId, d.name])).rows[0];
      await this.audit.record(q, { action: 'cash_register.create', entity: 'cash_register', entityId: r.id, branchId: d.branchId, newValue: r });
      return r;
    }).catch((e) => { if (e.code === '23505') throw new AppError('CONFLICT', 409); throw e; });
  }

  // ───────── Turnos ─────────
  async open(d: Dict) {
    this.assertBranch('cash.shift.operate', d.branchId);
    const uid = ctx().principal!.userId;
    return this.db.tx(async (q) => {
      if ((await q.query(`SELECT 1 FROM cash_shifts WHERE user_id=$1 AND status='OPEN'`, [uid])).rowCount) throw new AppError('SHIFT_ALREADY_OPEN', 409);
      let registerId = d.registerId as string | undefined;
      if (!registerId) {
        registerId = (await q.query(`INSERT INTO cash_registers (tenant_id, branch_id, name) VALUES (app_tenant_id(),$1,'Caja 1')
                       ON CONFLICT (branch_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [d.branchId])).rows[0].id;
      } else if (!(await q.query('SELECT 1 FROM cash_registers WHERE id=$1 AND branch_id=$2 AND is_active', [registerId, d.branchId])).rowCount) throw notFound('register');
      const busy = (await q.query(`SELECT u.full_name FROM cash_shifts s JOIN users u ON u.id = s.user_id WHERE s.register_id=$1 AND s.status='OPEN'`, [registerId])).rows[0];
      if (busy) throw new AppError('REGISTER_IN_USE', 409, { by: busy.full_name }, false, `💰 Esta caja ya está abierta por ${busy.full_name}. Pídele que haga el corte o abre otra caja.`);
      const shift = (await q.query(
        `INSERT INTO cash_shifts (tenant_id, branch_id, register_id, user_id, opening_float) VALUES (app_tenant_id(),$1,$2,$3,$4) RETURNING id`,
        [d.branchId, registerId, uid, d.openingFloat]).catch((e) => { if (e.code === '23505') throw new AppError('SHIFT_ALREADY_OPEN', 409); throw e; })).rows[0];
      await q.query(`INSERT INTO cash_movements (tenant_id, branch_id, shift_id, type, method, amount, user_id, reason) VALUES (app_tenant_id(),$1,$2,'OPENING','CASH',$3,$4,$5)`,
        [d.branchId, shift.id, d.openingFloat, uid, d.denominations ? JSON.stringify(d.denominations) : null]);
      await this.audit.record(q, { action: 'cash_shift.open', entity: 'cash_shift', entityId: shift.id, branchId: d.branchId, newValue: { openingFloat: d.openingFloat } });
      return this.shiftById(q, shift.id);
    });
  }

  /** Turno abierto del usuario actual (el esperado se oculta al cajero: conteo ciego). */
  async current(branchId?: string) {
    const uid = ctx().principal!.userId;
    return this.db.tx(async (q) => {
      const s = (await q.query(`SELECT id FROM cash_shifts WHERE user_id=$1 AND status='OPEN' AND ($2::uuid IS NULL OR branch_id=$2)`, [uid, branchId ?? null])).rows[0];
      return s ? this.shiftById(q, s.id) : null;
    });
  }

  /** Id del turno abierto del usuario (usado al cobrar). */
  async openShiftId(q: Tx, userId: string, branchId: string): Promise<string | null> {
    return (await q.query(`SELECT id FROM cash_shifts WHERE user_id=$1 AND branch_id=$2 AND status='OPEN'`, [userId, branchId])).rows[0]?.id ?? null;
  }

  /** Registra en caja un pago de venta (y su propina). */
  async recordSale(q: Tx, p: { shiftId: string; branchId: string; orderId: string; paymentId: string; method: string; amount: number; tip: number }) {
    const uid = ctx().principal!.userId;
    await q.query(`INSERT INTO cash_movements (tenant_id, branch_id, shift_id, type, method, amount, order_id, payment_id, user_id) VALUES (app_tenant_id(),$1,$2,'SALE',$3,$4,$5,$6,$7)`,
      [p.branchId, p.shiftId, p.method, p.amount, p.orderId, p.paymentId, uid]);
    if (p.tip > 0) await q.query(`INSERT INTO cash_movements (tenant_id, branch_id, shift_id, type, method, amount, order_id, payment_id, user_id) VALUES (app_tenant_id(),$1,$2,'TIP',$3,$4,$5,$6,$7)`,
      [p.branchId, p.shiftId, p.method, p.tip, p.orderId, p.paymentId, uid]);
  }

  async recordRefund(q: Tx, p: { shiftId: string; branchId: string; orderId: string; paymentId: string; method: string; amount: number; reason: string; authorizedBy: string }) {
    await q.query(`INSERT INTO cash_movements (tenant_id, branch_id, shift_id, type, method, amount, order_id, payment_id, user_id, reason, authorized_by) VALUES (app_tenant_id(),$1,$2,'REFUND',$3,$4,$5,$6,$7,$8,$9)`,
      [p.branchId, p.shiftId, p.method, -Math.abs(p.amount), p.orderId, p.paymentId, ctx().principal!.userId, p.reason, p.authorizedBy]);
  }

  async movement(d: Dict) {
    return this.db.tx(async (q) => {
      const uid = ctx().principal!.userId;
      const shift = d.shiftId
        ? (await q.query('SELECT id, branch_id, user_id, status FROM cash_shifts WHERE id=$1 FOR UPDATE', [d.shiftId])).rows[0]
        : (await q.query(`SELECT id, branch_id, user_id, status FROM cash_shifts WHERE user_id=$1 AND status='OPEN' FOR UPDATE`, [uid])).rows[0];
      if (!shift) throw new AppError('SHIFT_NOT_OPEN', 409);
      if (shift.status !== 'OPEN') throw new AppError('CONFLICT', 409);
      this.assertBranch('cash.movement.write', shift.branch_id);
      if (shift.user_id !== uid && !ctx().principal!.can('cash.shift.approve', shift.branch_id)) throw forbidden({ reason: 'turno ajeno' });
      const limit = Number(await this.settings.get('cash.expenseLimit', shift.branch_id, DEFAULT_EXPENSE_LIMIT));
      let authorizedBy: string | null = null;
      if (d.type === 'WITHDRAWAL' || (d.type === 'EXPENSE' && d.amount > limit) || d.type === 'DEPOSIT' && d.amount > limit * 10)
        authorizedBy = await this.supervisor.authorize('cash.shift.approve', shift.branch_id, d.supervisor);
      const expected = await this.expectedCash(q, shift.id);
      if (d.type !== 'DEPOSIT' && d.amount > expected) throw new AppError('VALIDATION_ERROR', 400, { field: 'amount', message: 'El monto excede el efectivo en caja' });
      const signed = d.type === 'DEPOSIT' ? d.amount : -d.amount;
      const row = (await q.query(`INSERT INTO cash_movements (tenant_id, branch_id, shift_id, type, method, amount, reason, authorized_by, user_id) VALUES (app_tenant_id(),$1,$2,$3,'CASH',$4,$5,$6,$7) RETURNING id, type, amount, at`,
        [shift.branch_id, shift.id, d.type, signed, d.reason, authorizedBy, uid])).rows[0];
      await this.audit.record(q, { action: `cash.${String(d.type).toLowerCase()}`, entity: 'cash_shift', entityId: shift.id, branchId: shift.branch_id, newValue: { amount: signed }, reason: d.reason });
      return row;
    });
  }

  private async expectedCash(q: Tx, shiftId: string): Promise<number> {
    return r2((await q.query(`SELECT COALESCE(sum(amount),0) AS v FROM cash_movements WHERE shift_id=$1 AND method='CASH'`, [shiftId])).rows[0].v);
  }

  /** Resumen del turno (ventas por método, propinas, gastos, retiros...). */
  private async summarize(q: Tx, shiftId: string) {
    const mv = (await q.query(`SELECT type, method, COALESCE(sum(amount),0) AS amount, count(*)::int AS n FROM cash_movements WHERE shift_id=$1 GROUP BY type, method`, [shiftId])).rows;
    const sum = (type: string, method?: string) => r2(mv.filter((m) => m.type === type && (!method || m.method === method)).reduce((a, m) => a + m.amount, 0));
    const salesByMethod = { CASH: sum('SALE', 'CASH'), CARD: sum('SALE', 'CARD'), TRANSFER: sum('SALE', 'TRANSFER'), QR: sum('SALE', 'QR') };
    const tipsByMethod = { CASH: sum('TIP', 'CASH'), CARD: sum('TIP', 'CARD'), TRANSFER: sum('TIP', 'TRANSFER'), QR: sum('TIP', 'QR') };
    const o = (await q.query(
      `SELECT COALESCE(sum(o.discount_total),0) AS discounts, count(DISTINCT o.id)::int AS orders
         FROM orders o WHERE o.id IN (SELECT order_id FROM cash_movements WHERE shift_id=$1 AND type='SALE')`, [shiftId])).rows[0];
    const s = (await q.query('SELECT branch_id, user_id, opened_at, closed_at FROM cash_shifts WHERE id=$1', [shiftId])).rows[0];
    const cancels = (await q.query(
      `SELECT count(*)::int AS n, COALESCE(sum(total),0) AS amount FROM orders WHERE branch_id=$1 AND status='CANCELLED' AND cancelled_by=$2 AND cancelled_at >= $3 AND ($4::timestamptz IS NULL OR cancelled_at <= $4)`,
      [s.branch_id, s.user_id, s.opened_at, s.closed_at])).rows[0];
    return {
      openingFloat: sum('OPENING'), salesByMethod, salesTotal: r2(Object.values(salesByMethod).reduce((a, b) => a + b, 0)),
      tipsByMethod, tipsTotal: r2(Object.values(tipsByMethod).reduce((a, b) => a + b, 0)),
      refunds: -sum('REFUND'), expenses: -sum('EXPENSE'), withdrawals: -sum('WITHDRAWAL'), deposits: sum('DEPOSIT'),
      discounts: r2(o.discounts), orders: o.orders, cancellations: cancels.n, cancelledAmount: r2(cancels.amount),
      expectedCash: await this.expectedCash(q, shiftId),
    };
  }

  private async shiftById(q: Tx, id: string) {
    const s = (await q.query(
      `SELECT s.id, s.branch_id AS "branchId", s.register_id AS "registerId", r.name AS register, s.user_id AS "userId", u.full_name AS "userName",
              s.status, s.opened_at AS "openedAt", s.opening_float AS "openingFloat", s.closed_at AS "closedAt", s.expected_cash AS "expectedCash",
              s.counted_cash AS "countedCash", s.difference, s.close_notes AS "closeNotes", s.report
         FROM cash_shifts s JOIN cash_registers r ON r.id = s.register_id JOIN users u ON u.id = s.user_id WHERE s.id=$1`, [id])).rows[0];
    if (!s) throw notFound('shift');
    if (s.status === 'OPEN') {
      const sum = await this.summarize(q, id);
      const reveal = ctx().principal!.can('cash.shift.readAll', s.branchId);
      s.summary = reveal ? sum : { ...sum, expectedCash: undefined };   // conteo ciego para el cajero
    }
    return s;
  }

  async get(id: string) {
    return this.db.tx(async (q) => {
      const s = await this.shiftById(q, id);
      const p = ctx().principal!;
      if (s.userId !== p.userId && !p.can('cash.shift.readAll', s.branchId)) throw forbidden();
      return s;
    });
  }

  list(branchId: string, limit: number) {
    this.assertBranch('cash.shift.readAll', branchId);
    return this.db.tx(async (q) => (await q.query(
      `SELECT s.id, r.name AS register, u.full_name AS "userName", s.status, s.opened_at AS "openedAt", s.closed_at AS "closedAt",
              s.opening_float AS "openingFloat", s.expected_cash AS "expectedCash", s.counted_cash AS "countedCash", s.difference
         FROM cash_shifts s JOIN cash_registers r ON r.id = s.register_id JOIN users u ON u.id = s.user_id
        WHERE s.branch_id = $1 ORDER BY s.opened_at DESC LIMIT $2`, [branchId, limit])).rows);
  }

  /** Corte de caja con conteo ciego. Congela el turno y genera el reporte. */
  async close(id: string, d: Dict) {
    return this.db.tx(async (q) => {
      const s = (await q.query(`SELECT id, branch_id, user_id, status FROM cash_shifts WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!s) throw notFound('shift');
      const p = ctx().principal!;
      if (s.status !== 'OPEN') throw new AppError('CONFLICT', 409, undefined, false, '⚠️ Este turno ya fue cerrado.');
      if (s.user_id !== p.userId && !p.can('cash.shift.approve', s.branch_id)) throw forbidden({ reason: 'turno ajeno' });
      const summary = await this.summarize(q, id);
      const difference = r2(d.countedCash - summary.expectedCash);
      const tolerance = Number(await this.settings.get('cash.tolerance', s.branch_id, DEFAULT_TOLERANCE));
      let approvedBy: string | null = null;
      if (Math.abs(difference) > tolerance) {
        if (!d.notes) throw new AppError('VALIDATION_ERROR', 400, { field: 'notes', message: 'La diferencia excede la tolerancia: agrega un comentario' });
        approvedBy = await this.supervisor.authorize('cash.shift.approve', s.branch_id, d.supervisor);
      }
      const openOrders = (await q.query(
        `SELECT count(*)::int AS n FROM orders WHERE branch_id=$1 AND created_by=$2 AND payment_status IN ('PENDING','PARTIAL') AND status NOT IN ('CANCELLED','COMPLETED','DRAFT')`, [s.branch_id, s.user_id])).rows[0].n;
      const report = { ...summary, countedCash: d.countedCash, difference, denominations: d.denominations ?? null, openOrdersAtClose: openOrders,
        closedByName: p.fullName, closedAt: new Date().toISOString() };
      await q.query(`UPDATE cash_shifts SET status='CLOSED', closed_at=now(), expected_cash=$2, counted_cash=$3, difference=$4, close_notes=$5, closed_by=$6, approved_by=$7, report=$8 WHERE id=$1`,
        [id, summary.expectedCash, d.countedCash, difference, d.notes ?? null, p.userId, approvedBy, JSON.stringify(report)]);
      await this.audit.record(q, { action: 'cash_shift.close', entity: 'cash_shift', entityId: id, branchId: s.branch_id, newValue: { expected: summary.expectedCash, counted: d.countedCash, difference }, reason: d.notes });
      if (Math.abs(difference) > tolerance)
        await this.notifications.emit(q, { type: 'CASH_DIFFERENCE', severity: 'WARNING', branchId: s.branch_id, title: `💰 Corte con diferencia de ${difference}`, body: p.fullName, dedupeKey: `shift:${id}` });
      const closed = await this.shiftById(q, id);
      const br = (await q.query('SELECT name FROM branches WHERE id=$1', [s.branch_id])).rows[0];
      await this.events.emit(q, { type: 'CashShiftClosed', branchId: s.branch_id, payload: { shiftId: id, report: { ...report, branchName: br.name, userName: closed.userName, openedAt: closed.openedAt, closedAt: closed.closedAt } } });
      return closed;
    });
  }
}
