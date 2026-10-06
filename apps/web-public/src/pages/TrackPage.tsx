import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RetroBadge, RetroCard, RetroSpinner, formatMoney2 } from '@retroburger/ui';
import { api } from '../api';

const STEPS = [['PENDING', '📥 Recibido'], ['CONFIRMED', '✅ Confirmado'], ['PREPARING', '🔥 Preparando'], ['READY', '🔔 Listo'], ['DELIVERED', '🏁 Entregado']] as const;
export function TrackPage() {
  const { id } = useParams(); const q = useQuery({ queryKey: ['track', id], queryFn: () => api(`/orders/${id}`), refetchInterval: 8000 });
  if (q.isLoading) return <RetroSpinner />;
  if (q.error || !q.data) return <RetroCard title="🔍" tone="red">No encontramos tu pedido.</RetroCard>;
  const o = q.data; const idx = Math.max(STEPS.findIndex(([k]) => k === o.status), o.status === 'COMPLETED' ? 4 : 0);
  return (
    <RetroCard title={`Pedido #${String(o.number).padStart(4, '0')}`} tone="red"><div className="rb-col">
      {o.status === 'CANCELLED' ? <RetroBadge tone="danger">Cancelado</RetroBadge> : <div className="rb-col">{STEPS.map(([k, label], i) => <div key={k} className="rb-row" style={{ opacity: i <= idx ? 1 : 0.35 }}><span style={{ fontSize: '1.4rem' }}>{i < idx ? '✅' : i === idx ? '👉' : '⚪'}</span><strong>{label}</strong></div>)}</div>}
      <div className="rb-display" style={{ fontSize: '1.4rem' }}>Total {formatMoney2(o.total)} · pagas al recibir</div>{o.deliveryStatus && <RetroBadge tone="info">🛵 {o.deliveryStatus}</RetroBadge>}
      <span className="rb-hint">Esta página se actualiza sola.</span></div></RetroCard>
  );
}
