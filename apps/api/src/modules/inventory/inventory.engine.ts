import { Injectable } from '@nestjs/common';
import { inventoryStatus } from '@retroburger/shared';
import { Tx } from '../../database/db.service';
import { ctx } from '../../common/request-context';
import { AppError } from '../../common/errors';
import { NotificationsService } from '../notifications/notifications.service';

export type MovementType = 'PURCHASE_IN' | 'SALE_OUT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT' | 'WASTE' | 'COUNT_ADJ' | 'RETURN' | 'SALE_REVERSAL';

export interface MovementInput {
  branchId: string; ingredientId: string; type: MovementType;
  qty: number;                       // con signo: + entra, − sale
  unitCost?: number;                 // si se omite usa avg_cost del ingrediente
  lotCode?: string; expiresOn?: string;
  refType?: string; refId?: string; reason?: string; supplierId?: string;
  /** Si es false y el saldo resultante sería < 0 → INSUFFICIENT_STOCK. Ventas offline/ya consumadas pasan true. */
  allowNegative?: boolean;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Motor de inventario: ÚNICO punto que modifica existencias.
 * Garantiza atomicidad, kardex append-only y saldo consistente (inventory.qty == Σ movimientos).
 */
@Injectable()
export class InventoryEngine {
  constructor(private readonly notifications: NotificationsService) {}

  /** Asegura la fila de inventario y la bloquea (FOR UPDATE). */
  private async lockRow(q: Tx, branchId: string, ingredientId: string) {
    await q.query(
      `INSERT INTO inventory (tenant_id, branch_id, ingredient_id, qty, min_qty, max_qty)
       SELECT app_tenant_id(), $1, i.id, 0, i.default_min, i.default_max FROM ingredients i WHERE i.id = $2
       ON CONFLICT (branch_id, ingredient_id) DO NOTHING`, [branchId, ingredientId]);
    const row = (await q.query(
      `SELECT inv.qty, inv.min_qty, i.name, i.avg_cost, i.unit FROM inventory inv JOIN ingredients i ON i.id = inv.ingredient_id
        WHERE inv.branch_id = $1 AND inv.ingredient_id = $2 FOR UPDATE OF inv`, [branchId, ingredientId])).rows[0];
    if (!row) throw new AppError('NOT_FOUND', 404, { what: 'ingredient' });
    return row as { qty: number; min_qty: number; name: string; avg_cost: number; unit: string };
  }

  /** Bloquea varias filas de inventario en orden determinista (previene deadlocks entre ventas concurrentes). */
  async lockMany(q: Tx, branchId: string, ingredientIds: string[]): Promise<void> {
    for (const id of [...new Set(ingredientIds)].sort()) await this.lockRow(q, branchId, id);
  }

  /**
   * Bloquea, en el MISMO orden global que las ventas (por id de insumo), todas las filas de inventario que tocarán las reversas de
   * unos documentos. Sin esto, una cancelación que revierte item por item toma los bloqueos en otro orden que una venta
   * concurrente y ambas se interbloquean (deadlock detectado por la prueba de estrés).
   */
  async lockForRefs(q: Tx, refType: string, refIds: string[]): Promise<void> {
    if (!refIds.length) return;
    const rows = (await q.query(
      `SELECT DISTINCT branch_id, ingredient_id FROM inventory_movements WHERE ref_type = $1 AND ref_id = ANY($2::uuid[]) AND type IN ('SALE_OUT','SALE_REVERSAL')`, [refType, refIds])).rows;
    const byBranch = new Map<string, string[]>();
    for (const r of rows) byBranch.set(r.branch_id, [...(byBranch.get(r.branch_id) ?? []), r.ingredient_id]);
    for (const [branchId, ids] of [...byBranch.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) await this.lockMany(q, branchId, ids);
  }

  async apply(q: Tx, m: MovementInput): Promise<{ balance: number; movementId: string }> {
    if (!m.qty) throw new AppError('VALIDATION_ERROR', 400, { field: 'qty' });
    const row = await this.lockRow(q, m.branchId, m.ingredientId);
    const balance = r4(row.qty + m.qty);
    if (balance < 0 && !m.allowNegative) {
      throw new AppError('INSUFFICIENT_STOCK', 409, { ingredient: row.name, available: row.qty, requested: -m.qty, unit: row.unit });
    }
    const unitCost = m.unitCost ?? row.avg_cost;
    let lotId: string | null = null;

    if (m.qty > 0 && (m.lotCode || m.expiresOn || m.type === 'PURCHASE_IN' || m.type === 'TRANSFER_IN')) {
      lotId = (await q.query(
        `INSERT INTO inventory_lots (tenant_id, branch_id, ingredient_id, lot_code, expires_on, qty_remaining, unit_cost)
         VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6) RETURNING id`,
        [m.branchId, m.ingredientId, m.lotCode ?? null, m.expiresOn ?? null, m.qty, unitCost])).rows[0].id;
    } else if (m.qty < 0) {
      // FEFO: primero lotes que caducan antes; el resto se toma de existencias sin lote.
      let remaining = -m.qty;
      const lots = (await q.query(
        `SELECT id, qty_remaining FROM inventory_lots WHERE branch_id=$1 AND ingredient_id=$2 AND qty_remaining > 0
          ORDER BY expires_on NULLS LAST, received_at FOR UPDATE`, [m.branchId, m.ingredientId])).rows;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(lot.qty_remaining, remaining);
        await q.query('UPDATE inventory_lots SET qty_remaining = qty_remaining - $2 WHERE id = $1', [lot.id, take]);
        lotId ??= lot.id;
        remaining = r4(remaining - take);
      }
    }

    const mv = (await q.query(
      `INSERT INTO inventory_movements (tenant_id, branch_id, ingredient_id, type, qty, unit_cost, balance_after, lot_id, ref_type, ref_id, reason, user_id)
       VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [m.branchId, m.ingredientId, m.type, m.qty, unitCost, balance, lotId, m.refType ?? null, m.refId ?? null, m.reason ?? null,
        ctx().principal?.userId ?? null])).rows[0];
    await q.query('UPDATE inventory SET qty = $3, needs_review = needs_review OR $4, updated_at = now() WHERE branch_id = $1 AND ingredient_id = $2',
      [m.branchId, m.ingredientId, balance, balance < 0]);

    if (m.type === 'PURCHASE_IN') await this.updateAvgCost(q, m.ingredientId, row.qty, row.avg_cost, m.qty, unitCost, m.supplierId);
    await this.alertIfNeeded(q, m.branchId, m.ingredientId, row, balance);
    return { balance, movementId: mv.id };
  }

  /** Costo promedio ponderado global por ingrediente. */
  private async updateAvgCost(q: Tx, ingredientId: string, _branchQty: number, avg: number, qtyIn: number, costIn: number, supplierId?: string) {
    const total = (await q.query('SELECT COALESCE(sum(GREATEST(qty,0)),0) AS t FROM inventory WHERE ingredient_id = $1', [ingredientId])).rows[0].t as number;
    const before = Math.max(total - qtyIn, 0);  // la suma ya incluye este ingreso
    const newAvg = before + qtyIn > 0 ? (before * avg + qtyIn * costIn) / (before + qtyIn) : costIn;
    await q.query('UPDATE ingredients SET avg_cost = $2 WHERE id = $1', [ingredientId, r4(newAvg)]);
    await q.query(`INSERT INTO ingredient_cost_history (tenant_id, ingredient_id, supplier_id, unit_cost) VALUES (app_tenant_id(),$1,$2,$3)`, [ingredientId, supplierId ?? null, costIn]);
  }

  private async alertIfNeeded(q: Tx, branchId: string, ingredientId: string, row: { min_qty: number; name: string; unit: string }, balance: number) {
    const status = inventoryStatus(balance, row.min_qty);
    if (status === 'AVAILABLE') return;
    const day = new Date().toISOString().slice(0, 10);
    await this.notifications.emit(q, {
      type: status === 'OUT_OF_STOCK' ? 'STOCK_OUT' : 'STOCK_LOW',
      severity: status === 'LOW' ? 'WARNING' : 'CRITICAL', branchId,
      title: status === 'OUT_OF_STOCK' ? `🚨 Agotado: ${row.name}` : `⚠️ Inventario ${status === 'LOW' ? 'bajo' : 'crítico'}: ${row.name}`,
      body: `Existencia ${balance} ${row.unit} (mínimo ${row.min_qty}).`, payload: { ingredientId, balance },
      dedupeKey: `stock:${branchId}:${ingredientId}:${status}:${day}`,
    });
  }

  /**
   * Consume ingredientes para una venta. Agrupa por ingrediente y bloquea en orden determinista (evita deadlocks).
   */
  async consume(q: Tx, branchId: string, lines: { ingredientId: string; qty: number }[], ref: { type: string; id: string }, allowNegative: boolean): Promise<void> {
    const byIng = new Map<string, number>();
    for (const l of lines) byIng.set(l.ingredientId, r4((byIng.get(l.ingredientId) ?? 0) + l.qty));
    for (const [ingredientId, qty] of [...byIng.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (qty <= 0) continue;   // un "sin X" puede compensar y dejar ≤ 0: no se descuenta
      await this.apply(q, { branchId, ingredientId, type: 'SALE_OUT', qty: -qty, refType: ref.type, refId: ref.id, allowNegative });
    }
  }

  /** Contra-asientos de los consumos de un documento (cancelación antes de preparar / devolución). */
  async reverse(q: Tx, ref: { type: string; id: string }, reason: string, restock = true): Promise<number> {
    if (!restock) return 0;   // ya preparado: el consumo permanece (queda como costo/merma)
    const rows = (await q.query(
      `SELECT m.branch_id, m.ingredient_id, -sum(m.qty) AS qty FROM inventory_movements m
        WHERE m.ref_type = $1 AND m.ref_id = $2 AND m.type IN ('SALE_OUT','SALE_REVERSAL') GROUP BY m.branch_id, m.ingredient_id
        HAVING -sum(m.qty) > 0 ORDER BY m.ingredient_id`, [ref.type, ref.id])).rows;
    for (const r of rows) {
      await this.apply(q, { branchId: r.branch_id, ingredientId: r.ingredient_id, type: 'SALE_REVERSAL', qty: r.qty, refType: ref.type, refId: ref.id, reason, allowNegative: true });
    }
    return rows.length;
  }
}
