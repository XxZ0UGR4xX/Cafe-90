import { useRef, useState } from 'react';
import { type Cell, canPlace, canvasSize, snap } from './plan';

const CELL = 104;      // px por celda de la cuadrícula
const GAP = 8;
const ICON: Record<string, string> = { FREE: '🟢', OCCUPIED: '🔴', RESERVED: '🟡', CLEANING: '🔵' };
const LABEL: Record<string, string> = { FREE: 'Libre', OCCUPIED: 'Ocupada', RESERVED: 'Reservada', CLEANING: 'Limpieza' };

export interface PlanTable extends Cell { number: number; capacity: number; status: string; shape?: string; customer?: string | null }

/**
 * Plano del restaurante. En modo normal es un mapa de estado (clic = abrir la mesa). En modo edición las mesas se arrastran
 * con ratón/dedo (se ajustan a la cuadrícula) o con las flechas del teclado; si el lugar está ocupado la mesa vuelve a su sitio.
 */
export function FloorPlan({ tables, editable, onSelect, onMove, onBlocked }: {
  tables: PlanTable[]; editable: boolean; onSelect: (t: PlanTable) => void;
  onMove: (t: PlanTable, x: number, y: number) => void; onBlocked: (t: PlanTable) => void;
}) {
  const { cols, rows } = canvasSize(tables);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; ox: number; oy: number } | null>(null);
  const start = useRef<{ px: number; py: number; moved: boolean } | null>(null);

  const finish = (t: PlanTable, nx: number, ny: number) => {
    if (nx === t.x && ny === t.y) return;
    if (canPlace(tables, t, nx, ny)) onMove(t, nx, ny); else onBlocked(t);
  };

  return (
    <div className="rb-plan-scroll"><div className="rb-plan" data-editing={editable} role="group" aria-label="Plano del restaurante"
      style={{ width: cols * CELL + GAP, height: rows * CELL + GAP, backgroundSize: `${CELL}px ${CELL}px` }}>
      {tables.map((t) => {
        const dragging = drag?.id === t.id;
        const left = dragging ? drag.ox + drag.dx : t.x * CELL + GAP; const top = dragging ? drag.oy + drag.dy : t.y * CELL + GAP;
        const nx = dragging ? snap(left - GAP, CELL) : t.x; const ny = dragging ? snap(top - GAP, CELL) : t.y;
        const ok = !dragging || canPlace(tables, t, nx, ny);
        return (
          <button key={t.id} type="button" className="rb-plan__table" data-status={t.status} data-round={t.shape === 'ROUND'} data-dragging={dragging} data-blocked={!ok}
            data-testid={`plan-table-${t.number}`} style={{ left, top, width: t.w * CELL - GAP, height: t.h * CELL - GAP, touchAction: editable ? 'none' : undefined, cursor: editable ? 'grab' : 'pointer' }}
            aria-label={`Mesa ${t.number}, ${LABEL[t.status] ?? t.status}${editable ? `, posición ${t.x + 1},${t.y + 1}. Flechas para mover.` : ''}`}
            onPointerDown={(e) => { if (!editable) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); start.current = { px: e.clientX, py: e.clientY, moved: false }; setDrag({ id: t.id, dx: 0, dy: 0, ox: t.x * CELL + GAP, oy: t.y * CELL + GAP }); }}
            onPointerMove={(e) => { if (!editable || !start.current || !dragging) return; const dx = e.clientX - start.current.px, dy = e.clientY - start.current.py; if (Math.abs(dx) + Math.abs(dy) > 4) start.current.moved = true; setDrag({ ...drag, dx, dy }); }}
            onPointerUp={() => { if (!editable || !start.current) return; const moved = start.current.moved; start.current = null; const d = drag; setDrag(null); if (moved && d) finish(t, snap(d.ox + d.dx - GAP, CELL), snap(d.oy + d.dy - GAP, CELL)); else if (!moved) onSelect(t); }}
            onPointerCancel={() => { start.current = null; setDrag(null); }}
            onClick={() => { if (!editable) onSelect(t); }}
            onKeyDown={(e) => {
              if (!editable) return;
              const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
              if (d) { e.preventDefault(); finish(t, Math.max(0, t.x + d[0]), Math.max(0, t.y + d[1])); }
            }}>
            <span className="num">{t.number}</span>
            <span className="rb-hint">👥 {t.capacity}</span>
            <span className="st">{ICON[t.status]} {LABEL[t.status]}</span>
            {t.customer && <span className="who">{t.customer}</span>}
          </button>
        );
      })}
    </div></div>
  );
}
