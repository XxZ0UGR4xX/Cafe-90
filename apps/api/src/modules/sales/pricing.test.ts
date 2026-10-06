import { describe, expect, it } from 'vitest';
import { computeTotals, discountCents } from './pricing';

describe('computeTotals', () => {
  it('ejemplo del spec: 129 + 49 + 2×35 = 248 (IVA incluido 16 %)', () => {
    const t = computeTotals([
      { id: 'a', lineCents: 12900, taxRate: 0.16, taxIncluded: true },
      { id: 'b', lineCents: 4900, taxRate: 0.16, taxIncluded: true },
      { id: 'c', lineCents: 7000, taxRate: 0.16, taxIncluded: true }], 0);
    expect(t.subtotal).toBe(24800);
    expect(t.total).toBe(24800);
    expect(t.tax).toBe(3421);  // 24800 - 24800/1.16 ≈ 3420.69 por línea redondeada
  });
  it('impuesto no incluido se suma al total', () => {
    const t = computeTotals([{ id: 'a', lineCents: 10000, taxRate: 0.16, taxIncluded: false }], 0);
    expect(t.tax).toBe(1600);
    expect(t.total).toBe(11600);
  });
  it('descuento prorrateado no pierde centavos y reduce el impuesto', () => {
    const lines = [
      { id: 'a', lineCents: 3333, taxRate: 0.16, taxIncluded: true },
      { id: 'b', lineCents: 3333, taxRate: 0.16, taxIncluded: true },
      { id: 'c', lineCents: 3334, taxRate: 0.16, taxIncluded: true }];
    const t = computeTotals(lines, 1000);
    expect(t.lines.reduce((a, l) => a + l.netCents, 0)).toBe(9000);
    expect(t.total).toBe(9000);
    expect(t.tax).toBeLessThan(computeTotals(lines, 0).tax);
  });
  it('descuento mayor al subtotal se limita', () => {
    expect(computeTotals([{ id: 'a', lineCents: 500, taxRate: 0, taxIncluded: true }], 99999).total).toBe(0);
  });
  it('descuento porcentual y fijo', () => {
    expect(discountCents('PERCENT', 20, 24800)).toBe(4960);
    expect(discountCents('FIXED', 50, 24800)).toBe(5000);
    expect(discountCents('FIXED', 500, 2000)).toBe(2000);
  });
});
