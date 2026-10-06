import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RetroBadge, RetroButton, RetroInput, RetroModal, RetroSelect, RetroTable, RetroTableCard, RetroTextarea, formatMoney } from '@retroburger/ui';
import { get } from '../../app/api';
import { useGet } from '../../app/hooks';

export function TablePicker({ open, branchId, onClose, onPick }: { open: boolean; branchId: string; onClose: () => void; onPick: (t: any) => void }) {
  const q = useGet<any[]>(['tables', branchId], '/tables', { branchId }, { enabled: open });
  return (
    <RetroModal open={open} onClose={onClose} size="lg" title="🪑 Selecciona una mesa">
      <div className="rb-floor">{(q.data ?? []).filter((t) => t.isActive).map((t) => <RetroTableCard key={t.id} number={t.number} capacity={t.capacity} status={t.status} customer={t.customerName} seconds={t.occupiedSeconds} total={Number(t.currentTotal)} round={t.shape === 'ROUND'} onClick={() => t.status === 'CLEANING' ? undefined : onPick(t)} />)}</div>
      {q.data?.length === 0 && <div className="rb-empty">No hay mesas configuradas. Agrégalas en Configuración → Mesas.</div>}
    </RetroModal>
  );
}

export function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: { id: string; name: string }) => void }) {
  const [text, setText] = useState('');
  const q = useQuery({ queryKey: ['customers-search', text], queryFn: () => get<any[]>('/customers', { q: text, limit: 8 }), enabled: open && text.length >= 2 });
  return (
    <RetroModal open={open} onClose={onClose} title="👤 Cliente">
      <RetroInput label="Buscar por nombre, teléfono o correo" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div style={{ marginTop: 12 }}><RetroTable columns={[{ key: 'name', header: 'Cliente' }, { key: 'phone', header: 'Teléfono' }, { key: 'seg', header: 'Segmento', render: (c) => <RetroBadge tone={c.segment === 'VIP' ? 'warn' : 'neutral'}>{c.segment}</RetroBadge> }]} rows={q.data ?? []} onRowClick={(c) => onPick({ id: c.id, name: c.name })} empty={text.length < 2 ? 'Escribe al menos 2 caracteres' : 'Sin resultados'} /></div>
    </RetroModal>
  );
}

export function NoteDialog({ open, value, onClose, onSave }: { open: boolean; value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return <RetroModal open={open} onClose={onClose} title="📝 Nota de la orden" footer={<RetroButton variant="neon" onClick={() => onSave(v)}>Guardar</RetroButton>}><RetroTextarea value={v} onChange={(e) => setV(e.target.value)} maxLength={300} autoFocus /></RetroModal>;
}

export function DiscountDialog({ open, onClose, onApply, busy }: { open: boolean; onClose: () => void; onApply: (d: { kind: 'PERCENT' | 'FIXED'; value: number; reason: string }) => void; busy?: boolean }) {
  const [kind, setKind] = useState<'PERCENT' | 'FIXED'>('PERCENT'); const [value, setValue] = useState(''); const [reason, setReason] = useState('');
  return (
    <RetroModal open={open} onClose={onClose} size="sm" title="🏷️ Descuento" footer={<RetroButton variant="neon" loading={busy} disabled={!Number(value) || reason.trim().length < 3} onClick={() => onApply({ kind, value: Number(value), reason: reason.trim() })}>Aplicar</RetroButton>}>
      <div className="rb-col">
        <RetroSelect label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as 'PERCENT' | 'FIXED')} options={[{ value: 'PERCENT', label: 'Porcentaje %' }, { value: 'FIXED', label: 'Monto fijo $' }]} />
        <RetroInput label={kind === 'PERCENT' ? 'Porcentaje' : 'Monto'} large inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} />
        <RetroInput label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cliente frecuente, queja, cortesía…" />
        <span className="rb-hint">Descuentos altos piden autorización de un gerente.</span>
      </div>
    </RetroModal>
  );
}

export function SplitDialog({ open, order, onClose, onSplit, busy }: { open: boolean; order: any; onClose: () => void; onSplit: (ids: string[]) => void; busy?: boolean }) {
  const [sel, setSel] = useState<string[]>([]); const [parts, setParts] = useState(2);
  const top = (order?.items ?? []).filter((i: any) => !i.parentItemId && i.status !== 'CANCELLED');
  const total = order?.total ?? 0; const base = Math.floor((total * 100) / parts) / 100;
  return (
    <RetroModal open={open} onClose={onClose} size="lg" title="✂️ Dividir cuenta" footer={<RetroButton variant="neon" loading={busy} disabled={!sel.length || sel.length >= top.length} onClick={() => onSplit(sel)}>Crear cuenta separada ({sel.length})</RetroButton>}>
      <div className="rb-grid rb-grid-2">
        <div><div className="rb-label">Por productos</div><div className="rb-col" style={{ gap: 6 }}>{top.map((i: any) => <label key={i.id} className="rb-check"><input type="checkbox" checked={sel.includes(i.id)} onChange={() => setSel((s) => (s.includes(i.id) ? s.filter((x) => x !== i.id) : [...s, i.id]))} />{i.qty} × {i.name} <span className="rb-end rb-mono">{formatMoney(i.lineTotal)}</span></label>)}</div></div>
        <div><div className="rb-label">Partes iguales</div><div className="rb-row"><RetroInput type="number" min={2} max={20} value={parts} onChange={(e) => setParts(Math.max(2, Math.min(20, Number(e.target.value) || 2)))} /><div><div className="rb-display" style={{ fontSize: '1.4rem' }}>{formatMoney(base)}</div><span className="rb-hint">por persona (la última cubre el residuo). Cobra con pagos parciales.</span></div></div></div>
      </div>
    </RetroModal>
  );
}
