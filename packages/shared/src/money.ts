/**
 * Dinero en centavos (enteros) para evitar errores de coma flotante.
 * En BD se guarda numeric(14,4); la conversión vive aquí y en los repositorios.
 */
export type Cents = number;

export const toCents = (amount: number | string): Cents => Math.round(Number(amount) * 100);
export const fromCents = (c: Cents): number => c / 100;

/** Redondeo bancario NO usado: se redondea half-up al centavo (configurable en fase fiscal). */
export const pct = (base: Cents, rate: number): Cents => Math.round(base * rate);

export function formatMoney(c: Cents, currency = 'MXN', locale = 'es-MX'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(c / 100);
}

/** Reparte un total en N partes sin perder centavos (para dividir cuenta). */
export function splitCents(total: Cents, parts: number): Cents[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error('parts must be >= 1');
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
}
