import { Injectable } from '@nestjs/common';
import { Tx } from '../../database/db.service';

export interface RecipeLine { ingredient_id: string; qty: number; waste_pct: number; ingredient_name?: string; unit?: string; avg_cost?: number }

/** Consultas de catálogo compartidas con otros módulos (ventas, inventario). */
@Injectable()
export class CatalogRepository {
  /** Productos con precio efectivo (override de sucursal) y tasa de impuesto. */
  async productsForOrder(q: Tx, ids: string[], branchId: string) {
    return (await q.query(
      `SELECT p.id, p.name, p.kind, p.is_inventoriable, p.prep_time_sec, p.station_key,
              COALESCE(bp.price, p.price) AS price,
              COALESCE(bp.is_available, p.is_available) AS available,
              COALESCE(t.rate, 0) AS tax_rate, COALESCE(t.included_in_price, true) AS tax_included
         FROM products p
         LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = $2
         LEFT JOIN taxes t ON t.id = p.tax_id
        WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL`, [ids, branchId])).rows;
  }

  async variantsByIds(q: Tx, ids: string[]) {
    if (!ids.length) return [];
    return (await q.query('SELECT id, product_id, name, price_delta, qty_factor FROM product_variants WHERE id = ANY($1::uuid[])', [ids])).rows;
  }

  async modifiersByIds(q: Tx, ids: string[]) {
    if (!ids.length) return [];
    return (await q.query(
      `SELECT m.id, m.name, m.price_delta, m.ingredient_id, m.qty_delta, m.is_active, m.group_id,
              g.type, g.name AS group_name, g.min_select, g.max_select
         FROM modifiers m JOIN modifier_groups g ON g.id = m.group_id WHERE m.id = ANY($1::uuid[])`, [ids])).rows;
  }

  /** Grupos de modificadores permitidos para un producto con sus límites. */
  async groupsForProduct(q: Tx, productId: string) {
    return (await q.query(
      `SELECT g.id, g.name, g.type, g.min_select, g.max_select FROM product_modifier_groups pg
         JOIN modifier_groups g ON g.id = pg.group_id AND g.deleted_at IS NULL WHERE pg.product_id = $1`, [productId])).rows;
  }

  async recipeLines(q: Tx, productId: string): Promise<RecipeLine[]> {
    return (await q.query(
      `SELECT ri.ingredient_id, ri.qty, ri.waste_pct, i.name AS ingredient_name, i.unit, i.avg_cost
         FROM recipes r JOIN recipe_items ri ON ri.recipe_id = r.id JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE r.product_id = $1 AND r.active`, [productId])).rows;
  }

  async comboSlots(q: Tx, comboId: string) {
    return (await q.query(
      `SELECT s.id, s.name, s.default_product_id,
              COALESCE(json_agg(json_build_object('productId', o.product_id, 'priceDelta', o.price_delta))
                       FILTER (WHERE o.product_id IS NOT NULL), '[]') AS options
         FROM combo_slots s LEFT JOIN combo_slot_options o ON o.slot_id = s.id
        WHERE s.combo_id = $1 GROUP BY s.id ORDER BY s.sort_order`, [comboId])).rows;
  }

  /** Costo de receta de un producto (por unidad vendida), recursivo para combos. */
  async productCost(q: Tx, productId: string, depth = 0): Promise<number> {
    const lines = await this.recipeLines(q, productId);
    let cost = lines.reduce((a, l) => a + (l.qty * (l.avg_cost ?? 0)) / (1 - l.waste_pct), 0);
    if (depth < 2) {
      for (const s of await this.comboSlots(q, productId)) cost += await this.productCost(q, s.default_product_id, depth + 1);
    }
    return Math.round(cost * 10000) / 10000;
  }
}
