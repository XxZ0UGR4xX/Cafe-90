import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroCheck, RetroInput, RetroSelect, RetroTable, RetroTabs } from '@retroburger/ui';
import { STATION_KEYS } from '@retroburger/shared';
import { patch, post, put } from '../app/api';
import { useAct, useBranchId, useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { useArcade } from '../app/idle';
import { useSound, play } from '../app/sound';
import { syncNow, useConnection } from '../offline/connection';
import { Async, FormModal, Row, fmtDate, num } from './common';

type Tab = 'general' | 'branches' | 'taxes' | 'policies' | 'kitchen' | 'printers' | 'device' | 'sync' | 'integrations';
export default function Settings() {
  const { can } = useSession(); const [tab, setTab] = useState<Tab>('general');
  const tabs: { key: Tab; label: string }[] = [{ key: 'general', label: '🏢 Restaurante' }, ...(can('tenancy.branch.read') ? [{ key: 'branches' as Tab, label: '🏪 Sucursales' }] : []), { key: 'taxes', label: '🧮 Impuestos y pagos' }, ...(can('tenancy.settings.read') ? [{ key: 'policies' as Tab, label: '📐 Reglas y políticas' }] : []), { key: 'kitchen', label: '👨‍🍳 Cocina' }, ...(can('printing.manage') ? [{ key: 'printers' as Tab, label: '🖨️ Impresoras' }] : []), { key: 'device', label: '🕹️ Este dispositivo' }, { key: 'sync', label: '📡 Sincronización' }, { key: 'integrations', label: '🔌 Integraciones' }];
  return <><RetroTabs value={tab} onChange={setTab} tabs={tabs} />
    {tab === 'general' && <General />}{tab === 'branches' && <Branches />}{tab === 'taxes' && <Taxes />}{tab === 'policies' && <Policies />}{tab === 'kitchen' && <Kitchen />}{tab === 'printers' && <Printers />}{tab === 'device' && <Device />}{tab === 'sync' && <Sync />}{tab === 'integrations' && <Integrations />}</>;
}

function General() {
  const me = useSession((s) => s.me)!;
  return <RetroCard title="🏢 Restaurante"><div className="rb-grid rb-grid-2">{[['Nombre', me.tenant.name], ['Identificador (slug)', me.tenant.slug], ['Moneda', me.tenant.currency], ['Idioma', me.tenant.locale], ['Zona horaria', me.tenant.timezone]].map(([l, v]) => <div key={String(l)}><div className="rb-label">{l}</div><strong>{v}</strong></div>)}</div><p className="rb-hint">Los datos de cada restaurante están completamente aislados (multi-tenant). Los horarios de operación se configuran por sucursal.</p></RetroCard>;
}

function Branches() {
  const { can } = useSession(); const q = useGet<any[]>(['branches', 'full'], '/branches'); const [f, setF] = useState<any | null>(null);
  const save = useAct(() => patch(`/branches/${f.id}`, { name: f.name, address: f.address || undefined, phone: f.phone || undefined, status: f.status, timezone: f.timezone }), { invalidate: [['branches'], ['dashboard']], ok: 'Sucursal actualizada', onSuccess: () => setF(null) });
  return <><Async q={q}><RetroTable rows={q.data ?? []} onRowClick={can('tenancy.branch.write') ? setF : undefined} columns={[{ key: 'code', header: 'Código' }, { key: 'name', header: 'Nombre' }, { key: 'address', header: 'Dirección', render: (r: any) => r.address ?? '—' }, { key: 'tz', header: 'Zona horaria', render: (r: any) => r.timezone }, { key: 'st', header: 'Estado', render: (r: any) => <RetroBadge tone={r.status === 'OPEN' ? 'ok' : 'warn'}>{r.status}</RetroBadge> }]} /></Async>
    <FormModal open={!!f} onClose={() => setF(null)} title="Editar sucursal" busy={save.isPending} onSubmit={() => save.mutate()}>{f && <><RetroInput label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroInput label="Dirección" value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /><Row><RetroInput label="Teléfono" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /><RetroSelect label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'OPEN', label: 'Operando' }, { value: 'CLOSED', label: 'Cerrada' }, { value: 'MAINTENANCE', label: 'Mantenimiento' }]} /></Row></>}</FormModal></>;
}

function Taxes() {
  const { can } = useSession(); const q = useGet<any[]>(['taxes'], '/taxes'); const [f, setF] = useState<any | null>(null);
  const save = useAct(() => post('/taxes', { name: f.name, rate: num(String(f.rate)) / 100, includedInPrice: f.included ?? true, isDefault: f.isDefault ?? false }), { invalidate: [['taxes'], ['catalog']], ok: 'Impuesto creado', onSuccess: () => setF(null) });
  return <><RetroCard title="🧮 Impuestos" actions={can('catalog.product.write') && <RetroButton size="sm" variant="neon" onClick={() => setF({ name: '', rate: 16, included: true })}>+ Impuesto</RetroButton>} flush><RetroTable rows={q.data ?? []} columns={[{ key: 'name', header: 'Impuesto' }, { key: 'rate', header: 'Tasa', numeric: true, render: (r: any) => `${Math.round(r.rate * 10000) / 100}%` }, { key: 'inc', header: 'En precio', render: (r: any) => (r.includedInPrice ? 'Incluido' : 'Se suma') }, { key: 'd', header: 'Predeterminado', render: (r: any) => (r.isDefault ? '✅' : '') }]} /></RetroCard>
    <RetroCard title="💳 Métodos de pago" tone="plain"><div className="rb-row rb-wrap"><RetroBadge tone="ok">💵 Efectivo</RetroBadge><RetroBadge tone="ok">💳 Tarjeta</RetroBadge><RetroBadge tone="ok">🏦 Transferencia</RetroBadge><RetroBadge tone="ok">📱 QR</RetroBadge></div><p className="rb-hint">Se registra método y referencia; no se almacenan datos de tarjeta (fuera de alcance PCI). Propinas: sugeridas 0/10/15/20 % o monto libre en el cobro.</p></RetroCard>
    <FormModal open={!!f} onClose={() => setF(null)} title="Nuevo impuesto" size="sm" busy={save.isPending} disabled={!f?.name} onSubmit={() => save.mutate()}>{f && <><RetroInput label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroInput label="Tasa %" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /><RetroCheck label="Incluido en el precio" checked={f.included ?? true} onChange={(e) => setF({ ...f, included: e.target.checked })} /><RetroCheck label="Predeterminado" checked={f.isDefault ?? false} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /></>}</FormModal></>;
}

const POLICIES: { key: string; label: string; hint: string; type: 'number' | 'bool'; def: any }[] = [
  { key: 'sales.discountThresholdPct', label: 'Descuento máximo sin autorización (%)', hint: 'Por encima se pide PIN de gerente', type: 'number', def: 10 },
  { key: 'cash.tolerance', label: 'Tolerancia de diferencia en corte ($)', hint: 'Mayor requiere comentario y autorización', type: 'number', def: 50 },
  { key: 'cash.expenseLimit', label: 'Gasto de caja sin autorización ($)', hint: 'Los retiros siempre requieren autorización', type: 'number', def: 500 },
  { key: 'purchasing.approvalThreshold', label: 'Umbral de aprobación de compras ($)', hint: 'Órdenes mayores requieren aprobación', type: 'number', def: 10000 },
  { key: 'inventory.allowNegativeSales', label: 'Permitir vender sin existencia', hint: 'Si está apagado, se bloquea el envío a cocina sin stock', type: 'bool', def: false },
  { key: 'qr.autoSend', label: 'Pedidos por QR directo a cocina', hint: 'Apagado: el mesero confirma cada pedido', type: 'bool', def: false },
  { key: 'delivery.fee', label: 'Cargo de envío predeterminado ($)', hint: 'Para pedidos en línea a domicilio', type: 'number', def: 30 },
  { key: 'kitchen.slaWarnMin', label: 'KDS: alerta amarilla (min)', hint: 'Ticket cambia a amarillo', type: 'number', def: 5 },
  { key: 'kitchen.slaLateMin', label: 'KDS: alerta roja (min)', hint: 'Ticket retrasado', type: 'number', def: 10 },
];
function Policies() {
  const { can } = useSession(); const branchId = useBranchId(); const [scope, setScope] = useState<'global' | 'branch'>('global');
  const q = useGet<Record<string, any>>(['settings', scope, branchId], '/settings', { branchId: scope === 'branch' ? branchId : undefined });
  const save = useAct((v: { key: string; value: any }) => put('/settings', { key: v.key, value: v.value, branchId: scope === 'branch' ? branchId : null }), { invalidate: [['settings']], ok: 'Regla guardada' });
  const w = can('tenancy.settings.write');
  return <Async q={q}><RetroCard title="📐 Reglas de operación"><div className="rb-col"><RetroSelect aria-label="Alcance" value={scope} onChange={(e) => setScope(e.target.value as any)} options={[{ value: 'global', label: 'Aplicar a todo el restaurante' }, { value: 'branch', label: 'Solo a la sucursal activa (sobrescribe)' }]} />
    {POLICIES.map((p) => { const v = q.data?.[p.key] ?? p.def; return <div key={p.key} className="rb-row rb-wrap" style={{ borderBottom: '2px dashed var(--line)', paddingBottom: 8 }}><div className="rb-grow"><strong>{p.label}</strong><div className="rb-hint">{p.hint}</div></div>
      {p.type === 'bool' ? <RetroCheck label={v ? 'Sí' : 'No'} checked={!!v} disabled={!w} onChange={(e) => save.mutate({ key: p.key, value: e.target.checked })} /> : <input key={String(v)} className="rb-input" style={{ width: 130 }} inputMode="decimal" defaultValue={v} disabled={!w} onBlur={(e) => { if (e.target.value !== String(v) && e.target.value !== '') save.mutate({ key: p.key, value: num(e.target.value) }); }} />}</div>; })}</div></RetroCard></Async>;
}

function Kitchen() {
  const branchId = useBranchId(); const { can } = useSession(); const q = useGet<any[]>(['kitchen', 'stations', branchId], '/kitchen/stations', { branchId }, { enabled: !!branchId }); const [f, setF] = useState<any | null>(null);
  const save = useAct(() => put(`/kitchen/branches/${branchId}/stations`, { key: f.key, name: f.name, color: f.color || undefined, isActive: f.isActive ?? true }), { invalidate: [['kitchen']], ok: 'Estación guardada', onSuccess: () => setF(null) });
  return <><RetroCard title="👨‍🍳 Estaciones de cocina" actions={can('tenancy.settings.write') && <RetroButton size="sm" variant="neon" onClick={() => setF({ key: '', name: '', isActive: true })}>+ Estación</RetroButton>} flush><RetroTable rows={q.data ?? []} onRowClick={can('tenancy.settings.write') ? setF : undefined} columns={[{ key: 'key', header: 'Clave' }, { key: 'name', header: 'Nombre' }, { key: 'c', header: 'Color', render: (r: any) => <span style={{ display: 'inline-block', width: 22, height: 22, background: r.color ?? '#999', border: '2px solid #111', borderRadius: 4 }} /> }, { key: 'a', header: 'Activa', render: (r: any) => (r.isActive ? '✅' : '⛔') }]} /></RetroCard>
    <p className="rb-hint">Cada producto se enruta automáticamente a su estación (Menú → Producto → Estación). Claves sugeridas: {STATION_KEYS.join(', ')}.</p>
    <FormModal open={!!f} onClose={() => setF(null)} title="Estación" size="sm" busy={save.isPending} disabled={!f?.key || !f?.name} onSubmit={() => save.mutate()}>{f && <><RetroInput label="Clave" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} /><RetroInput label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroInput label="Color" type="color" value={f.color ?? '#d62828'} onChange={(e) => setF({ ...f, color: e.target.value })} /><RetroCheck label="Activa" checked={f.isActive ?? true} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /></>}</FormModal></>;
}

function Printers() {
  const branchId = useBranchId(); const q = useGet<any[]>(['printers', branchId], '/printers', { branchId }, { enabled: !!branchId }); const [f, setF] = useState<any | null>(null);
  const save = useAct(() => { const b = { branchId, name: f.name, role: f.role, columns: num(String(f.columns ?? 42)), connection: { type: f.ctype ?? 'network', host: f.host || undefined, port: f.port ? num(String(f.port)) : 9100 }, stationKeys: (f.stationKeys ?? '').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean), isActive: f.isActive ?? true }; return f.id ? put(`/printers/${f.id}`, b) : post('/printers', b); }, { invalidate: [['printers']], ok: 'Impresora guardada', onSuccess: () => setF(null) });
  return <><RetroCard title="🖨️ Impresoras de la sucursal" actions={<RetroButton size="sm" variant="neon" onClick={() => setF({ role: 'KITCHEN', columns: 42, ctype: 'network', port: 9100, isActive: true, stationKeys: '' })}>+ Impresora</RetroButton>} flush><RetroTable rows={q.data ?? []} onRowClick={(r) => setF({ ...r, ctype: r.connection?.type, host: r.connection?.host, port: r.connection?.port, stationKeys: (r.stationKeys ?? []).join(', ') })} columns={[{ key: 'name', header: 'Nombre' }, { key: 'role', header: 'Función', render: (r: any) => ({ KITCHEN: 'Cocina', CASH: 'Caja', BAR: 'Barra' } as any)[r.role] }, { key: 'st', header: 'Estaciones', render: (r: any) => (r.stationKeys ?? []).join(', ') || 'Todas' }, { key: 'c', header: 'Conexión', render: (r: any) => `${r.connection?.type ?? '—'} ${r.connection?.host ?? ''}` }, { key: 'a', header: 'Activa', render: (r: any) => (r.isActive ? '✅' : '⛔') }]} /></RetroCard>
    <p className="rb-hint">Las comandas, tickets y cortes se encolan por impresora (texto ESC/POS-ready). Un agente local recoge los trabajos pendientes y confirma la impresión.</p>
    <FormModal open={!!f} onClose={() => setF(null)} title="Impresora" busy={save.isPending} disabled={!f?.name} onSubmit={() => save.mutate()}>{f && <><Row><RetroInput label="Nombre" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroSelect label="Función" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={[{ value: 'KITCHEN', label: 'Cocina' }, { value: 'CASH', label: 'Caja' }, { value: 'BAR', label: 'Barra' }]} /></Row><Row><RetroSelect label="Conexión" value={f.ctype} onChange={(e) => setF({ ...f, ctype: e.target.value })} options={[{ value: 'network', label: 'Red (IP)' }, { value: 'usb', label: 'USB / agente local' }]} /><RetroInput label="Columnas" type="number" value={f.columns} onChange={(e) => setF({ ...f, columns: e.target.value })} /></Row><Row><RetroInput label="IP" value={f.host ?? ''} onChange={(e) => setF({ ...f, host: e.target.value })} /><RetroInput label="Puerto" value={f.port ?? 9100} onChange={(e) => setF({ ...f, port: e.target.value })} /></Row><RetroInput label="Estaciones (coma)" placeholder="PARRILLA, FREIDORA" value={f.stationKeys ?? ''} onChange={(e) => setF({ ...f, stationKeys: e.target.value })} /></>}</FormModal></>;
}

function Device() {
  const sound = useSound(); const arcade = useArcade();
  const [perf, setPerf] = useState(() => { try { return localStorage.getItem('rb.perf') === '1'; } catch { return false; } });
  const setPerfMode = (v: boolean) => { setPerf(v); try { localStorage.setItem('rb.perf', v ? '1' : '0'); } catch { /* */ } document.documentElement.classList.toggle('rb-perf', v); };
  return <RetroCard title="🕹️ Este dispositivo"><div className="rb-col">
    <RetroCheck label="🔔 Sonidos (pedido nuevo, listo, venta, error)" checked={sound.enabled} onChange={(e) => { sound.setEnabled(e.target.checked); if (e.target.checked) setTimeout(() => play('coin'), 50); }} />
    <div className="rb-row rb-wrap"><RetroButton size="sm" variant="white" onClick={() => play('newOrder')}>🔔 Pedido nuevo</RetroButton><RetroButton size="sm" variant="white" onClick={() => play('ready')}>🍔 Listo</RetroButton><RetroButton size="sm" variant="white" onClick={() => play('coin')}>🪙 Venta</RetroButton><RetroButton size="sm" variant="white" onClick={() => play('error')}>⚠️ Error</RetroButton></div>
    <RetroCheck label="🕹️ Modo arcade: pantalla “INSERT COIN” al estar inactivo" checked={arcade.enabled} onChange={(e) => arcade.save({ enabled: e.target.checked })} />
    <RetroInput label="Minutos de inactividad" type="number" min={1} max={60} style={{ maxWidth: 140 }} value={arcade.minutes} onChange={(e) => arcade.save({ minutes: Math.max(1, Math.min(60, num(e.target.value) || 5)) })} />
    <RetroCheck label="⚡ Modo rendimiento (sin animaciones)" checked={perf} onChange={(e) => setPerfMode(e.target.checked)} />
    <span className="rb-hint">El protector nunca aparece sobre un carrito abierto ni sobre la pantalla de cocina.</span></div></RetroCard>;
}

function Sync() {
  const branchId = useBranchId(); const conn = useConnection(); const { can } = useSession();
  const q = useGet<any[]>(['sync', 'ex', branchId], '/sync/exceptions', { branchId }, { enabled: !!branchId && can('sales.order.readAll', branchId ?? undefined) });
  const retry = useAct((id: string) => post(`/sync/exceptions/${id}/retry`), { invalidate: [['sync']], ok: 'Reintento ejecutado' });
  const resolve = useAct((id: string) => post(`/sync/exceptions/${id}/resolve`, { note: prompt('Nota de resolución') || 'Revisado por gerente' }), { invalidate: [['sync']], ok: 'Marcada como resuelta' });
  return <><RetroCard title="📡 Estado de sincronización"><div className="rb-row rb-wrap"><RetroBadge tone={conn.state === 'online' ? 'ok' : conn.state === 'syncing' ? 'warn' : 'danger'}>{conn.state.toUpperCase()}</RetroBadge><span>{conn.pending} operaciones pendientes en este dispositivo</span><RetroButton size="sm" variant="neon" onClick={() => void syncNow()}>Sincronizar ahora</RetroButton></div><p className="rb-hint">Las ventas hechas sin conexión se guardan localmente y se envían en orden al reconectar (idempotente). Lo que no pueda aplicarse queda abajo para revisión; nunca se descarta.</p></RetroCard>
    {can('sales.order.readAll', branchId ?? undefined) && <RetroCard title="📥 Bandeja de excepciones" tone="red" flush><Async q={q}><RetroTable rows={q.data ?? []} columns={[{ key: 'at', header: 'Recibida', render: (r: any) => fmtDate(r.receivedAt) }, { key: 't', header: 'Tipo', render: (r: any) => r.type }, { key: 'd', header: 'Dispositivo', render: (r: any) => r.deviceId }, { key: 'e', header: 'Error', render: (r: any) => <span className="rb-error-text">{r.error}</span> }, { key: 'a', header: '', render: (r: any) => <span className="rb-row"><RetroButton size="sm" variant="neon" onClick={() => retry.mutate(r.id)}>Reintentar</RetroButton><RetroButton size="sm" variant="ghost" onClick={() => resolve.mutate(r.id)}>Resolver</RetroButton></span> }]} empty="Sin excepciones 🎉" /></Async></RetroCard>}</>;
}

function Integrations() {
  return <RetroCard title="🔌 Integraciones"><div className="rb-col">{[['Facturación fiscal', 'Interfaz FiscalProvider lista; requiere definir país/PAC.'], ['Pasarela de pagos / terminal', 'Interfaz PaymentGateway lista; hoy se registra método y referencia.'], ['Impresión térmica', 'Cola de impresión activa; instala el agente local ESC/POS.'], ['SMS / correo', 'Notificaciones in-app activas; canales externos por adaptador.'], ['Delivery de terceros', 'Pedidos externos entran por la API pública / sincronización.']].map(([t, d]) => <div key={t} className="rb-row"><strong>{t}</strong><span className="rb-muted rb-grow">{d}</span><RetroBadge tone="warn">Pendiente</RetroBadge></div>)}</div></RetroCard>;
}
