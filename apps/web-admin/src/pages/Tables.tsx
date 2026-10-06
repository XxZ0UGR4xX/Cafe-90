import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroDialog, RetroInput, RetroModal, RetroSelect, RetroStatCard, RetroTableCard, formatMoney, mmss } from '@retroburger/ui';
import { post, del } from '../app/api';
import { useAct, useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { useCart } from './pos/cart';
import { useNavigate } from 'react-router-dom';
import { Async, FormModal, NeedBranch, Row, num } from './common';

export default function Tables() { return <NeedBranch>{(b) => <TablesInner branchId={b} />}</NeedBranch>; }

function TablesInner({ branchId }: { branchId: string }) {
  const q = useGet<any[]>(['tables', branchId], '/tables', { branchId }, { refetchInterval: 30_000 });
  const staff = useGet<any[]>(['users-lite'], '/users', { limit: 200 }, { enabled: useSession.getState().can('identity.user.read') });
  const { can } = useSession(); const nav = useNavigate(); const cart = useCart();
  const [sel, setSel] = useState<any | null>(null); const [mode, setMode] = useState<null | 'open' | 'move' | 'merge' | 'transfer' | 'edit'>(null);
  const [guests, setGuests] = useState('2'); const [target, setTarget] = useState(''); const [merge, setMerge] = useState<string[]>([]); const [edit, setEdit] = useState<any>({});
  const inv = [['tables', branchId]];
  const act = (fn: () => Promise<any>, ok?: string) => useAct(fn, { invalidate: inv, ok, onSuccess: () => { setMode(null); setSel(null); } });
  const open = act(() => post(`/tables/${sel.id}/open`, { guests: num(guests) || 1 }), 'Mesa abierta'); const move = act(() => post(`/tables/${sel.id}/move`, { toTableId: target }), 'Cuenta movida');
  const mergeM = act(() => post(`/tables/${sel.id}/merge`, { tableIds: merge }), 'Mesas unidas'); const transfer = act(() => post(`/tables/${sel.id}/transfer`, { waiterId: target }), 'Mesa transferida');
  const release = act(() => post(`/tables/${sel.id}/release`), 'Mesa liberada'); const clean = act(() => post(`/tables/${sel.id}/clean`), 'Mesa lista 🟢');
  const save = useAct(() => (edit.id ? post(`/branches/${branchId}/tables/${edit.id}`, edit) : post(`/branches/${branchId}/tables`, { ...edit, number: num(edit.number), capacity: num(edit.capacity) || 4 })), { invalidate: inv, onSuccess: () => setMode(null), ok: 'Mesa guardada' });
  const tables = (q.data ?? []).filter((t) => t.isActive);
  const count = (s: string) => tables.filter((t) => t.status === s).length;
  const free = tables.filter((t) => t.status === 'FREE' && t.id !== sel?.id);

  const goPos = () => { cart.set({ channel: 'DINE_IN', tableId: sel.id, tableNumber: sel.number, orderId: null, lines: [] }); void (async () => {
    if (sel.status === 'OCCUPIED') { const { get } = await import('../app/api'); const l = await get<any[]>('/orders', { branchId, tableId: sel.id, status: 'PENDING,CONFIRMED,PREPARING,READY,DELIVERED', limit: 10 }); const o = l.find((x) => x.paymentStatus !== 'PAID'); if (o) cart.set({ orderId: o.id }); }
    nav('/pos'); })(); };

  return (
    <Async q={q}>
      <div className="rb-grid rb-grid-3">
        <RetroStatCard label="Libres" value={count('FREE')} icon="🟢" accent="var(--neon-dark)" /><RetroStatCard label="Ocupadas" value={count('OCCUPIED')} icon="🔴" accent="var(--ketchup)" />
        <RetroStatCard label="Reservadas" value={count('RESERVED')} icon="🟡" accent="var(--mustard)" /><RetroStatCard label="En limpieza" value={count('CLEANING')} icon="🔵" accent="var(--blue)" />
      </div>
      <RetroCard title="🗺️ Mapa del restaurante" actions={can('floor.table.write', branchId) ? <RetroButton size="sm" variant="neon" onClick={() => { setEdit({ capacity: 4, shape: 'SQUARE', x: 0, y: 0, w: 1, h: 1, isActive: true, number: (Math.max(0, ...tables.map((t) => t.number)) + 1) }); setMode('edit'); }}>+ Mesa</RetroButton> : undefined}>
        <div className="rb-floor">{tables.map((t) => <RetroTableCard key={t.id} number={t.number} capacity={t.capacity} status={t.status} customer={t.customerName ?? t.waiterName} seconds={t.occupiedSeconds} total={Number(t.currentTotal)} round={t.shape === 'ROUND'} onClick={() => setSel(t)} extra={t.reservation ? <span className="rb-hint">📅 {t.reservation.customerName}</span> : null} />)}</div>
      </RetroCard>

      <RetroModal open={!!sel && !mode} onClose={() => setSel(null)} title={`Mesa ${sel?.number ?? ''}`} size="sm">
        {sel && <div className="rb-col">
          <div className="rb-row"><RetroBadge tone={sel.status === 'FREE' ? 'ok' : sel.status === 'OCCUPIED' ? 'danger' : sel.status === 'RESERVED' ? 'warn' : 'info'}>{sel.status}</RetroBadge>{sel.status === 'OCCUPIED' && <span className="rb-mono">⏱ {mmss(sel.occupiedSeconds)} · {formatMoney(Number(sel.currentTotal))}</span>}</div>
          {sel.status === 'OCCUPIED' && <div className="rb-hint">Mesero: {sel.waiterName ?? '—'} · {sel.guests} personas</div>}
          {sel.status === 'FREE' && <><RetroButton variant="neon" size="lg" block onClick={() => setMode('open')}>🪑 Abrir mesa</RetroButton><RetroButton variant="mustard" block onClick={goPos}>🍔 Tomar orden</RetroButton></>}
          {sel.status === 'RESERVED' && <><div className="rb-hint">📅 {sel.reservation?.customerName} ({sel.reservation?.partySize})</div><RetroButton variant="neon" block onClick={() => setMode('open')}>Abrir mesa</RetroButton></>}
          {sel.status === 'OCCUPIED' && <>
            <RetroButton variant="mustard" size="lg" block onClick={goPos}>🍔 Ver cuenta / agregar</RetroButton>
            <div className="rb-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <RetroButton variant="white" onClick={() => { setTarget(''); setMode('move'); }}>↪️ Mover</RetroButton><RetroButton variant="white" onClick={() => { setMerge([]); setMode('merge'); }}>🔗 Unir</RetroButton>
              <RetroButton variant="white" onClick={() => { setTarget(''); setMode('transfer'); }}>🔁 Transferir</RetroButton><RetroButton variant="white" loading={release.isPending} onClick={() => release.mutate()}>✅ Liberar</RetroButton>
            </div></>}
          {sel.status === 'CLEANING' && <RetroButton variant="neon" size="lg" block loading={clean.isPending} onClick={() => clean.mutate()}>🧽 Marcar limpia (libre)</RetroButton>}
          {can('floor.table.write', branchId) && <><RetroButton variant="ghost" size="sm" onClick={() => { setEdit(sel); setMode('edit'); }}>✎ Editar mesa</RetroButton>
            {sel.qrToken && <div className="rb-hint" style={{ wordBreak: 'break-all' }}>QR: /m/{sel.qrToken}</div>}</>}
        </div>}
      </RetroModal>

      <FormModal open={mode === 'open'} onClose={() => setMode(null)} title={`Abrir mesa ${sel?.number}`} busy={open.isPending} onSubmit={() => open.mutate()} size="sm"><RetroInput label="Comensales" large type="number" min={1} value={guests} onChange={(e) => setGuests(e.target.value)} autoFocus /></FormModal>
      <FormModal open={mode === 'move'} onClose={() => setMode(null)} title="Mover cuenta a otra mesa" busy={move.isPending} disabled={!target} onSubmit={() => move.mutate()} size="sm"><RetroSelect label="Mesa destino (libre)" value={target} onChange={(e) => setTarget(e.target.value)} options={[{ value: '', label: 'Selecciona…' }, ...free.map((t) => ({ value: t.id, label: `Mesa ${t.number} (${t.capacity})` }))]} /></FormModal>
      <FormModal open={mode === 'merge'} onClose={() => setMode(null)} title="Unir mesas" busy={mergeM.isPending} disabled={!merge.length} onSubmit={() => mergeM.mutate()}><div className="rb-row rb-wrap">{free.map((t) => <RetroButton key={t.id} variant={merge.includes(t.id) ? 'red' : 'white'} onClick={() => setMerge((m) => (m.includes(t.id) ? m.filter((x) => x !== t.id) : [...m, t.id]))}>Mesa {t.number}</RetroButton>)}{free.length === 0 && <span className="rb-muted">No hay mesas libres.</span>}</div></FormModal>
      <FormModal open={mode === 'transfer'} onClose={() => setMode(null)} title="Transferir a otro mesero" busy={transfer.isPending} disabled={!target} onSubmit={() => transfer.mutate()} size="sm"><RetroSelect label="Mesero" value={target} onChange={(e) => setTarget(e.target.value)} options={[{ value: '', label: 'Selecciona…' }, ...(staff.data ?? []).filter((u) => u.status === 'ACTIVE').map((u) => ({ value: u.id, label: u.full_name }))]} /></FormModal>
      <FormModal open={mode === 'edit'} onClose={() => setMode(null)} title={edit.id ? `Editar mesa ${edit.number}` : 'Nueva mesa'} busy={save.isPending} onSubmit={() => save.mutate()}>
        <Row><RetroInput label="Número" type="number" value={edit.number ?? ''} onChange={(e) => setEdit({ ...edit, number: num(e.target.value) })} /><RetroInput label="Capacidad" type="number" value={edit.capacity ?? 4} onChange={(e) => setEdit({ ...edit, capacity: num(e.target.value) })} /></Row>
        <Row><RetroSelect label="Forma" value={edit.shape ?? 'SQUARE'} onChange={(e) => setEdit({ ...edit, shape: e.target.value })} options={[{ value: 'SQUARE', label: 'Cuadrada' }, { value: 'ROUND', label: 'Redonda' }, { value: 'BOOTH', label: 'Cabina' }, { value: 'BAR', label: 'Barra' }]} /><RetroSelect label="Estado" value={String(edit.isActive ?? true)} onChange={(e) => setEdit({ ...edit, isActive: e.target.value === 'true' })} options={[{ value: 'true', label: 'Activa' }, { value: 'false', label: 'Desactivada' }]} /></Row>
        {edit.id && <RetroButton variant="red" size="sm" onClick={() => { void del(`/branches/${branchId}/tables/${edit.id}`).then(() => { setMode(null); void q.refetch(); }); }}>Desactivar mesa</RetroButton>}
      </FormModal>
      <RetroDialog open={false} title="" message="" onConfirm={() => undefined} onCancel={() => undefined} />
    </Async>
  );
}
