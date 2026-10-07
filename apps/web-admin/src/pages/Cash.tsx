import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroInput, RetroSelect, RetroStatCard, RetroTable, formatMoney2 } from '@retroburger/ui';
import { post } from '../app/api';
import { useAct, useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { useWithSupervisor } from '../app/supervisor';
import { Async, FormModal, NeedBranch, Row, fmtDate, num } from './common';

const BILLS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];
export default function Cash() { return <NeedBranch>{(b) => <CashInner branchId={b} />}</NeedBranch>; }

function CashInner({ branchId }: { branchId: string }) {
  const { can } = useSession(); const withSup = useWithSupervisor();
  const cur = useGet<any>(['cash', 'current', branchId], '/cash/shifts/current', { branchId });
  const list = useGet<any[]>(['cash', 'list', branchId], '/cash/shifts', { branchId, limit: 20 }, { enabled: can('cash.shift.readAll', branchId) });
  const [mode, setMode] = useState<null | 'open' | 'close' | 'move'>(null); const [floatV, setFloatV] = useState('500'); const [den, setDen] = useState<Record<string, number>>({}); const [notes, setNotes] = useState(''); const [counted, setCounted] = useState('');
  const [mv, setMv] = useState<any>({ type: 'EXPENSE', amount: '', reason: '' }); const [report, setReport] = useState<any>(null);
  const inv = [['cash'], ['dashboard']];
  const denTotal = Object.entries(den).reduce((a, [k, n]) => a + Number(k) * n, 0);
  const open = useAct(() => post('/cash/shifts/open', { branchId, openingFloat: denTotal || num(floatV), denominations: den }), { invalidate: inv, ok: '💰 Caja abierta', onSuccess: () => setMode(null) });
  const close = useAct(() => withSup((sup) => post(`/cash/shifts/${cur.data.id}/close`, { countedCash: denTotal || num(counted), denominations: den, notes: notes || undefined, supervisor: sup })), { invalidate: inv, ok: '✂️ Corte realizado', onSuccess: (r) => { setMode(null); setReport(r); } });
  const move = useAct(() => withSup((sup) => post('/cash/movements', { type: mv.type, amount: num(mv.amount), reason: mv.reason, supervisor: sup })), { invalidate: inv, ok: 'Movimiento registrado', onSuccess: () => { setMode(null); setMv({ type: 'EXPENSE', amount: '', reason: '' }); } });
  const s = cur.data; const sum = s?.summary;
  const Denoms = <div className="rb-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8 }}>{BILLS.map((b) => <RetroInput key={b} label={`$${b}`} type="number" min={0} value={den[String(b)] ?? ''} onChange={(e) => setDen({ ...den, [String(b)]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />)}<div className="rb-display" style={{ alignSelf: 'end' }}>= {formatMoney2(denTotal)}</div></div>;

  return (
    <>
      <Async q={cur}>
        {!s ? <RetroCard title="💰 Caja cerrada" tone="red"><div className="rb-col"><p style={{ margin: 0 }}>No tienes un turno abierto en esta sucursal.</p><RetroButton variant="neon" size="lg" onClick={() => { setDen({}); setMode('open'); }}>🔓 Abrir caja</RetroButton></div></RetroCard> : <>
          <div className="rb-grid rb-grid-3">
            <RetroStatCard label="Caja" value={s.register} icon="🟢" /><RetroStatCard label="Fondo inicial" value={formatMoney2(s.openingFloat)} icon="🏦" accent="var(--mustard)" />
            <RetroStatCard label="Ventas del turno" value={formatMoney2(sum.salesTotal)} icon="🪙" accent="var(--neon-dark)" /><RetroStatCard label="Propinas" value={formatMoney2(sum.tipsTotal)} icon="💝" accent="var(--orange)" />
            <RetroStatCard label="Gastos / retiros" value={`${formatMoney2(sum.expenses)} / ${formatMoney2(sum.withdrawals)}`} icon="📤" accent="var(--ketchup)" />
            {sum.expectedCash !== undefined ? <RetroStatCard label="Efectivo esperado" value={formatMoney2(sum.expectedCash)} icon="💵" accent="var(--blue)" /> : <RetroStatCard label="Efectivo esperado" value="🙈 Conteo ciego" hint="Se revela al cerrar" icon="💵" accent="var(--blue)" />}
          </div>
          <div className="rb-row rb-wrap"><RetroButton variant="mustard" onClick={() => setMode('move')}>➕➖ Gasto / retiro / depósito</RetroButton><RetroButton variant="red" size="lg" onClick={() => { setDen({}); setCounted(''); setMode('close'); }}>✂️ Corte de caja</RetroButton></div>
          <RetroCard title="Ventas por método" tone="plain"><RetroTable rows={Object.entries(sum.salesByMethod).map(([k, v]) => ({ id: k, k, v, tip: sum.tipsByMethod[k] }))} columns={[{ key: 'k', header: 'Método', render: (r: any) => ({ CASH: '💵 Efectivo', CARD: '💳 Tarjeta', TRANSFER: '🏦 Transferencia', QR: '📱 QR' } as any)[r.k] }, { key: 'v', header: 'Ventas', numeric: true, render: (r: any) => formatMoney2(r.v) }, { key: 'tip', header: 'Propinas', numeric: true, render: (r: any) => formatMoney2(r.tip) }]} /></RetroCard>
        </>}
      </Async>
      {can('cash.shift.readAll', branchId) && <RetroCard title="🧾 Cortes recientes de la sucursal" tone="plain" flush><RetroTable rows={list.data ?? []} onRowClick={async (r) => { const { get } = await import('../app/api'); setReport(await get(`/cash/shifts/${r.id}/report`)); }} columns={[{ key: 'userName', header: 'Cajero' }, { key: 'openedAt', header: 'Apertura', render: (r: any) => fmtDate(r.openedAt) }, { key: 'st', header: 'Estado', render: (r: any) => <RetroBadge tone={r.status === 'OPEN' ? 'ok' : 'neutral'}>{r.status}</RetroBadge> }, { key: 'exp', header: 'Esperado', numeric: true, render: (r: any) => (r.expectedCash == null ? '—' : formatMoney2(r.expectedCash)) }, { key: 'cnt', header: 'Contado', numeric: true, render: (r: any) => (r.countedCash == null ? '—' : formatMoney2(r.countedCash)) }, { key: 'd', header: 'Diferencia', numeric: true, render: (r: any) => (r.difference == null ? '—' : <strong style={{ color: Math.abs(r.difference) > 0.01 ? 'var(--ketchup)' : 'var(--ok-text)' }}>{formatMoney2(r.difference)}</strong>) }]} /></RetroCard>}

      <FormModal open={mode === 'open'} onClose={() => setMode(null)} title="🔓 Apertura de caja" busy={open.isPending} onSubmit={() => open.mutate()} size="lg">
        <p style={{ margin: 0 }}>Cuenta tu fondo inicial por denominación (opcional) o captura el total.</p>{Denoms}<RetroInput label="Fondo inicial (si no cuentas por denominación)" large inputMode="decimal" value={floatV} onChange={(e) => setFloatV(e.target.value.replace(/[^\d.]/g, ''))} />
      </FormModal>
      <FormModal open={mode === 'close'} onClose={() => setMode(null)} title="✂️ Corte de caja (conteo ciego)" busy={close.isPending} onSubmit={() => close.mutate()} size="lg" submitLabel="Cerrar turno">
        <p style={{ margin: 0 }}>Cuenta el efectivo físico en caja <strong>sin ver</strong> el esperado. El sistema calculará la diferencia.</p>{Denoms}
        <RetroInput label="Efectivo contado (total)" large inputMode="decimal" value={denTotal ? String(denTotal) : counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ''))} disabled={denTotal > 0} />
        <RetroInput label="Comentarios (obligatorio si hay diferencia)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormModal>
      <FormModal open={mode === 'move'} onClose={() => setMode(null)} title="Movimiento de caja" busy={move.isPending} disabled={!num(mv.amount) || mv.reason.length < 3} onSubmit={() => move.mutate()} size="sm">
        <RetroSelect label="Tipo" value={mv.type} onChange={(e) => setMv({ ...mv, type: e.target.value })} options={[{ value: 'EXPENSE', label: 'Gasto' }, { value: 'WITHDRAWAL', label: 'Retiro parcial (requiere gerente)' }, { value: 'DEPOSIT', label: 'Depósito' }]} />
        <Row><RetroInput label="Monto" large inputMode="decimal" value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Row><RetroInput label="Motivo" value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} />
      </FormModal>
      <FormModal open={!!report} onClose={() => setReport(null)} title="🧾 Reporte de corte" onSubmit={() => window.print()} submitLabel="🖨️ Imprimir" size="lg">
        {report?.report && <div className="rb-grid rb-grid-3">{[['Ventas totales', report.report.salesTotal], ['Efectivo', report.report.salesByMethod.CASH], ['Tarjeta', report.report.salesByMethod.CARD], ['Transferencias', report.report.salesByMethod.TRANSFER], ['QR', report.report.salesByMethod.QR], ['Propinas', report.report.tipsTotal], ['Descuentos', report.report.discounts], ['Cancelaciones', `${report.report.cancellations}`], ['Gastos', report.report.expenses], ['Retiros', report.report.withdrawals], ['Total esperado', report.report.expectedCash], ['Total real', report.report.countedCash], ['Diferencia', report.report.difference]].map(([l, v]) => <RetroStatCard key={String(l)} label={l} value={typeof v === 'number' ? formatMoney2(v) : v} />)}<div className="rb-hint">Realizado por {report.userName} · {fmtDate(report.closedAt)}</div></div>}
      </FormModal>
    </>
  );
}
