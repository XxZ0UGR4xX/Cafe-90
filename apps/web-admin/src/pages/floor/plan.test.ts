import { describe, expect, it } from 'vitest';
import { canPlace, canvasSize, firstFree, overlaps, snap } from './plan';

const t = (id: string, x: number, y: number, w = 1, h = 1) => ({ id, x, y, w, h });

describe('plano del restaurante', () => {
  it('overlaps: bordes que se tocan NO se encima; compartir una celda sí', () => {
    expect(overlaps(t('a', 0, 0), t('b', 1, 0))).toBe(false);
    expect(overlaps(t('a', 0, 0), t('b', 0, 0))).toBe(true);
    expect(overlaps(t('a', 0, 0, 2, 2), t('b', 1, 1))).toBe(true);
    expect(overlaps(t('a', 0, 0, 2, 2), t('b', 2, 0))).toBe(false);
  });
  it('canPlace: libre, ocupado, sobre sí misma, fuera de límites y mesas grandes', () => {
    const all = [t('a', 0, 0), t('b', 2, 0), t('c', 0, 2, 2, 2)];
    expect(canPlace(all, all[0]!, 1, 0)).toBe(true);
    expect(canPlace(all, all[0]!, 2, 0)).toBe(false);          // ocupada por b
    expect(canPlace(all, all[0]!, 0, 0)).toBe(true);           // su propio lugar
    expect(canPlace(all, all[0]!, -1, 0)).toBe(false);
    expect(canPlace(all, all[0]!, 1, 2)).toBe(false);          // c ocupa 2×2
    expect(canPlace(all, all[2]!, 1, 0)).toBe(false);          // 2×2 en (1,0) pisa a b en (2,0)
    expect(canPlace(all, all[2]!, 3, 2)).toBe(true);
  });
  it('snap redondea a la celda más cercana y nunca baja de 0', () => {
    expect(snap(0, 96)).toBe(0); expect(snap(47, 96)).toBe(0); expect(snap(49, 96)).toBe(1); expect(snap(200, 96)).toBe(2); expect(snap(-80, 96)).toBe(0);
  });
  it('firstFree recorre por filas y respeta tamaños', () => {
    expect(firstFree([])).toEqual({ x: 0, y: 0 });
    expect(firstFree([t('a', 0, 0), t('b', 1, 0)])).toEqual({ x: 2, y: 0 });
    expect(firstFree(Array.from({ length: 10 }, (_, i) => t(String(i), i, 0)))).toEqual({ x: 0, y: 1 });
    expect(firstFree([t('a', 1, 0)], 2, 1, 4)).toEqual({ x: 2, y: 0 });
  });
  it('canvasSize crece con las mesas y tiene mínimo', () => {
    expect(canvasSize([])).toEqual({ cols: 10, rows: 6 });
    expect(canvasSize([t('a', 14, 8, 2, 2)])).toEqual({ cols: 17, rows: 11 });
  });
});
