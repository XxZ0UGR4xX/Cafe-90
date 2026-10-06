import { useState } from 'react';
import { RetroButton, RetroCard, RetroCheck, RetroInput, RetroSelect, RetroTable } from '@retroburger/ui';
import { post, put } from '../app/api';
import { useAct, useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { Async, FormModal, Row, num } from './common';

export default function Loyalty() {
  const { can } = useSession(); const prog = useGet<any>(['loyalty', 'program'], '/loyalty/program'); const rewards = useGet<any[]>(['loyalty', 'rewards'], '/loyalty/rewards'); const products = useGet<any[]>(['catalog', 'products'], '/products', { limit: 500 });
  const [p, setP] = useState<any | null>(null); const [r, setR] = useState<any | null>(null);
  const saveP = useAct(() => put('/loyalty/program', { isActive: p.isActive, currencyPerPoint: num(String(p.currencyPerPoint)), levels: p.levels.map((l: any) => ({ name: l.name, min: Math.round(num(String(l.min))) })), expiryDays: p.expiryDays ? num(String(p.expiryDays)) : null }), { invalidate: [['loyalty']], ok: 'Reglas actualizadas ⭐', onSuccess: () => setP(null) });
  const saveR = useAct(() => { const b = { name: r.name, pointsCost: Math.round(num(String(r.pointsCost))), productId: r.productId || null, isActive: r.isActive ?? true }; return r.id ? put(`/loyalty/rewards/${r.id}`, b) : post('/loyalty/rewards', b); }, { invalidate: [['loyalty']], ok: 'Recompensa guardada', onSuccess: () => setR(null) });
  const w = can('loyalty.rule.write');
  return (
    <>
      <Async q={prog}>{prog.data && <RetroCard title="⭐ Reglas del programa" actions={w && <RetroButton size="sm" variant="neon" onClick={() => setP({ ...prog.data })}>Editar</RetroButton>}>
        <div className="rb-col"><div>Cada <strong>${prog.data.currencyPerPoint}</strong> gastados = <strong>1 punto</strong> {prog.data.isActive ? '✅' : '⛔ (programa desactivado)'}</div>
          <div className="rb-row rb-wrap">{prog.data.levels.map((l: any) => <span key={l.name} className="rb-badge">{l.name} ≥ {l.min} pts</span>)}</div></div></RetroCard>}</Async>
      <RetroCard title="🎁 Recompensas canjeables" tone="red" actions={w && <RetroButton size="sm" variant="neon" onClick={() => setR({ name: '', pointsCost: 100, isActive: true })}>+ Recompensa</RetroButton>}>
        <RetroTable rows={rewards.data ?? []} onRowClick={w ? setR : undefined} columns={[{ key: 'name', header: 'Recompensa' }, { key: 'p', header: 'Producto', render: (x: any) => x.product ?? '—' }, { key: 'c', header: 'Puntos', numeric: true, render: (x: any) => x.pointsCost }, { key: 'a', header: 'Activa', render: (x: any) => (x.isActive ? '✅' : '⛔') }]} /></RetroCard>
      <span className="rb-hint">El canje se aplica desde el POS: el cliente se asocia a la orden y se otorga el producto como descuento. Las cancelaciones devuelven los puntos.</span>
      <FormModal open={!!p} onClose={() => setP(null)} title="Reglas de lealtad" busy={saveP.isPending} onSubmit={() => saveP.mutate()}>{p && <><RetroInput label="Pesos por punto" inputMode="decimal" value={p.currencyPerPoint} onChange={(e) => setP({ ...p, currencyPerPoint: e.target.value })} /><RetroInput label="Vigencia de puntos (días, opcional)" type="number" value={p.expiryDays ?? ''} onChange={(e) => setP({ ...p, expiryDays: e.target.value })} /><RetroCheck label="Programa activo" checked={p.isActive} onChange={(e) => setP({ ...p, isActive: e.target.checked })} />
        <div className="rb-label">Niveles</div>{p.levels.map((l: any, i: number) => <Row key={i}><RetroInput value={l.name} onChange={(e) => setP({ ...p, levels: p.levels.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value.toUpperCase() } : x)) })} /><RetroInput type="number" value={l.min} onChange={(e) => setP({ ...p, levels: p.levels.map((x: any, j: number) => (j === i ? { ...x, min: e.target.value } : x)) })} /></Row>)}</>}</FormModal>
      <FormModal open={!!r} onClose={() => setR(null)} title="Recompensa" size="sm" busy={saveR.isPending} disabled={!r?.name} onSubmit={() => saveR.mutate()}>{r && <><RetroInput label="Nombre" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /><RetroInput label="Costo en puntos" type="number" value={r.pointsCost} onChange={(e) => setR({ ...r, pointsCost: e.target.value })} /><RetroSelect label="Producto gratis" value={r.productId ?? ''} onChange={(e) => setR({ ...r, productId: e.target.value })} options={[{ value: '', label: 'Cualquiera (el más caro del pedido)' }, ...(products.data ?? []).map((x) => ({ value: x.id, label: x.name }))]} /><RetroCheck label="Activa" checked={r.isActive ?? true} onChange={(e) => setR({ ...r, isActive: e.target.checked })} /></>}</FormModal>
    </>
  );
}
