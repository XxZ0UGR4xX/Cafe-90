/** Geometría del plano del restaurante (unidades de cuadrícula). Funciones puras, probadas aparte del componente. */
export interface Cell { id: string; x: number; y: number; w: number; h: number }

export const overlaps = (a: Cell, b: Cell) => !(a.x >= b.x + b.w || a.x + a.w <= b.x || a.y >= b.y + b.h || a.y + a.h <= b.y);

/** ¿Puede `moving` ocupar (x, y) sin encimarse con otra mesa? (las demás se pasan completas; se ignora a sí misma) */
export const canPlace = (all: Cell[], moving: Cell, x: number, y: number, maxX = 60, maxY = 60) =>
  x >= 0 && y >= 0 && x <= maxX && y <= maxY && !all.some((o) => o.id !== moving.id && overlaps({ ...moving, x, y }, o));

/** Celda de cuadrícula más cercana a una posición en píxeles (esquina superior izquierda). */
export const snap = (px: number, cell: number) => Math.max(0, Math.round(px / cell));

/** Primer lugar libre (recorriendo por filas) para una mesa nueva de w×h dentro de `cols` columnas. */
export function firstFree(all: Cell[], w = 1, h = 1, cols = 10): { x: number; y: number } {
  for (let y = 0; y < 60; y++) for (let x = 0; x + w <= cols; x++) if (!all.some((o) => overlaps({ id: '', x, y, w, h }, o))) return { x, y };
  return { x: 0, y: 0 };
}

/** Dimensiones del lienzo: lo que ocupan las mesas más un margen, con un mínimo. */
export function canvasSize(all: Cell[], minCols = 10, minRows = 6) {
  return { cols: Math.max(minCols, ...all.map((c) => c.x + c.w + 1)), rows: Math.max(minRows, ...all.map((c) => c.y + c.h + 1)) };
}
