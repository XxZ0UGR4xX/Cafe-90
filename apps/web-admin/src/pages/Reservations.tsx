import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroInput, RetroSelect, RetroTable } from '@retroburger/ui';
import { post } from '../app/api';
import { useAct, useGet } from '../app/hooks';
import { Async, FormModal, NeedBranch, Row, daysAgo, fmtDay, fmtTime, num, today } from './common';

const ST: Record<string, [any, string]> = { PENDING: ['warn', 'Pendiente'], CONFIRMED: ['info', 'Confirmada'], ARRIVED: ['ok', 'Llegó'], CANCELLED: ['danger', 'Cancelada'], NO_SHOW: ['dark', 'No asistió'] };
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export default function Reservations() { return <NeedBranch>{(b) => <Inner branchId={b} />}</NeedBranch>; }

function Inner({ branchId }: { branchId: string }) {
  const [day, setDay] = useState(today()); const [view, setView] = useState<'day' | 'week'>('day');
  const from = day; const to = view === 'week' ? addDays(day, 6) : day;
  const q = useGet<any[]>(['reservations', branchId, from, to], '/reservations', { branchId, from, to });
  const tables = useGet<any[]>(['tables', branchId], '/tables', { branchId });
  const [f, setF] = useState<any | null>(null);
  const startsAt = f?.date && f?.time ? new Date(`${f.date}T${f.time}:00`).toISOString() : '';
  const avail = useGet<any[]>(['reservations', 'avail', branchId, startsAt, f?.partySize], '/reservations/availability', { branchId, startsAt, partySize: f?.partySize || 2, durationMin: 90 }, { enabled: !!f && !!startsAt });
  const create = useAct(() => post('/reservations', { branchId, customerName: f.name, phone: f.phone || undefined, partySize: num(String(f.partySize)), startsAt, tableId: f.tableId || undefined, notes: f.notes || undefined }), { invalidate: [['reservations'], ['tables']], ok: '📅 Reservación creada', onSuccess: () => setF(null) });
  const act = useAct((v: { id: string; a: string }) => post(`/reservations/${v.id}/${v.a}`), { invalidate: [['reservations'], ['tables']], ok: 'Reservación actualizada' });
  const rows = q.data ?? [];
  const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => addDays(day, i));
  return (
    <>
      <div className="rb-row rb-wrap"><RetroButton size="sm" variant="white" onClick={() => setDay(addDays(day, view === 'week' ? -7 : -1))}>◀</RetroButton><input className="rb-input" style={{ width: 160 }} type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Fecha" /><RetroButton size="sm" variant="white" onClick={() => setDay(addDays(day, view === 'week' ? 7 : 1))}>▶</RetroButton><RetroButton size="sm" variant="mustard" onClick={() => setDay(today())}>Hoy</RetroButton>
        <RetroButton size="sm" variant={view === 'day' ? 'red' : 'white'} onClick={() => setView('day')}>Día</RetroButton><RetroButton size="sm" variant={view === 'week' ? 'red' : 'white'} onClick={() => setView('week')}>Semana</RetroButton>
        <span className="rb-end"><RetroButton variant="neon" onClick={() => setF({ name: '', partySize: 2, date: day, time: '20:00' })}>+ Reservación</RetroButton></span></div>
      <Async q={q}><div className={view === 'week' ? 'rb-grid' : ''} style={view === 'week' ? { gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' } : undefined}>
        {days.map((d) => { const list = rows.filter((r) => r.startsAt.slice(0, 10) === d || new Date(r.startsAt).toLocaleDateString('en-CA') === d); return (
          <RetroCard key={d} title={`📅 ${fmtDay(d + 'T12:00:00')} · ${list.length}`} tone={d === today() ? 'red' : 'mustard'} flush>
            {view === 'day' ? <RetroTable rows={list} columns={[{ key: 't', header: 'Hora', render: (r: any) => <strong>{fmtTime(r.startsAt)}</strong> }, { key: 'n', header: 'Cliente', render: (r: any) => <>{r.customerName}<div className="rb-hint">{r.phone}</div></> }, { key: 'p', header: 'Personas', numeric: true, render: (r: any) => r.partySize }, { key: 'm', header: 'Mesa', render: (r: any) => r.tableNumber ?? '—' }, { key: 's', header: 'Estado', render: (r: any) => <RetroBadge tone={ST[r.status]![0]}>{ST[r.status]![1]}</RetroBadge> }, { key: 'nt', header: 'Notas', render: (r: any) => r.notes ?? '' },
              { key: 'a', header: '', render: (r: any) => <span className="rb-row rb-wrap">{r.status === 'PENDING' && <RetroButton size="sm" variant="neon" onClick={() => act.mutate({ id: r.id, a: 'confirm' })}>Confirmar</RetroButton>}{['PENDING', 'CONFIRMED'].includes(r.status) && <><RetroButton size="sm" variant="mustard" onClick={() => act.mutate({ id: r.id, a: 'arrive' })}>Llegó</RetroButton><RetroButton size="sm" variant="ghost" onClick={() => act.mutate({ id: r.id, a: 'no-show' })}>No asistió</RetroButton><RetroButton size="sm" variant="ghost" onClick={() => act.mutate({ id: r.id, a: 'cancel' })}>Cancelar</RetroButton></>}</span> }]} empty="Sin reservaciones" />
              : <div className="rb-col" style={{ padding: 10, gap: 6 }}>{list.map((r) => <div key={r.id} className="rb-row"><strong>{fmtTime(r.startsAt)}</strong><span className="rb-grow">{r.customerName} ({r.partySize})</span><RetroBadge tone={ST[r.status]![0]}>{r.tableNumber ? `M${r.tableNumber}` : '—'}</RetroBadge></div>)}{list.length === 0 && <span className="rb-muted">—</span>}</div>}
          </RetroCard>); })}</div></Async>
      <FormModal open={!!f} onClose={() => setF(null)} title="Nueva reservación" busy={create.isPending} disabled={!f?.name || !startsAt} onSubmit={() => create.mutate()}>{f && <>
        <Row><RetroInput label="Cliente" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroInput label="Teléfono" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Row>
        <Row><RetroInput label="Fecha" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /><RetroInput label="Hora" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Row>
        <Row><RetroInput label="Personas" type="number" min={1} value={f.partySize} onChange={(e) => setF({ ...f, partySize: e.target.value })} /><RetroSelect label="Mesa (disponibles en ese horario)" value={f.tableId ?? ''} onChange={(e) => setF({ ...f, tableId: e.target.value })} options={[{ value: '', label: 'Asignar después' }, ...(avail.data ?? []).map((t) => ({ value: t.id, label: `Mesa ${t.number} (${t.capacity})` }))]} /></Row>
        <RetroInput label="Notas" value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Cumpleaños, silla para bebé…" /></>}</FormModal>
      <span className="rb-hint">{(tables.data ?? []).length} mesas en la sucursal. Al marcar “Llegó” la mesa se abre automáticamente. {daysAgo(0).slice(0, 0)}</span>
    </>
  );
}
