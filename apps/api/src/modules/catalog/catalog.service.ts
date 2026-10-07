import { Injectable } from '@nestjs/common';
import { DbService, Tx } from '../../database/db.service';
import { AppError, conflict, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { CatalogRepository } from './catalog.repository';

type Dict = Record<string, any>;
const dupMsg = (field: string) => `⚠️ Ya existe un registro con ese ${field}.`;
const mapDup = (field: string) => (e: any) => { if (e.code === '23505') throw conflict({ field }, dupMsg(field)); throw e; };

@Injectable()
export class CatalogService {
  constructor(private readonly db: DbService, private readonly repo: CatalogRepository, private readonly audit: AuditService) {}

  private canSeeCost() { return ctx().principal!.can('catalog.cost.read'); }

  // ───────── Categorías ─────────
  listCategories() {
    return this.db.tx(async (q) => (await q.query(
      `SELECT id, name, icon, color, sort_order AS "sortOrder", is_active AS "isActive" FROM categories WHERE deleted_at IS NULL ORDER BY sort_order, name`)).rows);
  }
  saveCategory(id: string | null, d: Dict) {
    return this.db.tx(async (q) => {
      const r = id
        ? await q.query(`UPDATE categories SET name=$2, icon=$3, color=$4, sort_order=$5, is_active=$6 WHERE id=$1 AND deleted_at IS NULL
                         RETURNING id, name, icon, color, sort_order AS "sortOrder", is_active AS "isActive"`, [id, d.name, d.icon ?? null, d.color ?? null, d.sortOrder, d.isActive])
        : await q.query(`INSERT INTO categories (tenant_id, name, icon, color, sort_order, is_active) VALUES (app_tenant_id(),$1,$2,$3,$4,$5)
                         RETURNING id, name, icon, color, sort_order AS "sortOrder", is_active AS "isActive"`, [d.name, d.icon ?? null, d.color ?? null, d.sortOrder, d.isActive]);
      if (!r.rows[0]) throw notFound('category');
      await this.audit.record(q, { action: id ? 'category.update' : 'category.create', entity: 'category', entityId: r.rows[0].id, newValue: r.rows[0] });
      return r.rows[0];
    }).catch(mapDup('nombre'));
  }
  deleteCategory(id: string) {
    return this.db.tx(async (q) => {
      const used = (await q.query('SELECT count(*)::int n FROM products WHERE category_id=$1 AND deleted_at IS NULL', [id])).rows[0].n;
      if (used) throw conflict({ products: used }, '⚠️ La categoría tiene productos asignados.');
      const r = await q.query('UPDATE categories SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL', [id]);
      if (!r.rowCount) throw notFound('category');
      await this.audit.record(q, { action: 'category.delete', entity: 'category', entityId: id });
    });
  }

  // ───────── Impuestos ─────────
  listTaxes() { return this.db.tx(async (q) => (await q.query(`SELECT id, name, rate, included_in_price AS "includedInPrice", is_default AS "isDefault" FROM taxes ORDER BY name`)).rows); }
  createTax(d: Dict) {
    return this.db.tx(async (q) => {
      if (d.isDefault) await q.query('UPDATE taxes SET is_default = false');
      const r = (await q.query(`INSERT INTO taxes (tenant_id, name, rate, included_in_price, is_default) VALUES (app_tenant_id(),$1,$2,$3,$4)
                                RETURNING id, name, rate, included_in_price AS "includedInPrice", is_default AS "isDefault"`, [d.name, d.rate, d.includedInPrice, d.isDefault])).rows[0];
      await this.audit.record(q, { action: 'tax.create', entity: 'tax', entityId: r.id, newValue: r });
      return r;
    });
  }

  // ───────── Ingredientes ─────────
  listIngredients(search?: string) {
    const cost = this.canSeeCost();
    return this.db.tx(async (q) => (await q.query(
      `SELECT id, sku, name, unit, perishable, ${cost ? 'avg_cost' : 'NULL::numeric'} AS "avgCost", default_min AS "defaultMin", default_max AS "defaultMax"
         FROM ingredients WHERE deleted_at IS NULL AND ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR sku ILIKE '%' || $1 || '%') ORDER BY name`, [search ?? null])).rows);
  }
  saveIngredient(id: string | null, d: Dict) {
    return this.db.tx(async (q) => {
      const cols = `id, sku, name, unit, perishable, avg_cost AS "avgCost", default_min AS "defaultMin", default_max AS "defaultMax"`;
      const r = id
        ? await q.query(`UPDATE ingredients SET sku=$2,name=$3,unit=$4,perishable=$5,avg_cost=COALESCE($6,avg_cost),default_min=$7,default_max=$8 WHERE id=$1 AND deleted_at IS NULL RETURNING ${cols}`,
            [id, d.sku, d.name, d.unit, d.perishable, d.avgCost ?? null, d.defaultMin, d.defaultMax])
        : await q.query(`INSERT INTO ingredients (tenant_id, sku, name, unit, perishable, avg_cost, default_min, default_max)
                         VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7) RETURNING ${cols}`, [d.sku, d.name, d.unit, d.perishable, d.avgCost ?? 0, d.defaultMin, d.defaultMax]);
      if (!r.rows[0]) throw notFound('ingredient');
      await this.audit.record(q, { action: id ? 'ingredient.update' : 'ingredient.create', entity: 'ingredient', entityId: r.rows[0].id, newValue: r.rows[0] });
      return r.rows[0];
    }).catch(mapDup('SKU'));
  }
  deleteIngredient(id: string) {
    return this.db.tx(async (q) => {
      const used = (await q.query('SELECT count(*)::int n FROM recipe_items WHERE ingredient_id=$1', [id])).rows[0].n;
      if (used) throw conflict({ recipes: used }, '⚠️ El ingrediente se usa en recetas.');
      const r = await q.query('UPDATE ingredients SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL', [id]);
      if (!r.rowCount) throw notFound('ingredient');
      await this.audit.record(q, { action: 'ingredient.delete', entity: 'ingredient', entityId: id });
    });
  }

  // ───────── Modificadores ─────────
  async listModifierGroups() {
    return this.db.tx(async (q) => (await q.query(
      `SELECT g.id, g.name, g.type, g.min_select AS "minSelect", g.max_select AS "maxSelect",
              COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name, 'priceDelta', m.price_delta, 'ingredientId', m.ingredient_id,
                'qtyDelta', m.qty_delta, 'isActive', m.is_active) ORDER BY m.sort_order) FILTER (WHERE m.id IS NOT NULL), '[]') AS modifiers
         FROM modifier_groups g LEFT JOIN modifiers m ON m.group_id = g.id WHERE g.deleted_at IS NULL GROUP BY g.id ORDER BY g.name`)).rows);
  }
  saveModifierGroup(id: string | null, d: Dict) {
    return this.db.tx(async (q) => {
      let gid = id;
      if (id) {
        const r = await q.query('UPDATE modifier_groups SET name=$2,type=$3,min_select=$4,max_select=$5 WHERE id=$1 AND deleted_at IS NULL', [id, d.name, d.type, d.minSelect, d.maxSelect]);
        if (!r.rowCount) throw notFound('modifier_group');
        // Los modificadores ya usados en ventas se conservan (snapshot en order_item_modifiers); aquí se reemplaza el catálogo.
        await q.query('DELETE FROM modifiers WHERE group_id = $1', [id]).catch(() => { throw conflict(undefined, '⚠️ No se puede reemplazar: hay modificadores en uso.'); });
      } else {
        gid = (await q.query('INSERT INTO modifier_groups (tenant_id,name,type,min_select,max_select) VALUES (app_tenant_id(),$1,$2,$3,$4) RETURNING id', [d.name, d.type, d.minSelect, d.maxSelect])).rows[0].id;
      }
      let i = 0;
      for (const m of d.modifiers)
        await q.query(`INSERT INTO modifiers (tenant_id, group_id, name, price_delta, ingredient_id, qty_delta, sort_order, is_active)
                       VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7)`, [gid, m.name, m.priceDelta, m.ingredientId ?? null, m.qtyDelta, i++, m.isActive]);
      await this.audit.record(q, { action: id ? 'modifier_group.update' : 'modifier_group.create', entity: 'modifier_group', entityId: gid, newValue: d });
      return { id: gid, ...d };
    });
  }
  deleteModifierGroup(id: string) {
    return this.db.tx(async (q) => {
      const r = await q.query('UPDATE modifier_groups SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL', [id]);
      if (!r.rowCount) throw notFound('modifier_group');
      await q.query('DELETE FROM product_modifier_groups WHERE group_id = $1', [id]);
      await this.audit.record(q, { action: 'modifier_group.delete', entity: 'modifier_group', entityId: id });
    });
  }

  // ───────── Productos ─────────
  private async hydrate(q: Tx, rows: Dict[], cost: boolean) {
    if (!rows.length) return rows;
    const ids = rows.map((r) => r.id);
    const variants = (await q.query(`SELECT product_id, id, name, sku, price_delta AS "priceDelta", qty_factor AS "qtyFactor" FROM product_variants WHERE product_id = ANY($1::uuid[]) ORDER BY sort_order`, [ids])).rows;
    const groups = (await q.query(`SELECT product_id, group_id FROM product_modifier_groups WHERE product_id = ANY($1::uuid[]) ORDER BY sort_order`, [ids])).rows;
    const slots = (await q.query(
      `SELECT s.combo_id, s.id, s.name, s.default_product_id AS "defaultProductId",
              COALESCE(json_agg(json_build_object('productId', o.product_id, 'priceDelta', o.price_delta)) FILTER (WHERE o.product_id IS NOT NULL), '[]') AS options
         FROM combo_slots s LEFT JOIN combo_slot_options o ON o.slot_id = s.id WHERE s.combo_id = ANY($1::uuid[]) GROUP BY s.id ORDER BY s.sort_order`, [ids])).rows;
    for (const r of rows) {
      r.variants = variants.filter((v) => v.product_id === r.id).map(({ product_id, ...v }) => v);
      r.modifierGroupIds = groups.filter((g) => g.product_id === r.id).map((g) => g.group_id);
      r.comboSlots = slots.filter((s) => s.combo_id === r.id).map(({ combo_id, ...s }) => s);
      if (cost) {
        r.cost = await this.repo.productCost(q, r.id);
        const net = r.taxIncluded ? r.price / (1 + r.taxRate) : r.price;
        r.margin = net > 0 ? Math.round(((net - r.cost) / net) * 10000) / 10000 : 0;
      }
      delete r.taxRate; delete r.taxIncluded;
    }
    return rows;
  }

  private static COLS = `p.id, p.category_id AS "categoryId", p.kind, p.sku, p.barcode, p.name, p.description, p.image_url AS "imageUrl",
      p.price, p.tax_id AS "taxId", p.is_available AS "isAvailable", p.is_inventoriable AS "isInventoriable",
      p.prep_time_sec AS "prepTimeSec", p.station_key AS "stationKey", p.sort_order AS "sortOrder",
      p.sat_product_key AS "satProductKey", p.sat_unit_key AS "satUnitKey", p.sat_unit_name AS "satUnitName",
      COALESCE(t.rate,0) AS "taxRate", COALESCE(t.included_in_price,true) AS "taxIncluded"`;

  async listProducts(f: { categoryId?: string; q?: string; limit: number; offset: number }) {
    const cost = this.canSeeCost();
    return this.db.tx(async (q) => {
      const rows = (await q.query(
        `SELECT ${CatalogService.COLS} FROM products p LEFT JOIN taxes t ON t.id = p.tax_id
          WHERE p.deleted_at IS NULL AND ($1::uuid IS NULL OR p.category_id = $1)
            AND ($2::text IS NULL OR p.name ILIKE '%'||$2||'%' OR p.sku ILIKE '%'||$2||'%' OR p.barcode = $2)
          ORDER BY p.sort_order, p.name LIMIT $3 OFFSET $4`, [f.categoryId ?? null, f.q ?? null, f.limit, f.offset])).rows;
      return this.hydrate(q, rows, cost);
    });
  }

  async getProduct(id: string) {
    const cost = this.canSeeCost();
    return this.db.tx(async (q) => {
      const rows = (await q.query(`SELECT ${CatalogService.COLS} FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.id=$1 AND p.deleted_at IS NULL`, [id])).rows;
      if (!rows[0]) throw notFound('product');
      const [p] = await this.hydrate(q, rows, cost);
      p.recipe = (await this.repo.recipeLines(q, id)).map((l) => ({ ingredientId: l.ingredient_id, ingredientName: l.ingredient_name, unit: l.unit, qty: l.qty, wastePct: l.waste_pct }));
      return p;
    });
  }

  private async writeChildren(q: Tx, id: string, d: Dict) {
    await q.query('DELETE FROM product_variants WHERE product_id=$1', [id]).catch(() => { throw conflict(undefined, '⚠️ Variantes en uso.'); });
    let i = 0;
    for (const v of d.variants) await q.query(`INSERT INTO product_variants (tenant_id, product_id, name, sku, price_delta, qty_factor, sort_order) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6)`, [id, v.name, v.sku ?? null, v.priceDelta, v.qtyFactor, i++]);
    await q.query('DELETE FROM product_modifier_groups WHERE product_id=$1', [id]);
    i = 0;
    for (const g of d.modifierGroupIds) await q.query(`INSERT INTO product_modifier_groups (tenant_id, product_id, group_id, sort_order) VALUES (app_tenant_id(),$1,$2,$3)`, [id, g, i++]);
    await q.query('DELETE FROM combo_slots WHERE combo_id=$1', [id]);
    if (d.kind === 'COMBO') {
      if (!d.comboSlots.length) throw new AppError('VALIDATION_ERROR', 400, { field: 'comboSlots', message: 'Un combo requiere al menos un componente' });
      i = 0;
      for (const s of d.comboSlots) {
        const sid = (await q.query(`INSERT INTO combo_slots (tenant_id, combo_id, name, default_product_id, sort_order) VALUES (app_tenant_id(),$1,$2,$3,$4) RETURNING id`, [id, s.name, s.defaultProductId, i++])).rows[0].id;
        for (const o of s.options) await q.query(`INSERT INTO combo_slot_options (tenant_id, slot_id, product_id, price_delta) VALUES (app_tenant_id(),$1,$2,$3)`, [sid, o.productId, o.priceDelta]);
      }
    }
    if (d.recipe) await this.writeRecipe(q, id, d.recipe);
  }

  private async writeRecipe(q: Tx, productId: string, items: Dict[]) {
    await q.query('UPDATE recipes SET active = false WHERE product_id = $1 AND active', [productId]);
    if (!items.length) return;
    const version = (await q.query('SELECT COALESCE(max(version),0)+1 AS v FROM recipes WHERE product_id=$1', [productId])).rows[0].v;
    const rid = (await q.query('INSERT INTO recipes (tenant_id, product_id, version) VALUES (app_tenant_id(),$1,$2) RETURNING id', [productId, version])).rows[0].id;
    for (const it of items) await q.query('INSERT INTO recipe_items (tenant_id, recipe_id, ingredient_id, qty, waste_pct) VALUES (app_tenant_id(),$1,$2,$3,$4)', [rid, it.ingredientId, it.qty, it.wastePct]);
  }

  saveProduct(id: string | null, d: Dict) {
    return this.db.tx(async (q) => {
      const vals = [d.categoryId ?? null, d.kind, d.sku, d.barcode ?? null, d.name, d.description ?? null, d.imageUrl ?? null, d.price, d.taxId ?? null,
        d.isAvailable, d.isInventoriable, d.prepTimeSec, d.stationKey ?? null, d.sortOrder];
      let pid = id;
      if (id) {
        const r = await q.query(`UPDATE products SET category_id=$2,kind=$3,sku=$4,barcode=$5,name=$6,description=$7,image_url=$8,price=$9,tax_id=$10,
            is_available=$11,is_inventoriable=$12,prep_time_sec=$13,station_key=$14,sort_order=$15 WHERE id=$1 AND deleted_at IS NULL`, [id, ...vals]);
        if (!r.rowCount) throw notFound('product');
      } else {
        pid = (await q.query(`INSERT INTO products (tenant_id,category_id,kind,sku,barcode,name,description,image_url,price,tax_id,is_available,is_inventoriable,prep_time_sec,station_key,sort_order)
                              VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, vals)).rows[0].id;
      }
      if (d.satProductKey || d.satUnitKey || d.satUnitName)
        await q.query('UPDATE products SET sat_product_key=COALESCE($2,sat_product_key), sat_unit_key=COALESCE($3,sat_unit_key), sat_unit_name=COALESCE($4,sat_unit_name) WHERE id=$1', [pid, d.satProductKey ?? null, d.satUnitKey ?? null, d.satUnitName ?? null]);
      await this.writeChildren(q, pid!, d);
      await this.audit.record(q, { action: id ? 'product.update' : 'product.create', entity: 'product', entityId: pid, newValue: { ...d, recipe: d.recipe?.length } });
      return pid!;
    }).catch(mapDup('SKU o código de barras')).then((pid) => this.getProduct(pid));
  }

  setRecipe(productId: string, items: Dict[]) {
    return this.db.tx(async (q) => {
      if (!(await q.query('SELECT 1 FROM products WHERE id=$1 AND deleted_at IS NULL', [productId])).rowCount) throw notFound('product');
      await this.writeRecipe(q, productId, items);
      await this.audit.record(q, { action: 'recipe.update', entity: 'product', entityId: productId, newValue: { items } });
    }).then(() => this.getProduct(productId));
  }

  deleteProduct(id: string) {
    return this.db.tx(async (q) => {
      const r = await q.query('UPDATE products SET deleted_at = now(), is_available = false WHERE id=$1 AND deleted_at IS NULL', [id]);
      if (!r.rowCount) throw notFound('product');
      await this.audit.record(q, { action: 'product.delete', entity: 'product', entityId: id });
    });
  }

  async productCost(id: string) {
    return this.db.tx(async (q) => {
      const lines = await this.repo.recipeLines(q, id);
      const total = await this.repo.productCost(q, id);
      return { productId: id, cost: total, lines: lines.map((l) => ({ ingredient: l.ingredient_name, qty: l.qty, unit: l.unit, lineCost: Math.round(((l.qty * (l.avg_cost ?? 0)) / (1 - l.waste_pct)) * 10000) / 10000 })) };
    });
  }

  setBranchProduct(branchId: string, productId: string, d: { price?: number | null; isAvailable?: boolean | null }) {
    return this.db.tx(async (q) => {
      await q.query(`INSERT INTO branch_products (tenant_id, branch_id, product_id, price, is_available) VALUES (app_tenant_id(),$1,$2,$3,$4)
                     ON CONFLICT (branch_id, product_id) DO UPDATE SET price = EXCLUDED.price, is_available = EXCLUDED.is_available`,
        [branchId, productId, d.price ?? null, d.isAvailable ?? null]);
      await this.audit.record(q, { action: 'branch_product.update', entity: 'product', entityId: productId, branchId, newValue: d });
      return { branchId, productId, ...d };
    });
  }

  /**
   * Menú completo para POS/QR/offline: categorías + productos con precio efectivo, disponibilidad real
   * (según stock de receta en la sucursal), variantes, modificadores y combos. NUNCA incluye costos.
   */
  async menu(branchId: string) {
    return this.db.tx(async (q) => {
      const categories = (await q.query(`SELECT id, name, icon, color FROM categories WHERE deleted_at IS NULL AND is_active ORDER BY sort_order, name`)).rows;
      const products = (await q.query(
        `SELECT p.id, p.category_id AS "categoryId", p.kind, p.sku, p.name, p.description, p.image_url AS "imageUrl",
                COALESCE(bp.price, p.price) AS price, COALESCE(t.rate,0) AS "taxRate", COALESCE(t.included_in_price,true) AS "taxIncluded",
                p.prep_time_sec AS "prepTimeSec", p.station_key AS "stationKey", p.is_inventoriable AS "isInventoriable",
                (COALESCE(bp.is_available, p.is_available)
                 AND NOT EXISTS (
                   SELECT 1 FROM recipes r JOIN recipe_items ri ON ri.recipe_id = r.id
                    LEFT JOIN inventory inv ON inv.ingredient_id = ri.ingredient_id AND inv.branch_id = $1
                   WHERE r.product_id = p.id AND r.active AND p.is_inventoriable AND COALESCE(inv.qty, 0) < ri.qty)) AS available
           FROM products p LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = $1
           LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.deleted_at IS NULL ORDER BY p.sort_order, p.name`, [branchId])).rows;
      const hydrated = await this.hydrate(q, products, false);
      const groups = (await q.query(
        `SELECT g.id, g.name, g.type, g.min_select AS "minSelect", g.max_select AS "maxSelect",
                COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name, 'priceDelta', m.price_delta) ORDER BY m.sort_order) FILTER (WHERE m.id IS NOT NULL AND m.is_active), '[]') AS modifiers
           FROM modifier_groups g LEFT JOIN modifiers m ON m.group_id = g.id WHERE g.deleted_at IS NULL GROUP BY g.id`)).rows;
      return { branchId, categories, products: hydrated, modifierGroups: groups, generatedAt: new Date().toISOString() };
    });
  }
}
