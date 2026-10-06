import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroInput, RetroModal, RetroTable } from '@retroburger/ui';
import { useGet } from '../app/hooks';
import { Async, daysAgo, fmtDate, today } from './common';

export default function Audit() {
  const [entity, setEntity] = useState(''); const [action, setAction] = useState(''); const [from, setFrom] = useState(daysAgo(7)); const [to, setTo] = useState(today()); const [sel, setSel] = useState<any | null>(null);
  const q = useGet<{ items: any[] }>(['audit', entity, action, from, to], '/audit-logs', { entity: entity || undefined, action: action || undefined, from: new Date(from + 'T00:00:00').toISOString(), to: new Date(to + 'T23:59:59').toISOString(), limit: 100 });
  return (
    <>
      <RetroCard title="Filtros" tone="plain"><div className="rb-row rb-wrap"><RetroInput label="Desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><RetroInput label="Hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} /><RetroInput label="Entidad" placeholder="order, user, branch…" value={entity} onChange={(e) => setEntity(e.target.value)} /><RetroInput label="Acción" placeholder="order.cancel…" value={action} onChange={(e) => setAction(e.target.value)} /></div></RetroCard>
      <Async q={q}><RetroTable rows={q.data?.items ?? []} onRowClick={setSel} columns={[{ key: 'at', header: 'Fecha y hora', render: (r: any) => fmtDate(r.at) }, { key: 'u', header: 'Usuario', render: (r: any) => r.user_name ?? '—' }, { key: 'a', header: 'Acción', render: (r: any) => <RetroBadge tone={/cancel|delete|refund|reuse|failed/.test(r.action) ? 'danger' : 'info'}>{r.action}</RetroBadge> }, { key: 'e', header: 'Entidad', render: (r: any) => `${r.entity}${r.entity_id ? ' · ' + String(r.entity_id).slice(0, 8) : ''}` }, { key: 'r', header: 'Motivo', render: (r: any) => r.reason ?? '' }, { key: 'ip', header: 'IP', render: (r: any) => r.ip ?? '' }]} /></Async>
      <RetroModal open={!!sel} onClose={() => setSel(null)} title="Detalle de auditoría" size="lg">{sel && <div className="rb-col"><div className="rb-grid rb-grid-3"><div><div className="rb-label">Usuario</div>{sel.user_name}</div><div><div className="rb-label">Fecha</div>{fmtDate(sel.at)}</div><div><div className="rb-label">IP</div>{sel.ip}</div><div><div className="rb-label">Acción</div>{sel.action}</div><div><div className="rb-label">Entidad / ID</div>{sel.entity} · {sel.entity_id}</div><div><div className="rb-label">Solicitud</div><span className="rb-mono">{sel.request_id}</span></div></div>
        {sel.reason && <div><div className="rb-label">Motivo</div>{sel.reason}</div>}<div className="rb-grid rb-grid-2"><div><div className="rb-label">Valor anterior</div><pre className="rb-mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(sel.old_value, null, 2) ?? '—'}</pre></div><div><div className="rb-label">Valor nuevo</div><pre className="rb-mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(sel.new_value, null, 2) ?? '—'}</pre></div></div></div>}</RetroModal>
      <span className="rb-hint">La bitácora es inmutable (solo inserción). <RetroButton size="sm" variant="ghost" onClick={() => void q.refetch()}>Actualizar</RetroButton></span>
    </>
  );
}
