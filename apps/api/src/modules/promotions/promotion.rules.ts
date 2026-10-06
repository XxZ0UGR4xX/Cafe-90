/** Reglas puras del motor de promociones (sin BD) — probadas unitariamente. */
export interface Schedule { days?: number[]; from?: string; to?: string }
export interface LineForPromo { productId: string; categoryId: string | null; unitPrice: number; qty: number; lineTotal: number }

/** ¿Está vigente según día de la semana (0=domingo) y hora local "HH:MM"? Soporta rangos que cruzan medianoche. */
export function inSchedule(s: Schedule | null | undefined, dow: number, hhmm: string): boolean {
  if (!s) return true;
  if (s.days?.length && !s.days.includes(dow)) return false;
  if (s.from && s.to) {
    return s.from <= s.to ? hhmm >= s.from && hhmm <= s.to : hhmm >= s.from || hhmm <= s.to;
  }
  return true;
}

const matches = (l: LineForPromo, productIds?: string[], categoryIds?: string[]) =>
  (!productIds?.length && !categoryIds?.length) || !!productIds?.includes(l.productId) || (!!l.categoryId && !!categoryIds?.includes(l.categoryId));

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 2×1: de cada 2 unidades coincidentes, la más barata es gratis. */
export function bogoDiscount(lines: LineForPromo[], productIds?: string[], categoryIds?: string[]): number {
  const units: number[] = [];
  for (const l of lines) if (matches(l, productIds, categoryIds)) for (let i = 0; i < l.qty; i++) units.push(l.unitPrice);
  units.sort((a, b) => a - b);
  const free = Math.floor(units.length / 2);
  return r2(units.slice(0, free).reduce((a, b) => a + b, 0));
}

export function percentDiscount(lines: LineForPromo[], percent: number, productIds?: string[], categoryIds?: string[]): number {
  return r2(lines.filter((l) => matches(l, productIds, categoryIds)).reduce((a, l) => a + (l.lineTotal * percent) / 100, 0));
}

export function freeProductDiscount(lines: LineForPromo[], freeProductId: string): number {
  const l = lines.find((x) => x.productId === freeProductId);
  return l ? r2(l.unitPrice) : 0;
}
