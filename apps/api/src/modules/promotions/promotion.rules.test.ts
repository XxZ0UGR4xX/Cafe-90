import { describe, expect, it } from 'vitest';
import { bogoDiscount, freeProductDiscount, inSchedule, percentDiscount } from './promotion.rules';

const L = (productId: string, unitPrice: number, qty: number, categoryId: string | null = null) => ({ productId, categoryId, unitPrice, qty, lineTotal: unitPrice * qty });

describe('inSchedule (Happy Hour lunes a viernes 17:00-19:00)', () => {
  const hh = { days: [1, 2, 3, 4, 5], from: '17:00', to: '19:00' };
  it('dentro de horario', () => expect(inSchedule(hh, 3, '17:30')).toBe(true));
  it('fuera de horario', () => expect(inSchedule(hh, 3, '19:01')).toBe(false));
  it('fin de semana', () => expect(inSchedule(hh, 6, '18:00')).toBe(false));
  it('rango que cruza medianoche', () => { const n = { from: '22:00', to: '02:00' }; expect(inSchedule(n, 1, '23:30')).toBe(true); expect(inSchedule(n, 1, '01:00')).toBe(true); expect(inSchedule(n, 1, '12:00')).toBe(false); });
  it('sin horario siempre vigente', () => expect(inSchedule(null, 0, '03:00')).toBe(true));
});

describe('descuentos', () => {
  it('2×1: la más barata de cada par es gratis', () => expect(bogoDiscount([L('a', 129, 2), L('b', 99, 1)])).toBe(99));
  it('2×1 con una sola unidad no descuenta', () => expect(bogoDiscount([L('a', 129, 1)])).toBe(0));
  it('2×1 limitado a productos', () => expect(bogoDiscount([L('a', 100, 2), L('b', 50, 2)], ['b'])).toBe(50));
  it('20 % en bebidas (por categoría)', () => expect(percentDiscount([L('a', 129, 1, 'c1'), L('b', 35, 2, 'c2')], 20, undefined, ['c2'])).toBe(14));
  it('producto gratis', () => expect(freeProductDiscount([L('p', 49, 1)], 'p')).toBe(49));
});
