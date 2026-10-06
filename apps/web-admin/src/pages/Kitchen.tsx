import { useEffect, useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroKitchenTicket, RetroStatCard, RetroTable, RetroTabs, mmss } from '@retroburger/ui';
import { patch } from '../app/api';
import { useAct, useGet } from '../app/hooks';
import { useArcade } from '../app/idle';
import { NeedBranch } from './common';

const COLS = [{ key: 'NEW', label: '🆕 Nuevos', next: 'PREPARING', action: '▶ Preparar' }, { key: 'PREPARING', label: '🔥 Preparando', next: 'READY', action: '✔ Listo' }, { key: 'READY', label: '🔔 Listos', next: 'DELIVERED', action: '🚚 Entregar' }, { key: 'DELIVERED', label: '✅ Entregados', next: null, action: '' }] as const;
export default function Kitchen() { return <NeedBranch>{(b) => <KitchenInner branchId={b} />}</NeedBranch>; }

function KitchenInner({ branchId }: { branchId: string }) {
  const [tab, setTab] = useState<'kds' | 'metrics'>('kds'); const [station, setStation] = useState<string>('ALL'); const [night, setNight] = useState(true);
  const [now, setNow] = useState(Date.now()); const [t0] = useState(Date.now());
  const block = useArcade((s) => s.block); useEffect(() => block(), [block]);       // KDS nunca se duerme
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const stations = useGet<any[]>(['kitchen', 'stations', branchId], '/kitchen/stations', { branchId });
  const q = useGet<any[]>(['kitchen', 'tickets', branchId, station], '/kitchen/tickets', { branchId, station: station === 'ALL' ? undefined : station }, { refetchInterval: 20_000 });
  const m = useGet<any>(['kitchen', 'metrics', branchId], '/kitchen/metrics', { branchId }, { refetchInterval: 30_000, enabled: tab === 'metrics' });
  const bump = useAct((v: { id: string; to: string }) => patch(`/kitchen/tickets/${v.id}/status`, { to: v.to }), { invalidate: [['kitchen'], ['orders'], ['tables']] });
  const tickets = q.data ?? []; const fetchedAt = q.dataUpdatedAt || t0;
  const live = (t: any) => t.elapsedSeconds + Math.floor((now - fetchedAt) / 1000);
  const slaOf = (t: any) => (live(t) >= 600 ? 'late' : live(t) >= 300 ? 'warn' : 'ok');

  return (
    <div className={night ? 'rb-theme-night' : ''} style={night ? { background: 'var(--cream)', color: 'var(--ink)', margin: -20, padding: 20, minHeight: 'calc(100dvh - 90px)' } : undefined}>
      <div className="rb-row rb-wrap" style={{ marginBottom: 12 }}>
        <RetroTabs value={tab} onChange={setTab} tabs={[{ key: 'kds', label: '👨‍🍳 Pantalla KDS' }, { key: 'metrics', label: '📈 Dashboard cocina' }]} />
        <span className="rb-end rb-row rb-wrap"><RetroButton size="sm" variant={station === 'ALL' ? 'red' : 'white'} onClick={() => setStation('ALL')}>Todas</RetroButton>{(stations.data ?? []).filter((s) => s.isActive).map((s) => <RetroButton key={s.key} size="sm" variant={station === s.key ? 'red' : 'white'} onClick={() => setStation(s.key)}>{s.name}</RetroButton>)}
          <RetroButton size="sm" variant="ink" onClick={() => setNight(!night)}>{night ? '☀️' : '🌙'}</RetroButton></span>
      </div>
      {tab === 'kds' ? (
        <div className="rb-kds">{COLS.map((c) => {
          const list = tickets.filter((t) => t.status === c.key);
          return <div key={c.key} className="rb-kds__col"><div className="rb-kds__head"><span>{c.label}</span><RetroBadge tone="dark">{list.length}</RetroBadge></div>
            <div className="rb-kds__list">{list.map((t) => <div key={t.id}><RetroKitchenTicket t={{ ...t, sla: slaOf(t) }} seconds={live(t)} onClick={c.next ? () => bump.mutate({ id: t.id, to: c.next }) : undefined} actionLabel={c.next ? c.action : undefined} />
              {c.key !== 'NEW' && c.key !== 'DELIVERED' && <RetroButton size="sm" variant="ghost" onClick={() => bump.mutate({ id: t.id, to: c.key === 'READY' ? 'PREPARING' : 'NEW' })}>↩ Deshacer</RetroButton>}</div>)}
              {list.length === 0 && <div className="rb-empty" style={{ padding: 12 }}>—</div>}</div></div>;
        })}</div>
      ) : (
        <div className="rb-col"><div className="rb-grid rb-grid-3">
          <RetroStatCard label="Pedidos pendientes" value={m.data?.pending ?? '—'} icon="🧾" /><RetroStatCard label="Tiempo promedio" value={m.data ? mmss(m.data.avgSeconds) : '—'} icon="⏱" accent="var(--blue)" />
          <RetroStatCard label="Pedido más antiguo" value={m.data ? mmss(m.data.oldestSeconds) : '—'} icon="🕰️" accent="var(--mustard)" /><RetroStatCard label="Retrasados" value={m.data?.delayed ?? '—'} icon="🚨" accent="var(--ketchup)" /></div>
          <RetroCard title="Productos en preparación" tone="plain"><RetroTable rows={m.data?.inPreparation ?? []} columns={[{ key: 'name', header: 'Producto' }, { key: 'qty', header: 'Unidades', numeric: true }]} empty="Nada en preparación" /></RetroCard>
          <RetroCard title="Rendimiento por estación (24 h)" tone="plain"><RetroTable rows={m.data?.perStation ?? []} columns={[{ key: 'station', header: 'Estación' }, { key: 'pending', header: 'Pendientes', numeric: true }, { key: 'completed', header: 'Completados', numeric: true }, { key: 'avg', header: 'Tiempo prom.', numeric: true, render: (r: any) => mmss(r.avgSeconds) }]} /></RetroCard></div>
      )}
    </div>
  );
}
