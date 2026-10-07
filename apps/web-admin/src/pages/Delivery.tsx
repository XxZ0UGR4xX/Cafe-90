import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroInput, RetroSelect, formatMoney2 } from '@retroburger/ui';
import { post } from '../app/api';
import { useAct, useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { useWithSupervisor } from '../app/supervisor';
import { Async, FormModal, NeedBranch, Row, fmtTime, num } from './common';

const COLS: [string, string][] = [['RECEIVED', '📥 Recibido'], ['CONFIRMED', '✅ Confirmado'], ['PREPARING', '🔥 Preparando'], ['READY', '🔔 Listo'], ['ON_THE_WAY', '🛵 En camino'], ['DELIVERED', '🏁 Entregado'], ['CANCELLED', '🚫 Cancelado']];
const NEXT: Record<string, string> = { RECEIVED: 'CONFIRMED', READY: 'ON_THE_WAY', ON_THE_WAY: 'DELIVERED' };
export default function Delivery() { return <NeedBranch>{(b) => <Inner branchId={b} />}</NeedBranch>; }

function Inner({ branchId }: { branchId: string }) {
  const { can } = useSession(); const staff = can('delivery.order.read', branchId); const withSup = useWithSupervisor();
  const q = useGet<any[]>(['delivery', branchId, staff], staff ? '/delivery-orders' : '/delivery-orders/mine', { branchId }, { refetchInterval: 30_000 });
  const menu = useGet<any>(['menu', branchId], '/menu', { branchId }, { enabled: staff }); const users = useGet<any[]>(['users-drivers'], '/users', { limit: 200 }, { enabled: can('identity.user.read') });
  const [f, setF] = useState<any | null>(null);
  const drivers = (users.data ?? []).filter((u) => u.status === 'ACTIVE' && u.roles.some((r: any) => r.role === 'REPARTIDOR'));
  const create = useAct(() => post('/delivery-orders', { branchId, customerName: f.name, phone: f.phone, address: f.address, addressNotes: f.addressNotes || undefined, fee: num(String(f.fee ?? 0)), paymentMethod: f.paymentMethod, notes: f.notes || undefined, clientUuid: crypto.randomUUID(), items: f.items.map((i: any) => ({ productId: i.productId, qty: i.qty, modifierIds: [], comboChoices: [] })) }), { invalidate: [['delivery'], ['orders']], ok: '🛵 Pedido registrado', onSuccess: () => setF(null) });
  const move = useAct((v: { id: string; to: string; reason?: string }) => withSup(() => post(`/delivery-orders/${v.id}/status`, { to: v.to, reason: v.reason })), { invalidate: [['delivery'], ['orders'], ['kitchen']] });
  const assign = useAct((v: { id: string; driverId: string }) => post(`/delivery-orders/${v.id}/assign`, { driverId: v.driverId }), { invalidate: [['delivery']], ok: 'Repartidor asignado' });
  const rows = q.data ?? []; const simple = (menu.data?.products ?? []).filter((p: any) => p.kind === 'SIMPLE' || p.kind === 'COMBO');
  const total = f ? f.items.reduce((a: number, i: any) => a + (simple.find((p: any) => p.id === i.productId)?.price ?? 0) * i.qty, 0) + num(String(f.fee ?? 0)) : 0;
  return (
    <>
      {staff && <div className="rb-row"><RetroButton variant="neon" onClick={() => setF({ name: '', phone: '', address: '', fee: 30, paymentMethod: 'CASH', items: [] })}>+ Pedido a domicilio</RetroButton></div>}
      <Async q={q}><div className="rb-kds" tabIndex={0} role="region" aria-label="Tablero de pedidos a domicilio (desplazable con el teclado)" style={{ gridTemplateColumns: `repeat(${staff ? 7 : 3}, minmax(250px, 1fr))` }}>{COLS.filter(([k]) => staff || ['READY', 'ON_THE_WAY', 'DELIVERED'].includes(k)).map(([k, label]) => {
        const list = rows.filter((r) => r.status === k);
        return <div key={k} className="rb-kds__col"><div className="rb-kds__head"><span>{label}</span><RetroBadge tone="dark">{list.length}</RetroBadge></div><div className="rb-kds__list">{list.map((d) => (
          <RetroCard key={d.id} title={`#${String(d.number).padStart(4, '0')} · ${d.customerName}`} tone="plain"><div className="rb-col" style={{ gap: 6 }}>
            <span>📍 {d.address}{d.addressNotes ? ` (${d.addressNotes})` : ''}</span><span>📞 {d.phone}</span><div className="rb-row"><strong className="rb-mono">{formatMoney2(d.total)}</strong><RetroBadge tone={d.paymentStatus === 'PAID' ? 'ok' : 'warn'}>{d.paymentStatus === 'PAID' ? 'Pagado' : `Cobrar ${d.paymentMethod}`}</RetroBadge></div>
            <span className="rb-hint">{fmtTime(d.createdAt)} · 🛵 {d.driverName ?? 'sin repartidor'}</span>
            {staff && !['DELIVERED', 'CANCELLED'].includes(d.status) && <RetroSelect aria-label="Repartidor" value={d.driverId ?? ''} onChange={(e) => assign.mutate({ id: d.id, driverId: e.target.value })} options={[{ value: '', label: 'Asignar repartidor…' }, ...drivers.map((u) => ({ value: u.id, label: u.full_name }))]} />}
            <div className="rb-row rb-wrap">{NEXT[d.status] && <RetroButton size="sm" variant="neon" onClick={() => move.mutate({ id: d.id, to: NEXT[d.status]! })}>{NEXT[d.status] === 'ON_THE_WAY' ? 'Salir a entregar' : NEXT[d.status] === 'DELIVERED' ? 'Entregado' : 'Confirmar'}</RetroButton>}{staff && !['DELIVERED', 'CANCELLED', 'ON_THE_WAY'].includes(d.status) && <RetroButton size="sm" variant="ghost" onClick={() => { const reason = prompt('Motivo de la cancelación'); if (reason) move.mutate({ id: d.id, to: 'CANCELLED', reason }); }}>Cancelar</RetroButton>}</div></div></RetroCard>))}{list.length === 0 && <div className="rb-empty" style={{ padding: 10 }}>—</div>}</div></div>;
      })}</div></Async>
      <FormModal open={!!f} onClose={() => setF(null)} title="Pedido a domicilio" size="lg" busy={create.isPending} disabled={!f?.name || !f?.phone || !f?.address || !f?.items?.length} onSubmit={() => create.mutate()}>{f && <>
        <Row><RetroInput label="Cliente" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroInput label="Teléfono" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Row>
        <RetroInput label="Dirección" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /><Row><RetroInput label="Referencias" value={f.addressNotes ?? ''} onChange={(e) => setF({ ...f, addressNotes: e.target.value })} /><RetroInput label="Cargo de envío" inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></Row>
        <RetroSelect label="Pago" value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })} options={[{ value: 'CASH', label: 'Efectivo contra entrega' }, { value: 'CARD', label: 'Tarjeta contra entrega' }, { value: 'TRANSFER', label: 'Transferencia' }, { value: 'PAID', label: 'Ya pagado' }]} />
        <div className="rb-label">Productos</div><div className="rb-row rb-wrap">{simple.filter((p: any) => p.available).map((p: any) => <RetroButton key={p.id} size="sm" variant="white" onClick={() => setF({ ...f, items: f.items.some((i: any) => i.productId === p.id) ? f.items.map((i: any) => (i.productId === p.id ? { ...i, qty: i.qty + 1 } : i)) : [...f.items, { productId: p.id, qty: 1 }] })}>{p.name} {formatMoney2(p.price)}</RetroButton>)}</div>
        {f.items.map((i: any) => <div key={i.productId} className="rb-row"><span className="rb-grow">{simple.find((p: any) => p.id === i.productId)?.name}</span><RetroButton size="sm" variant="white" onClick={() => setF({ ...f, items: f.items.map((x: any) => (x.productId === i.productId ? { ...x, qty: x.qty - 1 } : x)).filter((x: any) => x.qty > 0) })}>−</RetroButton><strong>{i.qty}</strong><RetroButton size="sm" variant="white" onClick={() => setF({ ...f, items: f.items.map((x: any) => (x.productId === i.productId ? { ...x, qty: x.qty + 1 } : x)) })}>+</RetroButton></div>)}
        <div className="rb-display" style={{ fontSize: '1.3rem' }}>Total estimado: {formatMoney2(total)}</div></>}</FormModal>
    </>
  );
}
