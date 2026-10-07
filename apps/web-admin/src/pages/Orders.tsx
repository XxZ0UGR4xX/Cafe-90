import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroInput, RetroModal, RetroOrderCard, RetroSelect, RetroTable, RetroTabs, formatMoney2 } from '@retroburger/ui';
import { post } from '../app/api';
import { useAct, useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { useWithSupervisor } from '../app/supervisor';
import { Async, NeedBranch, fmtDate, fmtTime } from './common';
import { printReceipt } from './Pos';
import { InvoiceDetail, InvoiceOrderDialog } from './fiscal/invoices';

const FILTERS = { open: 'PENDING,CONFIRMED,PREPARING,READY,DELIVERED', done: 'COMPLETED', cancelled: 'CANCELLED', all: '' } as const;
export default function Orders() { return <NeedBranch>{(b) => <OrdersInner branchId={b} />}</NeedBranch>; }

function OrdersInner({ branchId }: { branchId: string }) {
  const [tab, setTab] = useState<keyof typeof FILTERS>('open'); const [sel, setSel] = useState<string | null>(null); const [view, setView] = useState<'cards' | 'table'>('cards');
  const q = useGet<any[]>(['orders', branchId], '/orders', { branchId, status: FILTERS[tab] || undefined, limit: 100 }, { refetchInterval: 30_000 });
  return (
    <>
      <div className="rb-row rb-wrap"><RetroTabs value={tab} onChange={setTab} tabs={[{ key: 'open', label: '🔥 Abiertos' }, { key: 'done', label: '✅ Completados' }, { key: 'cancelled', label: '🚫 Cancelados' }, { key: 'all', label: 'Todos' }]} />
        <span className="rb-end"><RetroButton size="sm" variant="white" onClick={() => setView(view === 'cards' ? 'table' : 'cards')}>{view === 'cards' ? '☰ Tabla' : '▦ Tarjetas'}</RetroButton></span></div>
      <Async q={q}>
        {view === 'cards' ? <div className="rb-grid rb-grid-3">{(q.data ?? []).map((o) => <RetroOrderCard key={o.id} number={o.number} status={o.status} paymentStatus={o.paymentStatus} total={o.total} onClick={() => setSel(o.id)}
          title={<strong>{o.tableNumber ? `Mesa ${o.tableNumber}` : o.channel === 'DELIVERY' ? '🛵 Domicilio' : o.channel === 'QR' ? '📱 QR' : '🥡 Para llevar'}</strong>} subtitle={`${o.waiterName ?? '—'} · ${fmtTime(o.createdAt)} · ${o.itemCount} productos`} flag={o.needsReview ? <RetroBadge tone="warn">Revisar</RetroBadge> : undefined} />)}
          {(q.data ?? []).length === 0 && <div className="rb-empty">No hay pedidos en esta vista.</div>}</div>
          : <RetroTable rows={q.data ?? []} onRowClick={(o) => setSel(o.id)} columns={[{ key: 'number', header: '#', render: (o) => `#${String(o.number).padStart(4, '0')}` }, { key: 'ch', header: 'Canal', render: (o) => o.channel }, { key: 't', header: 'Mesa', render: (o) => o.tableNumber ?? '—' }, { key: 'w', header: 'Mesero', render: (o) => o.waiterName }, { key: 's', header: 'Estado', render: (o) => o.status }, { key: 'p', header: 'Pago', render: (o) => o.paymentStatus }, { key: 'at', header: 'Hora', render: (o) => fmtDate(o.createdAt) }, { key: 'total', header: 'Total', numeric: true, render: (o) => formatMoney2(o.total) }]} />}
      </Async>
      {sel && <OrderDetail id={sel} onClose={() => setSel(null)} />}
    </>
  );
}

export function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useGet<any>(['orders', 'one', id], `/orders/${id}`); const { can } = useSession(); const withSup = useWithSupervisor();
  const [inv, setInv] = useState<null | 'new' | string>(null);
  const [refundKey, setRefundKey] = useState(() => crypto.randomUUID());   // idempotencia: un doble clic no devuelve dos veces
  const [mode, setMode] = useState<null | 'cancel' | 'refund'>(null); const [reason, setReason] = useState(''); const [method, setMethod] = useState('CASH');
  const o = q.data;
  const canInvoice = !!o && o.paymentStatus === 'PAID' && o.status !== 'CANCELLED' && can('fiscal.invoice.issue', o.branchId);
  const invs = useGet<any[]>(['invoices', 'order', id], '/invoices', { orderId: id }, { enabled: canInvoice });
  const active = (invs.data ?? []).find((x) => ['STAMPED', 'PENDING', 'CANCEL_PENDING'].includes(x.status));
  const run = useAct(() => withSup((sup) => mode === 'cancel' ? post(`/orders/${id}/cancel`, { reason, supervisor: sup }) : post(`/orders/${id}/refund`, { method, reason, supervisor: sup, clientUuid: refundKey })), { invalidate: [['orders'], ['tables']], ok: 'Listo', onSuccess: () => { setMode(null); setReason(''); setRefundKey(crypto.randomUUID()); } });
  const send = useAct(() => post(`/orders/${id}/send-to-kitchen`), { invalidate: [['orders'], ['kitchen']], ok: '🔥 Enviado a cocina' });
  return (
    <RetroModal open onClose={onClose} size="lg" title={o ? `Orden #${String(o.number).padStart(4, '0')}` : 'Orden'} footer={o && <>
      <RetroButton variant="white" onClick={() => void printReceipt(id)}>🖨️ Ticket</RetroButton>
      {canInvoice && invs.data && (active ? <RetroButton variant="white" onClick={() => setInv(active.id)}>🧾 Factura {active.series}-{active.folio}</RetroButton> : <RetroButton variant="neon" onClick={() => setInv('new')}>🧾 Facturar</RetroButton>)}
      {o.status === 'PENDING' && can('sales.order.update', o.branchId) && <RetroButton variant="mustard" loading={send.isPending} onClick={() => send.mutate()}>🔥 Confirmar y enviar a cocina</RetroButton>}
      {!['CANCELLED', 'COMPLETED'].includes(o.status) && o.paidTotal === 0 && <RetroButton variant="ink" onClick={() => setMode('cancel')}>Cancelar orden</RetroButton>}
      {o.paidTotal > 0 && <RetroButton variant="ink" onClick={() => setMode('refund')}>Devolución</RetroButton>}</>}>
      <Async q={q}>{o && <div className="rb-col">
        <div className="rb-row rb-wrap"><RetroBadge tone="info">{o.status}</RetroBadge><RetroBadge tone={o.paymentStatus === 'PAID' ? 'ok' : 'warn'}>{o.paymentStatus}</RetroBadge><span>{o.tableNumber ? `Mesa ${o.tableNumber}` : o.channel}</span><span className="rb-muted">{o.waiterName} · {fmtDate(o.createdAt)}</span>{o.needsReview && <RetroBadge tone="warn">⚠️ Revisar inventario</RetroBadge>}</div>
        <RetroTable rows={o.items.filter((i: any) => i.status !== 'CANCELLED')} columns={[{ key: 'n', header: 'Producto', render: (i: any) => <>{i.parentItemId ? '↳ ' : ''}<strong>{i.qty}× {i.name}</strong>{i.modifiers.length > 0 && <div className="rb-hint">{i.modifiers.map((m: any) => m.name).join(', ')}</div>}</> }, { key: 's', header: 'Estado', render: (i: any) => i.status }, { key: 't', header: 'Importe', numeric: true, render: (i: any) => formatMoney2(i.lineTotal) }]} />
        <div className="rb-row" style={{ justifyContent: 'flex-end', gap: 24 }}><div>Subtotal<br /><strong className="rb-mono">{formatMoney2(o.subtotal)}</strong></div>{o.discountTotal > 0 && <div>Descuento<br /><strong className="rb-mono">−{formatMoney2(o.discountTotal)}</strong></div>}<div>IVA incl.<br /><strong className="rb-mono">{formatMoney2(o.taxTotal)}</strong></div>{o.tipTotal > 0 && <div>Propina<br /><strong className="rb-mono">{formatMoney2(o.tipTotal)}</strong></div>}<div>TOTAL<br /><strong className="rb-display" style={{ fontSize: '1.4rem' }}>{formatMoney2(o.total)}</strong></div></div>
        {o.payments.length > 0 && <RetroCard title="Pagos" tone="plain"><RetroTable rows={o.payments} columns={[{ key: 'k', header: 'Tipo', render: (p: any) => p.kind }, { key: 'm', header: 'Método', render: (p: any) => p.method }, { key: 'a', header: 'Monto', numeric: true, render: (p: any) => formatMoney2(p.amount) }, { key: 'at', header: 'Hora', render: (p: any) => fmtTime(p.at) }]} /></RetroCard>}
        {o.cancelReason && <div className="rb-error-text">Motivo de cancelación: {o.cancelReason}</div>}
      </div>}</Async>
      {inv === 'new' && o && <InvoiceOrderDialog order={{ id, number: o.number, total: o.total, customerId: o.customerId, customerName: o.customerName }} onClose={() => setInv(null)} onDone={(i) => setInv(i)} />}
      {inv && inv !== 'new' && <InvoiceDetail id={inv} onClose={() => setInv(null)} />}
      <RetroModal open={!!mode} size="sm" onClose={() => setMode(null)} title={mode === 'cancel' ? 'Cancelar orden' : 'Devolución'} footer={<RetroButton variant="red" loading={run.isPending} disabled={reason.trim().length < 3} onClick={() => run.mutate()}>Confirmar</RetroButton>}>
        <div className="rb-col"><RetroInput label="Motivo (queda en auditoría)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />{mode === 'refund' && <RetroSelect label="Devolver por" value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: 'CASH', label: 'Efectivo' }, { value: 'CARD', label: 'Tarjeta' }, { value: 'TRANSFER', label: 'Transferencia' }, { value: 'QR', label: 'QR' }]} />}<span className="rb-hint">Si requiere autorización se pedirá el PIN de un gerente.</span></div>
      </RetroModal>
    </RetroModal>
  );
}
