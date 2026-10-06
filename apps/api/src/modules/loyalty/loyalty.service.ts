import { Injectable } from '@nestjs/common';
import { DbService, Tx } from '../../database/db.service';
import { AppError, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { PromotionsService } from '../promotions/promotions.service';
import { SalesService } from '../sales/sales.service';

type Dict = Record<string, any>;
const DEFAULT_LEVELS = [{ name: 'BRONCE', min: 0 }, { name: 'PLATA', min: 500 }, { name: 'ORO', min: 1500 }];

@Injectable()
export class LoyaltyService {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly promos: PromotionsService, private readonly sales: SalesService) {}

  async program(q?: Tx) {
    const run = async (t: Tx) => (await t.query(`SELECT is_active AS "isActive", currency_per_point AS "currencyPerPoint", levels, expiry_days AS "expiryDays" FROM loyalty_programs`)).rows[0]
      ?? { isActive: true, currencyPerPoint: 10, levels: DEFAULT_LEVELS, expiryDays: null };
    return q ? run(q) : this.db.tx(run);
  }

  saveProgram(d: Dict) {
    return this.db.tx(async (q) => {
      await q.query(`INSERT INTO loyalty_programs (tenant_id, is_active, currency_per_point, levels, expiry_days) VALUES (app_tenant_id(),$1,$2,$3,$4)
        ON CONFLICT (tenant_id) DO UPDATE SET is_active=$1, currency_per_point=$2, levels=$3, expiry_days=$4, updated_at=now()`,
        [d.isActive, d.currencyPerPoint, JSON.stringify(d.levels), d.expiryDays ?? null]);
      await this.audit.record(q, { action: 'loyalty.program', entity: 'loyalty_program', newValue: d });
      return this.program(q);
    });
  }

  rewards() { return this.db.tx(async (q) => (await q.query(`SELECT r.id, r.name, r.points_cost AS "pointsCost", r.product_id AS "productId", p.name AS product, r.is_active AS "isActive" FROM loyalty_rewards r LEFT JOIN products p ON p.id = r.product_id ORDER BY r.points_cost`)).rows); }
  saveReward(id: string | null, d: Dict) {
    return this.db.tx(async (q) => {
      const r = id
        ? await q.query(`UPDATE loyalty_rewards SET name=$2, points_cost=$3, product_id=$4, is_active=$5 WHERE id=$1 RETURNING id`, [id, d.name, d.pointsCost, d.productId ?? null, d.isActive])
        : await q.query(`INSERT INTO loyalty_rewards (tenant_id, name, points_cost, product_id, is_active) VALUES (app_tenant_id(),$1,$2,$3,$4) RETURNING id`, [d.name, d.pointsCost, d.productId ?? null, d.isActive]);
      if (!r.rows[0]) throw notFound('reward');
      await this.audit.record(q, { action: id ? 'loyalty.reward_update' : 'loyalty.reward_create', entity: 'loyalty_reward', entityId: r.rows[0].id, newValue: d });
      return { id: r.rows[0].id, ...d };
    });
  }

  private levelFor(levels: { name: string; min: number }[], lifetime: number) {
    return [...levels].sort((a, b) => a.min - b.min).filter((l) => l.min <= lifetime).pop()?.name ?? levels[0]?.name ?? 'BRONCE';
  }

  private async account(q: Tx, customerId: string) {
    await q.query(`INSERT INTO loyalty_accounts (tenant_id, customer_id) VALUES (app_tenant_id(),$1) ON CONFLICT (customer_id) DO NOTHING`, [customerId]);
    return (await q.query('SELECT id, balance, lifetime_points, level FROM loyalty_accounts WHERE customer_id=$1 FOR UPDATE', [customerId])).rows[0];
  }

  /** Mueve puntos dentro de la transacción del llamador y deja constancia en el libro (append-only). */
  async move(q: Tx, customerId: string, type: 'EARN' | 'REDEEM' | 'ADJUST' | 'REVERSAL', points: number, o: { orderId?: string; rewardId?: string; reason?: string } = {}) {
    const a = await this.account(q, customerId);
    const prog = await this.program(q);
    let applied = points;
    if (a.balance + applied < 0) { if (type === 'REDEEM') throw new AppError('VALIDATION_ERROR', 400, { balance: a.balance }, false, '⭐ Puntos insuficientes.'); applied = -a.balance; }
    if (applied === 0) return a.balance;
    const balance = a.balance + applied;
    const lifetime = a.lifetime_points + (applied > 0 && type !== 'REVERSAL' ? applied : 0);
    await q.query(`INSERT INTO loyalty_transactions (tenant_id, account_id, type, points, balance_after, order_id, reward_id, reason, user_id) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8)`,
      [a.id, type, applied, balance, o.orderId ?? null, o.rewardId ?? null, o.reason ?? null, ctx().principal?.userId ?? null]);
    await q.query(`UPDATE loyalty_accounts SET balance=$2, lifetime_points=$3, level=$4, updated_at=now() WHERE id=$1`, [a.id, balance, lifetime, this.levelFor(prog.levels, lifetime)]);
    return balance;
  }

  async accountView(customerId: string) {
    return this.db.tx(async (q) => {
      if (!(await q.query('SELECT 1 FROM customers WHERE id=$1 AND deleted_at IS NULL', [customerId])).rowCount) throw notFound('customer');
      await this.account(q, customerId);
      const acc = (await q.query(`SELECT balance, lifetime_points AS "lifetimePoints", level FROM loyalty_accounts WHERE customer_id=$1`, [customerId])).rows[0];
      const tx = (await q.query(`SELECT t.type, t.points, t.balance_after AS "balanceAfter", t.reason, t.at, o.number AS "orderNumber" FROM loyalty_transactions t JOIN loyalty_accounts a ON a.id = t.account_id
                                  LEFT JOIN orders o ON o.id = t.order_id WHERE a.customer_id=$1 ORDER BY t.at DESC LIMIT 50`, [customerId])).rows;
      return { ...acc, transactions: tx, rewards: await this.rewards() };
    });
  }

  adjust(d: { customerId: string; points: number; reason: string }) {
    return this.db.tx(async (q) => {
      const bal = await this.move(q, d.customerId, 'ADJUST', d.points, { reason: d.reason });
      await this.audit.record(q, { action: 'loyalty.adjust', entity: 'customer', entityId: d.customerId, newValue: { points: d.points, balance: bal }, reason: d.reason });
      return { balance: bal };
    });
  }

  /** Canjea una recompensa aplicándola como descuento (producto gratis) en una orden abierta. */
  redeem(d: { customerId: string; rewardId: string; orderId: string }) {
    return this.db.tx(async (q) => {
      const reward = (await q.query('SELECT id, name, points_cost, product_id FROM loyalty_rewards WHERE id=$1 AND is_active', [d.rewardId])).rows[0];
      if (!reward) throw notFound('reward');
      const o = (await q.query(`SELECT id, branch_id, payment_status, status, customer_id FROM orders WHERE id=$1 FOR UPDATE`, [d.orderId])).rows[0];
      if (!o) throw notFound('order');
      if (o.payment_status === 'PAID' || ['CANCELLED', 'COMPLETED'].includes(o.status)) throw new AppError('ORDER_INVALID_TRANSITION', 409);
      if (!ctx().principal!.can('loyalty.redeem', o.branch_id)) throw new AppError('FORBIDDEN', 403);
      const line = (await q.query(`SELECT unit_price FROM order_items WHERE order_id=$1 AND status <> 'CANCELLED' AND parent_item_id IS NULL AND ($2::uuid IS NULL OR product_id = $2) ORDER BY unit_price DESC LIMIT 1`, [d.orderId, reward.product_id])).rows[0];
      if (!line) throw new AppError('VALIDATION_ERROR', 400, { message: 'La orden no incluye el producto de la recompensa' });
      await this.move(q, d.customerId, 'REDEEM', -reward.points_cost, { orderId: d.orderId, rewardId: d.rewardId, reason: reward.name });
      await q.query(`UPDATE orders SET customer_id = COALESCE(customer_id, $2) WHERE id=$1`, [d.orderId, d.customerId]);
      await q.query(`INSERT INTO order_discounts (tenant_id, order_id, kind, value, amount, reason, created_by) VALUES (app_tenant_id(),$1,'POINTS',$2,$3,$4,$5)`,
        [d.orderId, reward.points_cost, line.unit_price, `Canje: ${reward.name}`, ctx().principal!.userId]);
      await this.sales.recalc(q, d.orderId);
      await this.audit.record(q, { action: 'loyalty.redeem', entity: 'order', entityId: d.orderId, branchId: o.branch_id, newValue: { reward: reward.name, points: reward.points_cost } });
      return { orderId: d.orderId, discount: line.unit_price, points: reward.points_cost };
    });
  }

  /** Acumulación al cobrar (handler de evento, misma transacción que el pago). */
  async earnForOrder(q: Tx, p: { orderId: string; customerId: string | null; total: number; branchId: string }) {
    if (!p.customerId) return;
    const prog = await this.program(q);
    if (!prog.isActive) return;
    const mult = await this.promos.pointsMultiplier(q, p.branchId);
    const points = Math.floor(p.total / prog.currencyPerPoint) * mult;
    if (points <= 0) return;
    if ((await q.query(`SELECT 1 FROM loyalty_transactions WHERE order_id=$1 AND type='EARN'`, [p.orderId])).rowCount) return;
    await this.move(q, p.customerId, 'EARN', points, { orderId: p.orderId, reason: mult > 1 ? `Puntos x${mult}` : undefined });
    await q.query('UPDATE orders SET points_earned=$2 WHERE id=$1', [p.orderId, points]);
  }

  /** Devolución total: revierte los puntos ganados y restituye los canjeados. */
  async reverseForOrder(q: Tx, p: { orderId: string; customerId: string | null }) {
    if (!p.customerId) return;
    const tx = (await q.query(`SELECT type, points FROM loyalty_transactions WHERE order_id=$1 AND type IN ('EARN','REDEEM')`, [p.orderId])).rows;
    const earned = tx.filter((t) => t.type === 'EARN').reduce((a, t) => a + t.points, 0);
    const redeemed = tx.filter((t) => t.type === 'REDEEM').reduce((a, t) => a + t.points, 0);
    if ((await q.query(`SELECT 1 FROM loyalty_transactions WHERE order_id=$1 AND type='REVERSAL'`, [p.orderId])).rowCount) return;
    const net = -earned - redeemed;   // quita lo ganado y devuelve lo canjeado (redeemed es negativo)
    if (net !== 0) await this.move(q, p.customerId, 'REVERSAL', net, { orderId: p.orderId, reason: 'Devolución/cancelación' });
  }
}
