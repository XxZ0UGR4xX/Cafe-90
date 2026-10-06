/**
 * Cálculo de totales de una orden (función pura, sin BD). Trabaja en CENTAVOS enteros.
 *  - Precio con impuesto incluido: el impuesto se desglosa del precio.
 *  - Precio sin impuesto: el impuesto se suma.
 *  - El descuento se prorratea sobre las líneas (conserva el desglose de impuestos correcto).
 */
export interface PricedLine { id: string; lineCents: number; taxRate: number; taxIncluded: boolean }
export interface Totals {
  subtotal: number;       // suma de líneas (antes de descuento e impuestos añadidos)
  discount: number;
  tax: number;
  total: number;          // subtotal - descuento + impuestos no incluidos (sin propina)
  lines: { id: string; netCents: number; taxCents: number }[];
}

const toC = (n: number) => Math.round(n * 100);

export function computeTotals(lines: PricedLine[], discountCents: number): Totals {
  const subtotal = lines.reduce((a, l) => a + l.lineCents, 0);
  const discount = Math.max(0, Math.min(discountCents, subtotal));
  const out: Totals['lines'] = [];
  let allocated = 0;
  let tax = 0;
  let add = 0; // impuesto que se suma al total (precios sin impuesto)
  lines.forEach((l, idx) => {
    // prorrateo del descuento; la última línea absorbe el residuo de redondeo
    const share = subtotal === 0 ? 0 : idx === lines.length - 1 ? discount - allocated : Math.round((discount * l.lineCents) / subtotal);
    allocated += share;
    const eff = l.lineCents - share;
    const taxCents = l.taxIncluded ? eff - Math.round(eff / (1 + l.taxRate)) : Math.round(eff * l.taxRate);
    out.push({ id: l.id, netCents: eff, taxCents });
    tax += taxCents;
    if (!l.taxIncluded) add += taxCents;
  });
  return { subtotal, discount, tax, total: subtotal - discount + add, lines: out };
}

export const centsToAmount = (c: number) => c / 100;
export const amountToCents = toC;

/** Calcula la parte del descuento dada su clase. */
export function discountCents(kind: 'PERCENT' | 'FIXED', value: number, subtotalCents: number): number {
  if (kind === 'PERCENT') return Math.round((subtotalCents * Math.min(Math.max(value, 0), 100)) / 100);
  return Math.min(toC(value), subtotalCents);
}
