/** Estimación local de totales (sin servidor) a partir del menú cacheado. El servidor SIEMPRE recalcula al sincronizar. */
export interface MenuProduct { id: string; name: string; price: number; kind: string; variants: { id: string; name: string; priceDelta: number }[]; comboSlots: { id: string; name: string; defaultProductId: string; options: { productId: string; priceDelta: number }[] }[]; modifierGroupIds: string[]; taxRate?: number }
export interface MenuModifierGroup { id: string; name: string; type: string; minSelect: number; maxSelect: number; modifiers: { id: string; name: string; priceDelta: number }[] }
export interface CartLine { key: string; productId: string; name: string; qty: number; variantId?: string; modifierIds: string[]; comboChoices: { slotId: string; productId: string; modifierIds: string[] }[]; notes?: string; unitPrice: number; modifierLabels: string[] }

export function unitPriceOf(p: MenuProduct, groups: MenuModifierGroup[], sel: { variantId?: string; modifierIds: string[]; comboChoices: CartLine['comboChoices'] }): number {
  let price = p.price + (p.variants.find((v) => v.id === sel.variantId)?.priceDelta ?? 0);
  const mods = new Map(groups.flatMap((g) => g.modifiers.map((m) => [m.id, m] as const)));
  for (const id of sel.modifierIds) price += mods.get(id)?.priceDelta ?? 0;
  for (const c of sel.comboChoices) {
    const slot = p.comboSlots.find((s) => s.id === c.slotId);
    price += slot?.options.find((o) => o.productId === c.productId)?.priceDelta ?? 0;
    for (const id of c.modifierIds) price += mods.get(id)?.priceDelta ?? 0;
  }
  return Math.round(price * 100) / 100;
}
export interface Totals { subtotal: number; discount: number; total: number }
export function totalsOf(lines: CartLine[], discount = 0): Totals {
  const subtotal = Math.round(lines.reduce((a, l) => a + l.unitPrice * l.qty, 0) * 100) / 100;
  const d = Math.min(Math.max(discount, 0), subtotal);
  return { subtotal, discount: d, total: Math.round((subtotal - d) * 100) / 100 };
}
