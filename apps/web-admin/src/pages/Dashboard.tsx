import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RetroBadge, RetroBarChart, RetroButton, RetroCard, RetroDonutChart, RetroLineChart, RetroStatCard, RetroTable, RetroTabs, formatMoney, mmss } from '@retroburger/ui';
import { useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { useBranch } from '../app/branch';
import { Async, INV_STATUS, NeedBranch, StatusBadge, fmtDate } from './common';
import { daysAgo, today } from './common';

export default function Dashboard() {
  const { can } = useSession();
  if (can('reports.corporate.read')) return <CorporateOrBranch />;
  if (can('reports.sales.read')) return <NeedBranch>{(b) => <Manager branchId={b} />}</NeedBranch>;
  if (can('cash.shift.operate')) return <NeedBranch>{(b) => <Cashier branchId={b} />}</NeedBranch>;
  if (can('floor.table.operate')) return <NeedBranch>{(b) => <Waiter branchId={b} />}</NeedBranch>;
  if (can('kitchen.metrics.read')) return <NeedBranch>{(b) => <KitchenSummary branchId={b} />}</NeedBranch>;
  if (can('inventory.stock.read')) return <NeedBranch>{(b) => <Warehouse branchId={b} />}</NeedBranch>;
  return <RetroCard title="🛵 Bienvenido">Abre <strong>Delivery</strong> para ver tus entregas asignadas.</RetroCard>;
}

function CorporateOrBranch() {
  const [tab, setTab] = useState<'corp' | 'branch'>('corp');
  return <><RetroTabs value={tab} onChange={setTab} tabs={[{ key: 'corp', label: '🏢 Corporativo' }, { key: 'branch', label: '🏪 Sucursal activa' }]} />{tab === 'corp' ? <Corporate /> : <NeedBranch>{(b) => <Manager branchId={b} />}</NeedBranch>}</>;
}

const RANGES = [['today', 'Hoy'], ['yesterday', 'Ayer'], ['last7', 'Últimos 7 días'], ['month', 'Este mes'], ['prevMonth', 'Mes anterior'], ['custom', 'Personalizado']] as const;
function Corporate() {
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('today'); const [from, setFrom] = useState(daysAgo(6)); const [to, setTo] = useState(today());
  const nav = useNavigate(); const setBranch = useBranch((s) => s.set);
  const q = useGet<any>(['dashboard', 'corporate'], '/dashboard/corporate', { range, from: range === 'custom' ? from : undefined, to: range === 'custom' ? to : undefined });
  const d = q.data;
  return (
    <>
      <div className="rb-row rb-wrap">{RANGES.map(([k, l]) => <RetroButton key={k} size="sm" variant={range === k ? 'red' : 'white'} onClick={() => setRange(k)}>{l}</RetroButton>)}
        {range === 'custom' && <><input className="rb-input" style={{ width: 150 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" /><input className="rb-input" style={{ width: 150 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" /></>}</div>
      <Async q={q}>{d && <>
        <div className="rb-grid rb-grid-3">
          <RetroStatCard label="Ventas de hoy" value={formatMoney(d.kpis.salesToday)} icon="💰" /><RetroStatCard label="Ventas del mes" value={formatMoney(d.kpis.salesMonth)} icon="📅" accent="var(--mustard)" />
          <RetroStatCard label="Ticket promedio" value={formatMoney(d.kpis.averageTicket)} icon="🧾" accent="var(--blue)" delta={d.comparison.averageTicket} /><RetroStatCard label="Pedidos" value={d.kpis.orders} icon="🍔" accent="var(--orange)" delta={d.comparison.orders} />
          <RetroStatCard label="Utilidad estimada" value={formatMoney(d.kpis.estimatedProfit)} icon="📈" accent="var(--neon-dark)" delta={d.comparison.profit} /><RetroStatCard label="Costo de productos" value={formatMoney(d.kpis.productCost)} icon="🥩" accent="var(--ink)" />
          <RetroStatCard label="Sucursal líder" value={d.kpis.topBranch ?? '—'} icon="🏆" /><RetroStatCard label="Producto más vendido" value={d.kpis.topProduct ?? '—'} icon="⭐" accent="var(--mustard)" /><RetroStatCard label="Clientes nuevos" value={d.kpis.newCustomers} icon="🆕" accent="var(--blue)" />
        </div>
        <div className="rb-grid rb-grid-2">
          <RetroCard title="Ventas por día" tone="red"><RetroBarChart data={d.charts.salesByDay.map((x: any) => ({ label: x.d.slice(5), value: x.sales }))} /></RetroCard>
          <RetroCard title="Ventas por hora"><RetroBarChart color="#1E6BFF" data={d.charts.salesByHour.map((x: any) => ({ label: `${x.h}h`, value: x.sales }))} /></RetroCard>
          <RetroCard title="Ventas por sucursal" tone="blue"><RetroBarChart color="#F6B800" data={d.charts.salesByBranch.map((x: any) => ({ label: x.branch.replace('RETROBURGER ', ''), value: x.sales }))} /></RetroCard>
          <RetroCard title="Ventas por categoría" tone="neon"><RetroDonutChart data={d.charts.salesByCategory.map((x: any) => ({ label: x.category, value: x.sales }))} /></RetroCard>
          <RetroCard title="Utilidad por día"><RetroLineChart color="#17B800" data={d.charts.profitByDay.map((x: any) => ({ label: x.d.slice(5), value: x.profit }))} /></RetroCard>
          <RetroCard title="Comparativa mensual"><RetroBarChart color="#F77F00" data={d.charts.monthly.map((x: any) => ({ label: x.m, value: x.sales }))} /></RetroCard>
          <RetroCard title="Ticket promedio por día"><RetroLineChart data={d.charts.averageTicketByDay.map((x: any) => ({ label: x.d.slice(5), value: x.avgTicket }))} /></RetroCard>
          <RetroCard title="Más vendidos" tone="plain"><RetroTable rows={d.topProducts} columns={[{ key: 'name', header: 'Producto' }, { key: 'qty', header: 'Uds', numeric: true }, { key: 'sales', header: 'Ventas', numeric: true, render: (r: any) => formatMoney(r.sales) }]} /></RetroCard>
        </div>
        <RetroCard title="🏁 Ranking de sucursales" tone="red" flush><RetroTable rows={d.ranking} onRowClick={(r) => { setBranch(r.branchId); nav('/'); }} columns={[
          { key: 'rank', header: '#', render: (r: any) => (r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank) }, { key: 'branch', header: 'Sucursal' }, { key: 'sales', header: 'Ventas', numeric: true, render: (r: any) => formatMoney(r.sales) }, { key: 'orders', header: 'Pedidos', numeric: true },
          { key: 'avgTicket', header: 'Ticket prom.', numeric: true, render: (r: any) => formatMoney(r.avgTicket) }, { key: 'profit', header: 'Utilidad', numeric: true, render: (r: any) => formatMoney(r.profit) }, { key: 'fc', header: 'Food cost', numeric: true, render: (r: any) => `${r.foodCostPct}%` },
          { key: 'customers', header: 'Clientes', numeric: true }, { key: 'growth', header: 'Crecimiento', numeric: true, render: (r: any) => (r.growth === null ? '—' : <span style={{ color: r.growth >= 0 ? 'var(--neon-dark)' : 'var(--ketchup)', fontWeight: 800 }}>{r.growth >= 0 ? '▲' : '▼'} {Math.abs(r.growth)}%</span>) }]} /></RetroCard>
        <RetroCard title="📊 Analítica" tone="plain"><div className="rb-grid rb-grid-3">
          {[['Revenue', formatMoney(d.analytics.revenue)], ['COGS', formatMoney(d.analytics.cogs)], ['Gross profit', formatMoney(d.analytics.grossProfit)], ['Net sales', formatMoney(d.analytics.netSales)], ['Average ticket', formatMoney(d.analytics.averageTicket)], ['Orders', d.analytics.orders], ['Customers', d.analytics.customers], ['Retention', `${d.analytics.retention}%`], ['Food cost %', `${d.analytics.foodCostPct}%`], ['Labor cost %', `${d.analytics.laborCostPct}%`], ['Profit margin %', `${d.analytics.profitMarginPct}%`]].map(([l, v]) => <RetroStatCard key={String(l)} label={l} value={v} />)}</div></RetroCard>
      </>}</Async>
    </>
  );
}

const vs = (v: number | null | undefined) => (v === null || v === undefined ? undefined : v);
function Manager({ branchId }: { branchId: string }) {
  const q = useGet<any>(['dashboard', 'manager', branchId], '/dashboard/manager', { branchId }, { refetchInterval: 60_000 }); const d = q.data;
  return <Async q={q}>{d && <>
    <div className="rb-grid rb-grid-3">
      <RetroStatCard label="Ventas" value={formatMoney(d.sales)} icon="💰" delta={vs(d.vsYesterday.sales)} hint={d.vsLastWeek.sales !== null ? `Semana ant.: ${d.vsLastWeek.sales >= 0 ? '+' : ''}${d.vsLastWeek.sales}%` : undefined} />
      <RetroStatCard label="Utilidad" value={formatMoney(d.profit)} icon="📈" accent="var(--neon-dark)" delta={vs(d.vsYesterday.profit)} /><RetroStatCard label="Pedidos" value={d.orders} icon="🧾" accent="var(--blue)" delta={vs(d.vsYesterday.orders)} />
      <RetroStatCard label="Ticket promedio" value={formatMoney(d.averageTicket)} icon="🍔" accent="var(--orange)" /><RetroStatCard label="Clientes hoy" value={d.customers} icon="👥" accent="var(--mustard)" /><RetroStatCard label="Personal asignado / cajas" value={`${d.staff} · ${d.openShifts}`} icon="👨‍💼" accent="var(--ink)" />
    </div>
    <div className="rb-grid rb-grid-2">
      <RetroCard title="📦 Inventario" tone="red"><div className="rb-row rb-wrap"><RetroBadge tone="dark">⚫ Agotados {d.inventory.out}</RetroBadge><RetroBadge tone="danger">🔴 Críticos {d.inventory.critical}</RetroBadge><RetroBadge tone="warn">🟡 Bajos {d.inventory.low}</RetroBadge>{d.inventory.review > 0 && <RetroBadge tone="info">Por revisar {d.inventory.review}</RetroBadge>}</div></RetroCard>
      <RetroCard title="🚨 Problemas" tone="plain"><div className="rb-col" style={{ gap: 6 }}>{[['Órdenes por revisar (offline)', d.problems.ordersToReview], ['Excepciones de sincronización', d.problems.syncExceptions], ['Tickets de cocina retrasados', d.problems.delayedTickets], ['Cortes con diferencia (7 d)', d.problems.cashDifferences]].map(([l, v]) => <div key={String(l)} className="rb-row"><span>{l}</span><span className="rb-end"><RetroBadge tone={Number(v) > 0 ? 'warn' : 'ok'}>{v}</RetroBadge></span></div>)}</div></RetroCard>
      <RetroCard title="Pedidos de hoy por estado" tone="plain"><RetroTable rows={d.ordersByStatus} columns={[{ key: 'status', header: 'Estado' }, { key: 'n', header: 'Pedidos', numeric: true }]} empty="Aún no hay pedidos hoy" /></RetroCard>
      <RetroCard title="🔔 Alertas recientes" tone="plain"><div className="rb-col" style={{ gap: 6 }}>{d.alerts.length === 0 && <span className="rb-muted">Sin alertas 🎉</span>}{d.alerts.map((a: any) => <div key={a.id} className="rb-row"><span className="rb-grow">{a.title}</span><span className="rb-hint">{fmtDate(a.createdAt)}</span></div>)}</div></RetroCard>
    </div>
  </>}</Async>;
}

function Cashier({ branchId }: { branchId: string }) {
  const q = useGet<any>(['dashboard', 'cashier', branchId], '/dashboard/cashier', { branchId }, { refetchInterval: 30_000 }); const nav = useNavigate(); const d = q.data;
  return <Async q={q}>{d && <>
    <div className="rb-grid rb-grid-3"><RetroStatCard label="Caja" value={d.shift ? '🟢 ABIERTA' : '🔴 CERRADA'} icon="💰" /><RetroStatCard label="Ventas del turno" value={formatMoney(d.salesTotal)} icon="🪙" accent="var(--mustard)" /><RetroStatCard label="Pedidos cobrados" value={d.ordersCount} icon="🧾" accent="var(--blue)" /></div>
    <div className="rb-row"><RetroButton variant="neon" size="lg" onClick={() => nav('/pos')}>🍔 Ir al POS</RetroButton><RetroButton variant="mustard" size="lg" onClick={() => nav('/cash')}>{d.shift ? '✂️ Corte de caja' : '🔓 Abrir caja'}</RetroButton></div>
    <div className="rb-grid rb-grid-2"><RetroCard title="Métodos de pago" tone="plain"><RetroTable rows={d.methods} columns={[{ key: 'method', header: 'Método' }, { key: 'n', header: 'Pagos', numeric: true }, { key: 'total', header: 'Total', numeric: true, render: (r: any) => formatMoney(r.total) }]} empty="Sin cobros en este turno" /></RetroCard>
      <RetroCard title="Cuentas por cobrar" tone="plain"><RetroTable rows={d.pendingOrders} columns={[{ key: 'number', header: '#', render: (r: any) => `#${String(r.number).padStart(4, '0')}` }, { key: 'total', header: 'Total', numeric: true, render: (r: any) => formatMoney(r.total) }, { key: 'p', header: 'Pago', render: (r: any) => r.paymentStatus }]} empty="Todo cobrado ✅" /></RetroCard></div>
  </>}</Async>;
}

function Waiter({ branchId }: { branchId: string }) {
  const q = useGet<any>(['dashboard', 'waiter', branchId], '/dashboard/waiter', { branchId }, { refetchInterval: 20_000 }); const nav = useNavigate(); const d = q.data;
  return <Async q={q}>{d && <>
    <div className="rb-grid rb-grid-3"><RetroStatCard label="Mesas ocupadas" value={`${d.tables.occupied} / ${d.tables.total}`} icon="🔴" accent="var(--ketchup)" /><RetroStatCard label="Mesas disponibles" value={d.tables.free} icon="🟢" accent="var(--neon-dark)" /><RetroStatCard label="Mis pedidos abiertos" value={d.openOrders} icon="🧾" accent="var(--blue)" /><RetroStatCard label="Mis ventas" value={formatMoney(d.sales)} icon="💰" accent="var(--mustard)" /><RetroStatCard label="Mis propinas" value={formatMoney(d.tips)} icon="🪙" accent="var(--orange)" /></div>
    <div className="rb-row"><RetroButton variant="neon" size="lg" onClick={() => nav('/tables')}>🪑 Ver mesas</RetroButton><RetroButton variant="mustard" size="lg" onClick={() => nav('/pos')}>🍔 Nueva orden</RetroButton></div>
    {d.readyForPickup.length > 0 && <RetroCard title="🔔 Listos para entregar" tone="neon"><div className="rb-row rb-wrap">{d.readyForPickup.map((r: any) => <RetroBadge key={r.id} tone="ok">Mesa {r.tableNumber ?? '—'} · #{r.number} · {r.station}</RetroBadge>)}</div></RetroCard>}
    <RetroCard title="Mis cuentas abiertas" tone="plain"><RetroTable rows={d.orders} columns={[{ key: 'n', header: '#', render: (r: any) => `#${String(r.number).padStart(4, '0')}` }, { key: 't', header: 'Mesa', render: (r: any) => r.tableNumber ?? '—' }, { key: 's', header: 'Estado', render: (r: any) => r.status }, { key: 'total', header: 'Total', numeric: true, render: (r: any) => formatMoney(r.total) }]} empty="Sin cuentas abiertas" /></RetroCard>
  </>}</Async>;
}

function KitchenSummary({ branchId }: { branchId: string }) {
  const nav = useNavigate(); const m = useGet<any>(['kitchen', 'metrics', branchId], '/kitchen/metrics', { branchId }, { refetchInterval: 20_000 }); const d = m.data;
  return <Async q={m}>{d && <><div className="rb-grid rb-grid-3"><RetroStatCard label="Pedidos pendientes" value={d.pending} icon="🧾" /><RetroStatCard label="Tiempo promedio" value={mmss(d.avgSeconds)} icon="⏱" accent="var(--blue)" /><RetroStatCard label="Más antiguo" value={mmss(d.oldestSeconds)} icon="🕰️" accent="var(--mustard)" /><RetroStatCard label="Retrasados" value={d.delayed} icon="🚨" accent="var(--ketchup)" /></div><RetroButton variant="neon" size="lg" onClick={() => nav('/kitchen')}>👨‍🍳 Abrir pantalla de cocina</RetroButton></>}</Async>;
}

function Warehouse({ branchId }: { branchId: string }) {
  const q = useGet<any>(['dashboard', 'warehouse', branchId], '/dashboard/warehouse', { branchId }, { refetchInterval: 60_000 }); const d = q.data;
  return <Async q={q}>{d && <>
    <div className="rb-grid rb-grid-3"><RetroStatCard label="Insumos" value={d.summary.total} icon="📦" /><RetroStatCard label="Bajos" value={d.summary.low} icon="🟡" accent="var(--mustard)" /><RetroStatCard label="Agotados" value={d.summary.out} icon="⚫" accent="var(--ink)" /><RetroStatCard label="Valor del inventario" value={formatMoney(d.summary.value)} icon="💲" accent="var(--neon-dark)" />
      <RetroStatCard label="Entradas (24 h)" value={Math.round(d.flow24h.entries)} icon="⬇️" accent="var(--blue)" /><RetroStatCard label="Salidas (24 h)" value={Math.round(d.flow24h.exits)} icon="⬆️" accent="var(--orange)" /></div>
    <div className="rb-grid rb-grid-2">
      <RetroCard title="Productos bajos" tone="red"><RetroTable rows={d.lowItems} columns={[{ key: 'name', header: 'Insumo' }, { key: 'qty', header: 'Existencia', numeric: true }, { key: 'minQty', header: 'Mínimo', numeric: true }]} empty="Todo en niveles normales" /></RetroCard>
      <RetroCard title="⏳ Caducidades próximas" tone="plain"><RetroTable rows={d.expiring} columns={[{ key: 'name', header: 'Insumo' }, { key: 'expiresOn', header: 'Caduca', render: (r: any) => String(r.expiresOn).slice(0, 10) }, { key: 'qty', header: 'Cant.', numeric: true }]} empty="Sin caducidades próximas" /></RetroCard>
      <RetroCard title="🔁 Transferencias activas" tone="plain"><RetroTable rows={d.transfers} columns={[{ key: 'status', header: 'Estado' }, { key: 'n', header: 'Cantidad', numeric: true }]} empty="Ninguna" /></RetroCard>
      <RetroCard title="🛒 Compras abiertas" tone="plain"><RetroTable rows={d.purchases} columns={[{ key: 'status', header: 'Estado' }, { key: 'n', header: 'Órdenes', numeric: true }]} empty="Ninguna" /></RetroCard>
    </div></>}</Async>;
}
void INV_STATUS; void StatusBadge;
