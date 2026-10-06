import { useState } from 'react';
import { RetroButton, RetroCard, RetroInput, RetroSelect, RetroStatCard, RetroTable, formatMoney2 } from '@retroburger/ui';
import { REPORT_TYPES } from '@retroburger/shared';
import { useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { Async, daysAgo, fmtDate, today } from './common';

const LABEL: Record<string, string> = { sales: '💰 Ventas', products: '🍔 Productos', inventory: '📦 Inventario', purchases: '🛒 Compras', profit: '📈 Utilidad', costs: '🥩 Costos', employees: '👨‍💼 Empleados', customers: '👥 Clientes', promotions: '🎟️ Promociones', waste: '🗑 Mermas', cash: '💵 Caja', tips: '🪙 Propinas', delivery: '🛵 Delivery', reservations: '📅 Reservaciones' };
const PERM: Record<string, string> = { profit: 'reports.profit.read', costs: 'reports.profit.read', inventory: 'reports.inventory.read', purchases: 'reports.inventory.read', waste: 'reports.inventory.read' };

export default function Reports() {
  const { can, me } = useSession(); const branches = useGet<any[]>(['branches'], '/branches');
  const [type, setType] = useState<(typeof REPORT_TYPES)[number]>('sales'); const [from, setFrom] = useState(daysAgo(6)); const [to, setTo] = useState(today());
  const [branchId, setBranchId] = useState(''); const [groupBy, setGroupBy] = useState('day'); const [method, setMethod] = useState('');
  const available = REPORT_TYPES.filter((t) => can(PERM[t] ?? 'reports.sales.read'));
  const q = useGet<any>(['reports', type, from, to, branchId, groupBy, method], `/reports/${type}`, { from, to, branchId: branchId || undefined, groupBy: type === 'sales' ? groupBy : undefined, method: method || undefined }, { enabled: available.includes(type) });
  const fmt = (c: any, v: any) => (v === null || v === undefined ? '—' : c.type === 'money' ? formatMoney2(v) : c.type === 'percent' ? `${v}%` : c.type === 'date' ? fmtDate(v) : c.type === 'number' ? (typeof v === 'number' ? Math.round(v * 100) / 100 : v) : v);
  const exportCsv = () => {
    const d = q.data; if (!d) return; const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [d.columns.map((c: any) => esc(c.label)).join(','), ...d.rows.map((r: any) => d.columns.map((c: any) => esc(r[c.key])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = `retroburger-${type}-${from}_${to}.csv`; a.click();
  };
  return (
    <>
      <div className="rb-row rb-wrap">{available.map((t) => <RetroButton key={t} size="sm" variant={type === t ? 'red' : 'white'} onClick={() => setType(t)}>{LABEL[t]}</RetroButton>)}</div>
      <RetroCard title="Filtros" tone="plain"><div className="rb-row rb-wrap">
        <RetroInput label="Desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><RetroInput label="Hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <RetroSelect label="Sucursal" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={[{ value: '', label: me?.isCorporate ? 'Todas' : 'Mis sucursales' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))]} />
        {type === 'sales' && <><RetroSelect label="Agrupar por" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} options={[{ value: 'day', label: 'Día' }, { value: 'hour', label: 'Hora' }, { value: 'branch', label: 'Sucursal' }]} /><RetroSelect label="Método de pago" value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: '', label: 'Todos' }, { value: 'CASH', label: 'Efectivo' }, { value: 'CARD', label: 'Tarjeta' }, { value: 'TRANSFER', label: 'Transferencia' }, { value: 'QR', label: 'QR' }]} /></>}
        <span className="rb-end"><RetroButton variant="mustard" onClick={exportCsv} disabled={!q.data}>⬇️ CSV</RetroButton> <RetroButton variant="white" onClick={() => window.print()}>🖨️ Imprimir</RetroButton></span></div></RetroCard>
      <Async q={q}>{q.data && <>
        {q.data.totals && <div className="rb-grid rb-grid-3">{Object.entries(q.data.totals).map(([k, v]) => { const c = q.data.columns.find((x: any) => x.key === k); return <RetroStatCard key={k} label={c?.label ?? k} value={c ? fmt(c, v) : String(v)} />; })}</div>}
        <RetroTable rows={q.data.rows.map((r: any, i: number) => ({ id: i, ...r }))} columns={q.data.columns.map((c: any) => ({ key: c.key, header: c.label, numeric: ['number', 'money', 'percent'].includes(c.type), render: (r: any) => fmt(c, r[c.key]) }))} empty="Sin datos en el periodo seleccionado" />
      </>}</Async>
    </>
  );
}
