import { Injectable } from '@nestjs/common';
import { Tx } from '../../database/db.service';
import { AppError } from '../../common/errors';
import { CatalogRepository } from '../catalog/catalog.repository';

type Dict = Record<string, any>;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export interface BuiltModifier { id: string; name: string; groupName: string; type: string; priceDelta: number; ingredientId: string | null; qtyDelta: number }
export interface BuiltLine {
  productId: string; variantId: string | null; name: string; qty: number; unitPrice: number; taxRate: number; taxIncluded: boolean;
  unitCost: number; stationKey: string | null; notes?: string; slotName?: string; modifiers: BuiltModifier[]; children: BuiltLine[];
}

/** Resuelve los items de entrada (producto/variante/modificadores/combos) a líneas con precio y costo SNAPSHOT. */
@Injectable()
export class LineBuilder {
  constructor(private readonly catalog: CatalogRepository) {}

  async build(q: Tx, branchId: string, inputs: Dict[], opts: { allowUnavailable: boolean }): Promise<BuiltLine[]> {
    const productIds = new Set<string>();
    const variantIds = new Set<string>();
    const modIds = new Set<string>();
    for (const it of inputs) {
      productIds.add(it.productId); if (it.variantId) variantIds.add(it.variantId);
      it.modifierIds.forEach((m: string) => modIds.add(m));
      for (const c of it.comboChoices) { productIds.add(c.productId); c.modifierIds.forEach((m: string) => modIds.add(m)); }
    }
    const products = new Map((await this.catalog.productsForOrder(q, [...productIds], branchId)).map((p) => [p.id, p]));
    const variants = new Map((await this.catalog.variantsByIds(q, [...variantIds])).map((v) => [v.id, v]));
    const mods = new Map((await this.catalog.modifiersByIds(q, [...modIds])).map((m) => [m.id, m]));
    const ingCost = new Map<string, number>();
    const ingIds = [...mods.values()].map((m) => m.ingredient_id).filter(Boolean);
    if (ingIds.length)
      for (const r of (await q.query('SELECT id, avg_cost FROM ingredients WHERE id = ANY($1::uuid[])', [ingIds])).rows) ingCost.set(r.id, r.avg_cost);
    const groupsCache = new Map<string, Dict[]>();
    const costCache = new Map<string, number>();

    const ownCost = async (pid: string) => {
      if (!costCache.has(pid)) {
        const lines = await this.catalog.recipeLines(q, pid);
        costCache.set(pid, lines.reduce((a, l) => a + (l.qty * (l.avg_cost ?? 0)) / (1 - l.waste_pct), 0));
      }
      return costCache.get(pid)!;
    };
    const groupsOf = async (pid: string) => {
      if (!groupsCache.has(pid)) groupsCache.set(pid, await this.catalog.groupsForProduct(q, pid));
      return groupsCache.get(pid)!;
    };

    const resolveModifiers = async (productId: string, ids: string[], productName: string): Promise<BuiltModifier[]> => {
      const groups = await groupsOf(productId);
      const picked = ids.map((id) => {
        const m = mods.get(id);
        if (!m || !m.is_active) throw new AppError('VALIDATION_ERROR', 400, { modifierId: id, message: 'Modificador no disponible' });
        if (!groups.some((g) => g.id === m.group_id)) throw new AppError('VALIDATION_ERROR', 400, { modifier: m.name, message: `${m.name} no aplica a ${productName}` });
        return m;
      });
      for (const g of groups) {
        const n = picked.filter((m) => m.group_id === g.id).length;
        if (n < g.min_select || n > g.max_select)
          throw new AppError('VALIDATION_ERROR', 400, { group: g.name, message: `Selecciona entre ${g.min_select} y ${g.max_select} en "${g.name}" (${productName})` });
      }
      return picked.map((m) => ({ id: m.id, name: m.name, groupName: m.group_name, type: m.type, priceDelta: m.price_delta, ingredientId: m.ingredient_id, qtyDelta: m.qty_delta }));
    };
    const modCost = (ms: BuiltModifier[]) => ms.reduce((a, m) => a + (m.ingredientId ? (ingCost.get(m.ingredientId) ?? 0) * m.qtyDelta : 0), 0);

    const lines: BuiltLine[] = [];
    for (const it of inputs) {
      const p = products.get(it.productId);
      if (!p) throw new AppError('NOT_FOUND', 404, { what: 'product', id: it.productId });
      if (!p.available && !opts.allowUnavailable) throw new AppError('PRODUCT_UNAVAILABLE', 409, { product: p.name });
      const v = it.variantId ? variants.get(it.variantId) : undefined;
      if (it.variantId && (!v || v.product_id !== p.id)) throw new AppError('VALIDATION_ERROR', 400, { variantId: it.variantId });
      const modifiers = await resolveModifiers(p.id, it.modifierIds, p.name);
      let unitPrice = p.price + (v?.price_delta ?? 0) + modifiers.reduce((a, m) => a + m.priceDelta, 0);
      let unitCost = (await ownCost(p.id)) * Number(v?.qty_factor ?? 1) + modCost(modifiers);
      const line: BuiltLine = { productId: p.id, variantId: v?.id ?? null, name: v ? `${p.name} (${v.name})` : p.name, qty: it.qty, unitPrice: 0,
        taxRate: p.tax_rate, taxIncluded: p.tax_included, unitCost: 0, stationKey: p.kind === 'COMBO' ? null : p.station_key, notes: it.notes, modifiers, children: [] };

      if (p.kind === 'COMBO') {
        const slots = await this.catalog.comboSlots(q, p.id);
        if (!slots.length) throw new AppError('VALIDATION_ERROR', 400, { product: p.name, message: 'El combo no tiene componentes' });
        for (const slot of slots) {
          const choice = it.comboChoices.find((c: Dict) => c.slotId === slot.id);
          const chosenId: string = choice?.productId ?? slot.default_product_id;
          const opt = (slot.options as Dict[]).find((o) => o.productId === chosenId);
          if (chosenId !== slot.default_product_id && !opt) throw new AppError('VALIDATION_ERROR', 400, { slot: slot.name, message: `Sustitución no permitida en ${slot.name}` });
          const cp = products.get(chosenId) ?? (await this.catalog.productsForOrder(q, [chosenId], branchId))[0];
          if (!cp) throw new AppError('NOT_FOUND', 404, { what: 'product', id: chosenId });
          if (!cp.available && !opts.allowUnavailable) throw new AppError('PRODUCT_UNAVAILABLE', 409, { product: cp.name });
          if (!products.has(chosenId)) products.set(chosenId, cp);
          const cmods = await resolveModifiers(cp.id, choice?.modifierIds ?? [], cp.name);
          unitPrice += (opt?.priceDelta ?? 0) + cmods.reduce((a, m) => a + m.priceDelta, 0);
          line.children.push({ productId: cp.id, variantId: null, name: cp.name, qty: it.qty, unitPrice: 0, taxRate: 0, taxIncluded: true,
            unitCost: r4((await ownCost(cp.id)) + modCost(cmods)), stationKey: cp.station_key, slotName: slot.name, modifiers: cmods, children: [] });
        }
      }
      line.unitPrice = r4(unitPrice);
      line.unitCost = r4(Math.max(unitCost, 0));
      lines.push(line);
    }
    return lines;
  }
}
