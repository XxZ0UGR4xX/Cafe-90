import { Injectable } from '@nestjs/common';
import { Tx } from '../../database/db.service';

export type FindingKind = 'KARDEX_MISMATCH' | 'BALANCE_CHAIN_BROKEN' | 'LOTS_EXCEED_STOCK' | 'NEGATIVE_STOCK';
export interface Finding {
  kind: FindingKind; severity: 'WARNING' | 'CRITICAL'; branchId: string; ingredientId: string; ingredient: string; unit: string;
  stock: number; expected: number; detail: string;
}
const EPS = 0.0005;

/**
 * Conciliación de inventario: el saldo de cada insumo debe ser igual a la suma de su kardex (append-only), el último
 * `balance_after` debe coincidir con el saldo, y los lotes nunca pueden sumar más que lo que hay. Detecta corrupción
 * (escrituras fuera del motor, bugs, restauraciones parciales) antes de que se vuelva diferencia de dinero.
 */
@Injectable()
export class ReconciliationService {
  async check(q: Tx, branchId?: string): Promise<Finding[]> {
    const rows = (await q.query(
      `SELECT inv.branch_id, inv.ingredient_id, i.name, i.unit, inv.qty,
              COALESCE((SELECT sum(m.qty) FROM inventory_movements m WHERE m.branch_id = inv.branch_id AND m.ingredient_id = inv.ingredient_id), 0) AS kardex_sum,
              (SELECT m.balance_after FROM inventory_movements m WHERE m.branch_id = inv.branch_id AND m.ingredient_id = inv.ingredient_id ORDER BY m.at DESC, m.id DESC LIMIT 1) AS last_balance,
              COALESCE((SELECT sum(l.qty_remaining) FROM inventory_lots l WHERE l.branch_id = inv.branch_id AND l.ingredient_id = inv.ingredient_id), 0) AS lots_sum
         FROM inventory inv JOIN ingredients i ON i.id = inv.ingredient_id
        WHERE ($1::uuid IS NULL OR inv.branch_id = $1)`, [branchId ?? null])).rows;
    const out: Finding[] = [];
    for (const r of rows) {
      const base = { branchId: r.branch_id, ingredientId: r.ingredient_id, ingredient: r.name, unit: r.unit, stock: Number(r.qty) };
      if (Math.abs(r.qty - r.kardex_sum) > EPS)
        out.push({ ...base, kind: 'KARDEX_MISMATCH', severity: 'CRITICAL', expected: Number(r.kardex_sum), detail: `El saldo (${r.qty}) no coincide con la suma del kardex (${r.kardex_sum}).` });
      else if (r.last_balance != null && Math.abs(r.qty - r.last_balance) > EPS)
        out.push({ ...base, kind: 'BALANCE_CHAIN_BROKEN', severity: 'CRITICAL', expected: Number(r.last_balance), detail: `El último movimiento dejó ${r.last_balance} pero el saldo es ${r.qty}.` });
      if (r.lots_sum - Math.max(r.qty, 0) > EPS)
        out.push({ ...base, kind: 'LOTS_EXCEED_STOCK', severity: 'WARNING', expected: Number(r.qty), detail: `Los lotes suman ${r.lots_sum} y el saldo es ${r.qty}.` });
      if (r.qty < -EPS)
        out.push({ ...base, kind: 'NEGATIVE_STOCK', severity: 'WARNING', expected: 0, detail: `Existencia negativa (${r.qty}): hubo ventas sin stock pendientes de ajustar.` });
    }
    return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'CRITICAL' ? -1 : 1));
  }
}
