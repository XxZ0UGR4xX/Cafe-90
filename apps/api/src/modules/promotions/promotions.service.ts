import { Injectable } from '@nestjs/common';
import { DbService, Tx } from '../../database/db.service';
import { AppError, conflict, notFound } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { bogoDiscount, freeProductDiscount, inSchedule, percentDiscount, type LineForPromo } from './promotion.rules';

type Dict = Record<string, any>;
const r2 = (n: number) => Math.round(n * 100) / 100;
const COLS = `id, name, type, config, code, schedule, starts_at AS "startsAt", ends_at AS "endsAt", branch_ids AS "branchIds", priority, stackable, max_redemptions AS "maxRedemptions", is_active AS "isActive"`;

@Injectable()
export class PromotionsService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  list() { return this.db.tx(async (q) => (await q.query(`SELECT ${COLS} FROM promotions WHERE deleted_at IS NULL ORDER BY priority DESC, name`)).rows); }

  save(id: string | null, d: Dict) {
    if (d.type === 'COUPON' && !d.code) throw new AppError('VALIDATION_ERROR', 400, { field: 'code', message: 'El cupón requiere un código' });
    return this.db.tx(async (q) => {
      const vals = [d.name, d.type, JSON.stringify(d.config ?? {}), d.code?.toUpperCase() ?? null, d.schedule ? JSON.stringify(d.schedule) : null, d.startsAt ?? null, d.endsAt ?? null,
        d.branchIds ?? null, d.priority, d.stackable, d.maxRedemptions ?? null, d.isActive];
      const r = id
        ? await q.query(`UPDATE promotions SET name=$2,type=$3,config=$4,code=$5,schedule=$6,starts_at=$7,ends_at=$8,branch_ids=$9,priority=$10,stackable=$11,max_redemptions=$12,is_active=$13 WHERE id=$1 AND deleted_at IS NULL RETURNING ${COLS}`, [id, ...vals])
        : await q.query(`INSERT INTO promotions (tenant_id,name,type,config,code,schedule,starts_at,ends_at,branch_ids,priority,stackable,max_redemptions,is_active) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${COLS}`, vals);
      if (!r.rows[0]) throw notFound('promotion');
      await this.audit.record(q, { action: id ? 'promotion.update' : 'promotion.create', entity: 'promotion', entityId: r.rows[0].id, newValue: r.rows[0] });
      return r.rows[0];
    }).catch((e) => { if (e.code === '23505') throw conflict({ field: 'code' }, '⚠️ Ese código de cupón ya existe.'); throw e; });
  }

  remove(id: string) {
    return this.db.tx(async (q) => {
      const r = await q.query('UPDATE promotions SET deleted_at = now(), is_active = false WHERE id=$1 AND deleted_at IS NULL', [id]);
      if (!r.rowCount) throw notFound('promotion');
      await this.audit.record(q, { action: 'promotion.delete', entity: 'promotion', entityId: id });
    });
  }

  /** Promociones vigentes ahora en una sucursal (según zona horaria de la sucursal). */
  async active(q: Tx, branchId: string): Promise<Dict[]> {
    const t = (await q.query(`SELECT EXTRACT(dow FROM (now() AT TIME ZONE timezone))::int AS dow, to_char(now() AT TIME ZONE timezone, 'HH24:MI') AS hhmm FROM branches WHERE id=$1`, [branchId])).rows[0];
    if (!t) return [];
    const rows = (await q.query(
      `SELECT ${COLS}, (SELECT count(*)::int FROM promotion_redemptions r WHERE r.promotion_id = p.id) AS redeemed FROM promotions p
        WHERE p.deleted_at IS NULL AND p.is_active AND (p.starts_at IS NULL OR p.starts_at <= now()) AND (p.ends_at IS NULL OR p.ends_at >= now())
          AND (p.branch_ids IS NULL OR $1::uuid = ANY(p.branch_ids)) ORDER BY p.priority DESC, p.name`, [branchId])).rows;
    return rows.filter((p) => inSchedule(p.schedule, t.dow, t.hhmm) && (!p.maxRedemptions || p.redeemed < p.maxRedemptions));
  }

  listActive(branchId: string) { return this.db.tx((q) => this.active(q, branchId)); }

  /** Evalúa y APLICA las promociones automáticas y cupones a una orden (reemplaza descuentos PROMO previos). */
  async applyTo(q: Tx, orderId: string): Promise<void> {
    const o = (await q.query(`SELECT id, branch_id, customer_id, coupon_codes, payment_status, status, paid_total FROM orders WHERE id=$1`, [orderId])).rows[0];
    if (!o || o.payment_status === 'PAID' || o.paid_total > 0 || ['CANCELLED', 'COMPLETED'].includes(o.status)) return;
    await q.query(`DELETE FROM order_discounts WHERE order_id=$1 AND kind='PROMO'`, [orderId]);
    const lines: LineForPromo[] = (await q.query(
      `SELECT oi.product_id AS "productId", p.category_id AS "categoryId", oi.unit_price AS "unitPrice", oi.qty, oi.line_total AS "lineTotal"
         FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id=$1 AND oi.status <> 'CANCELLED' AND oi.parent_item_id IS NULL AND oi.unit_price > 0`, [orderId])).rows;
    if (!lines.length) return;
    const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
    const promos = await this.active(q, o.branch_id);
    if (!promos.length) return;
    const bday = o.customer_id ? (await q.query(
      `SELECT (to_char(c.birthday,'MM-DD') = to_char(now() AT TIME ZONE b.timezone,'MM-DD')) AS today FROM customers c, branches b WHERE c.id=$1 AND b.id=$2 AND c.birthday IS NOT NULL`, [o.customer_id, o.branch_id])).rows[0]?.today : false;
    const codes = new Set<string>((o.coupon_codes as string[]).map((c) => c.toUpperCase()));

    const results: { promo: Dict; amount: number }[] = [];
    for (const p of promos) {
      const c = p.config as Dict;
      if (c.minSubtotal && subtotal < c.minSubtotal) continue;
      let amount = 0;
      switch (p.type) {
        case 'BOGO': amount = bogoDiscount(lines, c.productIds, c.categoryIds); break;
        case 'PERCENT': case 'HAPPY_HOUR': amount = percentDiscount(lines, c.percent ?? 0, c.productIds, c.categoryIds); break;
        case 'FIXED': amount = Math.min(c.amount ?? 0, subtotal); break;
        case 'FREE_PRODUCT': amount = c.freeProductId ? freeProductDiscount(lines, c.freeProductId) : 0; break;
        case 'COUPON':
          if (!p.code || !codes.has(String(p.code).toUpperCase())) continue;
          amount = c.discountKind === 'FIXED' ? Math.min(c.amount ?? 0, subtotal) : percentDiscount(lines, c.percent ?? 0, c.productIds, c.categoryIds); break;
        case 'BIRTHDAY': amount = bday ? percentDiscount(lines, c.percent ?? 0) : 0; break;
        default: continue;   // DOUBLE_POINTS no descuenta
      }
      if (amount > 0) results.push({ promo: p, amount: r2(amount) });
    }
    // Una sola promoción NO apilable (la de mayor descuento) + todas las apilables.
    const nonStack = results.filter((r) => !r.promo.stackable).sort((a, b) => b.amount - a.amount)[0];
    const chosen = [...(nonStack ? [nonStack] : []), ...results.filter((r) => r.promo.stackable)];
    for (const r of chosen)
      await q.query(`INSERT INTO order_discounts (tenant_id, order_id, promotion_id, kind, value, amount, reason) VALUES (app_tenant_id(),$1,$2,'PROMO',$3,$4,$5)`,
        [orderId, r.promo.id, r.amount, r.amount, r.promo.name]);
  }

  async redeemFor(q: Tx, orderId: string, customerId: string | null) {
    await q.query(`INSERT INTO promotion_redemptions (tenant_id, promotion_id, order_id, customer_id, amount)
                   SELECT app_tenant_id(), promotion_id, order_id, $2, amount FROM order_discounts WHERE order_id=$1 AND kind='PROMO' AND promotion_id IS NOT NULL ON CONFLICT DO NOTHING`, [orderId, customerId]);
  }

  /** Multiplicador de puntos vigente (promoción "puntos dobles"). */
  async pointsMultiplier(q: Tx, branchId: string): Promise<number> {
    const p = (await this.active(q, branchId)).filter((x) => x.type === 'DOUBLE_POINTS');
    return p.reduce((m, x) => Math.max(m, Number(x.config.multiplier ?? 2)), 1);
  }

  /** Agrega/quita un cupón a la orden. */
  async setCoupon(q: Tx, orderId: string, code: string | null, add: boolean) {
    if (add) {
      const ok = (await q.query(`SELECT 1 FROM promotions WHERE upper(code)=upper($1) AND type='COUPON' AND is_active AND deleted_at IS NULL`, [code])).rowCount;
      if (!ok) throw new AppError('NOT_FOUND', 404, { what: 'coupon' }, false, '🎟️ El cupón no existe o no está vigente.');
      await q.query(`UPDATE orders SET coupon_codes = (SELECT array_agg(DISTINCT c) FROM unnest(coupon_codes || ARRAY[upper($2)]) c) WHERE id=$1`, [orderId, code]);
    } else await q.query(`UPDATE orders SET coupon_codes = array_remove(coupon_codes, upper($2)) WHERE id=$1`, [orderId, code]);
  }
}
