import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroCheck, RetroInput, RetroModal, RetroSelect, RetroTable, RetroTabs } from '@retroburger/ui';
import { STATION_KEYS } from '@retroburger/shared';
import { patch, post, put } from '../app/api';
import { useAct, useBranchId, useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { useArcade } from '../app/idle';
import { useSound, play } from '../app/sound';
import { syncNow, useConnection } from '../offline/connection';
import { Async, FormModal, Row, fmtDate, num } from './common';
import { CodeInput, MfaQr, RecoveryCodes } from '../app/MfaEnroll';
import { rfcLooksValid, useFiscalCatalogs, personOf } from './fiscal/receptor';

type Tab = 'general' | 'fiscal' | 'security' | 'branches' | 'taxes' | 'policies' | 'kitchen' | 'printers' | 'device' | 'sync' | 'integrations';
export default function Settings() {
  const { can } = useSession(); const [tab, setTab] = useState<Tab>('general');
  const tabs: { key: Tab; label: string }[] = [{ key: 'general', label: '🏢 Restaurante' }, ...(can('tenancy.branch.read') ? [{ key: 'branches' as Tab, label: '🏪 Sucursales' }] : []), { key: 'taxes', label: '🧮 Impuestos y pagos' }, ...(can('fiscal.profile.read') ? [{ key: 'fiscal' as Tab, label: '🧾 Facturación' }] : []), ...(can('tenancy.settings.read') ? [{ key: 'policies' as Tab, label: '📐 Reglas y políticas' }] : []), { key: 'kitchen', label: '👨‍🍳 Cocina' }, ...(can('printing.manage') ? [{ key: 'printers' as Tab, label: '🖨️ Impresoras' }] : []), { key: 'security', label: '🔐 Seguridad' }, { key: 'device', label: '🕹️ Este dispositivo' }, { key: 'sync', label: '📡 Sincronización' }, { key: 'integrations', label: '🔌 Integraciones' }];
  return <><RetroTabs value={tab} onChange={setTab} tabs={tabs} />
    {tab === 'general' && <General />}{tab === 'branches' && <Branches />}{tab === 'taxes' && <Taxes />}{tab === 'policies' && <Policies />}{tab === 'kitchen' && <Kitchen />}{tab === 'printers' && <Printers />}{tab === 'fiscal' && <Fiscal />}{tab === 'security' && <Security />}{tab === 'device' && <Device />}{tab === 'sync' && <Sync />}{tab === 'integrations' && <Integrations />}</>;
}

function General() {
  const me = useSession((s) => s.me)!;
  return <RetroCard title="🏢 Restaurante"><div className="rb-grid rb-grid-2">{[['Nombre', me.tenant.name], ['Identificador (slug)', me.tenant.slug], ['Moneda', me.tenant.currency], ['Idioma', me.tenant.locale], ['Zona horaria', me.tenant.timezone]].map(([l, v]) => <div key={String(l)}><div className="rb-label">{l}</div><strong>{v}</strong></div>)}</div><p className="rb-hint">Los datos de cada restaurante están completamente aislados (multi-tenant). Los horarios de operación se configuran por sucursal.</p></RetroCard>;
}

function Fiscal() {
  const { can } = useSession(); const w = can('fiscal.profile.write'); const cat = useFiscalCatalogs();
  const q = useGet<any>(['fiscal', 'profile'], '/fiscal/profile'); const [f, setF] = useState<any | null>(null);
  const cur = f ?? q.data?.profile ?? { rfc: '', legalName: '', regimenFiscal: '', postalCode: '', series: 'A', enabled: true };
  const person = personOf(cur.rfc ?? '');
  const regs = (cat.data?.regimenes ?? []).filter((r) => cat.data?.emitterRegimenes.includes(r.key) && (!person || r.types.includes(person)));
  const save = useAct(() => put('/fiscal/profile', { rfc: cur.rfc.trim().toUpperCase(), legalName: cur.legalName.trim(), regimenFiscal: cur.regimenFiscal, postalCode: cur.postalCode, series: (cur.series || 'A').toUpperCase(), enabled: !!cur.enabled }),
    { invalidate: [['fiscal'], ['invoices']], ok: 'Perfil fiscal guardado', onSuccess: () => setF(null) });
  const win = useGet<Record<string, any>>(['settings', 'global', null], '/settings');
  const setWin = useAct((v: number) => put('/settings', { key: 'fiscal.invoiceWindowDays', value: v, branchId: null }), { invalidate: [['settings']], ok: 'Plazo guardado' });
  const prov = q.data?.provider;
  return <Async q={q}><RetroCard title="🧾 Facturación electrónica (CFDI 4.0 · México)">
    <div className="rb-row rb-wrap"><RetroBadge tone={q.data?.profile?.enabled ? 'ok' : 'warn'}>{q.data?.profile?.enabled ? 'Habilitada' : 'No habilitada'}</RetroBadge>
      {prov ? <RetroBadge tone={prov.simulated ? 'orange' : 'ok'}>{prov.simulated ? 'Proveedor SIMULADO · sin validez fiscal' : `Proveedor: ${prov.key}`}</RetroBadge> : <RetroBadge tone="danger">Sin proveedor de timbrado (PAC)</RetroBadge>}</div>
    <div className="rb-col" style={{ marginTop: 12 }}>
      <Row><RetroInput label="RFC del emisor" value={cur.rfc} disabled={!w} maxLength={13} onChange={(e) => setF({ ...cur, rfc: e.target.value.toUpperCase().replace(/\s/g, '') })} error={cur.rfc.length >= 12 && !rfcLooksValid(cur.rfc) ? 'RFC con formato inválido' : undefined} />
        <RetroInput label="Código postal (lugar de expedición)" value={cur.postalCode} disabled={!w} inputMode="numeric" maxLength={5} onChange={(e) => setF({ ...cur, postalCode: e.target.value.replace(/\D/g, '') })} /></Row>
      <RetroInput label="Razón social" value={cur.legalName} disabled={!w} onChange={(e) => setF({ ...cur, legalName: e.target.value })} hint="Como en tu constancia de situación fiscal, sin «S.A. de C.V.»." />
      <Row><RetroSelect label="Régimen fiscal" value={cur.regimenFiscal} disabled={!w} onChange={(e) => setF({ ...cur, regimenFiscal: e.target.value })} options={[{ value: '', label: person ? 'Selecciona…' : 'Primero captura el RFC' }, ...regs.map((r) => ({ value: r.key, label: `${r.key} · ${r.name}` }))]} />
        <RetroInput label="Serie" value={cur.series} disabled={!w} maxLength={10} onChange={(e) => setF({ ...cur, series: e.target.value.toUpperCase() })} /></Row>
      <RetroCheck label="Facturación habilitada" checked={!!cur.enabled} disabled={!w} onChange={(e) => setF({ ...cur, enabled: e.target.checked })} />
      {w && <div className="rb-row"><RetroButton variant="neon" loading={save.isPending} disabled={!f || !rfcLooksValid(cur.rfc) || !cur.legalName || !cur.regimenFiscal || cur.postalCode.length !== 5} onClick={() => save.mutate()}>Guardar perfil fiscal</RetroButton></div>}
    </div>
    <p className="rb-hint">El sello digital (CSD) y el timbrado los realiza el PAC conectado. El código postal de cada sucursal (lugar de expedición) se edita en Configuración → Sucursales; si no tiene, se usa el de arriba.</p>
  </RetroCard>
    <RetroCard title="⏱️ Plazo para autofacturar" tone="plain"><div className="rb-row rb-wrap"><div className="rb-grow"><strong>Días para pedir factura de un ticket</strong><div className="rb-hint">Desde el sitio público con el código impreso en el ticket (por defecto 31).</div></div>
      <input aria-label="Días para pedir factura de un ticket" key={String(win.data?.['fiscal.invoiceWindowDays'])} className="rb-input" style={{ width: 110 }} inputMode="numeric" defaultValue={win.data?.['fiscal.invoiceWindowDays'] ?? 31} disabled={!can('tenancy.settings.write')} onBlur={(e) => { const n = Math.round(num(e.target.value)); if (n >= 1 && n <= 365 && n !== (win.data?.['fiscal.invoiceWindowDays'] ?? 31)) setWin.mutate(n); }} /></div></RetroCard></Async>;
}

function Security() {
  const me = useSession((s) => s.me)!; const refreshMe = useSession((s) => s.refreshMe);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null); const [code, setCode] = useState('');
  const [off, setOff] = useState<{ password: string; code: string } | null>(null);
  const start = useAct(() => post('/auth/2fa/setup'), { onSuccess: (r) => { setSetup(r); setCode(''); } });
  const enable = useAct(() => post('/auth/2fa/enable', { code }), { onSuccess: (r) => { setSetup(null); setCodes(r.recoveryCodes); } });
  const disable = useAct(() => post('/auth/2fa/disable', { password: off!.password, code: off!.code.trim() }), { ok: 'Verificación en dos pasos desactivada', onSuccess: () => { setOff(null); void refreshMe(); } });
  const { enabled, required } = me.mfa;
  return <><RetroCard title="🔐 Verificación en dos pasos (2FA)" tone={enabled ? 'plain' : 'red'}>
    <div className="rb-row rb-wrap"><RetroBadge tone={enabled ? 'ok' : 'warn'}>{enabled ? '🔐 Activa' : '🔓 Desactivada'}</RetroBadge>{required && <RetroBadge tone="info">Obligatoria para tu rol</RetroBadge>}</div>
    <p className="rb-hint">Además de tu contraseña se pide un código de 6 dígitos de tu app de autenticación (Google Authenticator, Authy, 1Password…). Protege las cuentas con acceso a toda la operación y al dinero.</p>
    {!enabled && <RetroButton variant="neon" loading={start.isPending} onClick={() => start.mutate()}>Activar 2FA</RetroButton>}
    {enabled && !required && <RetroButton variant="white" onClick={() => setOff({ password: '', code: '' })}>Desactivar 2FA</RetroButton>}
    {enabled && required && <p className="rb-hint">Tu rol exige 2FA; no se puede desactivar. Si pierdes el teléfono, pide a otro administrador que reinicie tu 2FA o usa un código de recuperación.</p>}
  </RetroCard>
    <FormModal open={!!setup} onClose={() => setSetup(null)} title="Activar verificación en dos pasos" busy={enable.isPending} disabled={code.length !== 6} submitLabel="Activar" onSubmit={() => enable.mutate()}>{setup && <>
      <p className="rb-hint" style={{ margin: 0 }}>1. Escanea el QR con tu app de autenticación. 2. Escribe el código de 6 dígitos que muestra.</p>
      <MfaQr uri={setup.otpauthUri} secret={setup.secret} /><CodeInput value={code} onChange={setCode} /></>}</FormModal>
    <RetroModal open={!!codes} onClose={() => { /* se cierra sólo al confirmar que guardó los códigos */ }} title="2FA activado" size="sm" dismissible={false}>{codes && <RecoveryCodes codes={codes} onDone={() => { setCodes(null); void refreshMe(); }} />}</RetroModal>
    <FormModal open={!!off} onClose={() => setOff(null)} title="Desactivar 2FA" size="sm" busy={disable.isPending} disabled={!off?.password || (off?.code.length ?? 0) < 6} submitLabel="Desactivar" onSubmit={() => disable.mutate()}>{off && <>
      <RetroInput label="Contraseña" type="password" autoComplete="current-password" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} />
      <RetroInput label="Código de 6 dígitos (o de recuperación)" value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value })} autoComplete="one-time-code" /></>}</FormModal></>;
}

function Branches() {
  const { can } = useSession(); const q = useGet<any[]>(['branches', 'full'], '/branches'); const [f, setF] = useState<any | null>(null);
  const save = useAct(() => patch(`/branches/${f.id}`, { name: f.name, address: f.address || undefined, phone: f.phone || undefined, status: f.status, timezone: f.timezone, postalCode: /^\d{5}$/.test(f.postalCode ?? '') ? f.postalCode : undefined }), { invalidate: [['branches'], ['dashboard']], ok: 'Sucursal actualizada', onSuccess: () => setF(null) });
  return <><Async q={q}><RetroTable rows={q.data ?? []} onRowClick={can('tenancy.branch.write') ? setF : undefined} columns={[{ key: 'code', header: 'Código' }, { key: 'name', header: 'Nombre' }, { key: 'address', header: 'Dirección', render: (r: any) => r.address ?? '—' }, { key: 'tz', header: 'Zona horaria', render: (r: any) => r.timezone }, { key: 'st', header: 'Estado', render: (r: any) => <RetroBadge tone={r.status === 'OPEN' ? 'ok' : 'warn'}>{r.status}</RetroBadge> }]} /></Async>
    <FormModal open={!!f} onClose={() => setF(null)} title="Editar sucursal" busy={save.isPending} onSubmit={() => save.mutate()}>{f && <><RetroInput label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroInput label="Dirección" value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /><Row><RetroInput label="Teléfono" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /><RetroInput label="C.P. (expedición de facturas)" value={f.postalCode ?? ''} inputMode="numeric" maxLength={5} onChange={(e) => setF({ ...f, postalCode: e.target.value.replace(/\D/g, '') })} /></Row><Row><RetroSelect label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'OPEN', label: 'Operando' }, { value: 'CLOSED', label: 'Cerrada' }, { value: 'MAINTENANCE', label: 'Mantenimiento' }]} /></Row></>}</FormModal></>;
}

function Taxes() {
  const { can } = useSession(); const q = useGet<any[]>(['taxes'], '/taxes'); const [f, setF] = useState<any | null>(null);
  const save = useAct(() => post('/taxes', { name: f.name, rate: num(String(f.rate)) / 100, includedInPrice: f.included ?? true, isDefault: f.isDefault ?? false }), { invalidate: [['taxes'], ['catalog']], ok: 'Impuesto creado', onSuccess: () => setF(null) });
  return <><RetroCard title="🧮 Impuestos" actions={can('catalog.product.write') && <RetroButton size="sm" variant="neon" onClick={() => setF({ name: '', rate: 16, included: true })}>+ Impuesto</RetroButton>} flush><RetroTable rows={q.data ?? []} columns={[{ key: 'name', header: 'Impuesto' }, { key: 'rate', header: 'Tasa', numeric: true, render: (r: any) => `${Math.round(r.rate * 10000) / 100}%` }, { key: 'inc', header: 'En precio', render: (r: any) => (r.includedInPrice ? 'Incluido' : 'Se suma') }, { key: 'd', header: 'Predeterminado', render: (r: any) => (r.isDefault ? '✅' : '') }]} /></RetroCard>
    <RetroCard title="💳 Métodos de pago" tone="plain"><div className="rb-row rb-wrap"><RetroBadge tone="ok">💵 Efectivo</RetroBadge><RetroBadge tone="ok">💳 Tarjeta</RetroBadge><RetroBadge tone="ok">🏦 Transferencia</RetroBadge><RetroBadge tone="ok">📱 QR</RetroBadge></div><p className="rb-hint">Se registra método y referencia; no se almacenan datos de tarjeta (fuera de alcance PCI). Propinas: sugeridas 0/10/15/20 % o monto libre en el cobro.</p></RetroCard>
    <FormModal open={!!f} onClose={() => setF(null)} title="Nuevo impuesto" size="sm" busy={save.isPending} disabled={!f?.name} onSubmit={() => save.mutate()}>{f && <><RetroInput label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroInput label="Tasa %" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /><RetroCheck label="Incluido en el precio" checked={f.included ?? true} onChange={(e) => setF({ ...f, included: e.target.checked })} /><RetroCheck label="Predeterminado" checked={f.isDefault ?? false} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /></>}</FormModal></>;
}

const POLICIES: { key: string; label: string; hint: string; type: 'number' | 'bool' | 'text'; def: any }[] = [
  { key: 'sales.discountThresholdPct', label: 'Descuento máximo sin autorización (%)', hint: 'Por encima se pide PIN de gerente', type: 'number', def: 10 },
  { key: 'cash.tolerance', label: 'Tolerancia de diferencia en corte ($)', hint: 'Mayor requiere comentario y autorización', type: 'number', def: 50 },
  { key: 'cash.expenseLimit', label: 'Gasto de caja sin autorización ($)', hint: 'Los retiros siempre requieren autorización', type: 'number', def: 500 },
  { key: 'purchasing.approvalThreshold', label: 'Umbral de aprobación de compras ($)', hint: 'Órdenes mayores requieren aprobación', type: 'number', def: 10000 },
  { key: 'inventory.allowNegativeSales', label: 'Permitir vender sin existencia', hint: 'Si está apagado, se bloquea el envío a cocina sin stock', type: 'bool', def: false },
  { key: 'qr.autoSend', label: 'Pedidos por QR directo a cocina', hint: 'Apagado: el mesero confirma cada pedido', type: 'bool', def: false },
  { key: 'delivery.fee', label: 'Cargo de envío predeterminado ($)', hint: 'Para pedidos en línea a domicilio', type: 'number', def: 30 },
  { key: 'notifications.emailTo', label: 'Correos para alertas críticas', hint: 'Separados por coma: reciben por correo las alertas críticas (inventario descuadrado, etc.)', type: 'text', def: '' },
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
      {p.type === 'text' ? <input aria-label={p.label} key={String(v)} className="rb-input" style={{ width: 260 }} type="text" defaultValue={Array.isArray(v) ? v.join(', ') : v} disabled={!w} onBlur={(e) => { if (e.target.value !== String(v)) save.mutate({ key: p.key, value: e.target.value.trim() }); }} /> : p.type === 'bool' ? <RetroCheck label={v ? 'Sí' : 'No'} checked={!!v} disabled={!w} onChange={(e) => save.mutate({ key: p.key, value: e.target.checked })} /> : <input aria-label={p.label} key={String(v)} className="rb-input" style={{ width: 130 }} inputMode="decimal" defaultValue={v} disabled={!w} onBlur={(e) => { if (e.target.value !== String(v) && e.target.value !== '') save.mutate({ key: p.key, value: num(e.target.value) }); }} />}</div>; })}</div></RetroCard></Async>;
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
  const save = useAct(() => { const b = { branchId, name: f.name, role: f.role, columns: num(String(f.columns ?? 42)), connection: { type: f.ctype ?? 'network', host: f.ctype === 'file' ? undefined : f.host || undefined, port: f.ctype === 'file' ? undefined : f.port ? num(String(f.port)) : 9100, path: f.ctype === 'file' ? f.path || undefined : undefined, codepage: f.codepage ? num(String(f.codepage)) : undefined, beep: f.role === 'KITCHEN' ? !!f.beep : undefined, openDrawer: f.role === 'CASH' ? !!f.openDrawer : undefined }, stationKeys: (f.stationKeys ?? '').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean), isActive: f.isActive ?? true }; return f.id ? put(`/printers/${f.id}`, b) : post('/printers', b); }, { invalidate: [['printers']], ok: 'Impresora guardada', onSuccess: () => setF(null) });
  return <><RetroCard title="🖨️ Impresoras de la sucursal" actions={<RetroButton size="sm" variant="neon" onClick={() => setF({ role: 'KITCHEN', columns: 42, ctype: 'network', port: 9100, isActive: true, stationKeys: '' })}>+ Impresora</RetroButton>} flush><RetroTable rows={q.data ?? []} onRowClick={(r) => setF({ ...r, ctype: r.connection?.type === 'usb' ? 'file' : r.connection?.type, host: r.connection?.host, port: r.connection?.port, path: r.connection?.path, codepage: r.connection?.codepage, beep: r.connection?.beep, openDrawer: r.connection?.openDrawer, stationKeys: (r.stationKeys ?? []).join(', ') })} columns={[{ key: 'name', header: 'Nombre' }, { key: 'role', header: 'Función', render: (r: any) => ({ KITCHEN: 'Cocina', CASH: 'Caja', BAR: 'Barra' } as any)[r.role] }, { key: 'st', header: 'Estaciones', render: (r: any) => (r.stationKeys ?? []).join(', ') || 'Todas' }, { key: 'c', header: 'Conexión', render: (r: any) => r.connection?.type === 'network' ? `Red ${r.connection.host ?? ''}:${r.connection.port ?? 9100}` : r.connection?.path ? `Dispositivo ${r.connection.path}` : '—' }, { key: 'a', header: 'Activa', render: (r: any) => (r.isActive ? '✅' : '⛔') }]} /></RetroCard>
    <p className="rb-hint">Las comandas, tickets y cortes se encolan por impresora (texto ESC/POS-ready). El agente local (apps/print-agent, cuenta con rol «Agente de impresión») recoge los trabajos pendientes, los envía en ESC/POS y confirma la impresión; si la impresora está apagada los conserva y reintenta.</p>
    <FormModal open={!!f} onClose={() => setF(null)} title="Impresora" busy={save.isPending} disabled={!f?.name} onSubmit={() => save.mutate()}>{f && <><Row><RetroInput label="Nombre" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroSelect label="Función" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={[{ value: 'KITCHEN', label: 'Cocina' }, { value: 'CASH', label: 'Caja' }, { value: 'BAR', label: 'Barra' }]} /></Row><Row><RetroSelect label="Conexión" value={f.ctype} onChange={(e) => setF({ ...f, ctype: e.target.value })} options={[{ value: 'network', label: 'Red (IP, puerto 9100)' }, { value: 'file', label: 'USB / dispositivo (ruta)' }]} /><RetroInput label="Columnas" type="number" value={f.columns} onChange={(e) => setF({ ...f, columns: e.target.value })} /></Row>{f.ctype === 'file' ? <RetroInput label="Ruta del dispositivo" placeholder="/dev/usb/lp0" value={f.path ?? ''} onChange={(e) => setF({ ...f, path: e.target.value })} /> : <Row><RetroInput label="IP" value={f.host ?? ''} onChange={(e) => setF({ ...f, host: e.target.value })} /><RetroInput label="Puerto" value={f.port ?? 9100} onChange={(e) => setF({ ...f, port: e.target.value })} /></Row>}<Row><RetroInput label="Página de códigos (CP858)" type="number" placeholder="19 (Epson)" value={f.codepage ?? ''} onChange={(e) => setF({ ...f, codepage: e.target.value })} />{f.role === 'KITCHEN' ? <RetroCheck label="Zumbador al imprimir comanda" checked={!!f.beep} onChange={(e) => setF({ ...f, beep: e.target.checked })} /> : f.role === 'CASH' ? <RetroCheck label="Abrir cajón al imprimir ticket" checked={!!f.openDrawer} onChange={(e) => setF({ ...f, openDrawer: e.target.checked })} /> : <span />}</Row><RetroInput label="Estaciones (coma)" placeholder="PARRILLA, FREIDORA" value={f.stationKeys ?? ''} onChange={(e) => setF({ ...f, stationKeys: e.target.value })} /></>}</FormModal></>;
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
  const { can } = useSession(); const st = useGet<{ transport: string }>(['mail', 'status'], '/mail/status', undefined, { enabled: can('tenancy.settings.read') });
  const ob = useGet<any[]>(['mail', 'outbox'], '/mail/outbox', { limit: 15 }, { enabled: can('tenancy.settings.read') });
  const [to, setTo] = useState('');
  const test = useAct(() => post('/mail/test', { to }), { invalidate: [['mail']], ok: 'Correo de prueba procesado' });
  const real = st.data?.transport === 'smtp';
  return <><RetroCard title="🔌 Integraciones"><div className="rb-col">{[['Facturación fiscal (CFDI)', 'Flujo completo con proveedor simulado; conecta un PAC real (docs/FISCAL.md).'], ['Pasarela de pagos / terminal', 'Hoy se registra método y referencia; sin cobro en línea.'], ['Impresión térmica', 'Cola activa; instala el agente local ESC/POS (apps/print-agent).'], ['SMS / push', 'No disponibles aún; notificaciones in-app y correo.'], ['Delivery de terceros', 'Pedidos externos entran por la API pública / sincronización.']].map(([t, d]) => <div key={t} className="rb-row"><strong>{t}</strong><span className="rb-muted rb-grow">{d}</span></div>)}</div></RetroCard>
    {can('tenancy.settings.read') && <RetroCard title="✉️ Correo saliente" tone="plain"><div className="rb-col">
      <div className="rb-row rb-wrap"><RetroBadge tone={real ? 'ok' : 'orange'}>{real ? 'SMTP configurado' : 'Modo registro (sin SMTP_URL): no sale correo real'}</RetroBadge></div>
      <div className="rb-row rb-wrap"><div className="rb-grow"><RetroInput label="Enviar correo de prueba a" type="email" value={to} onChange={(e) => setTo(e.target.value)} /></div>{can('tenancy.settings.write') && <RetroButton variant="neon" loading={test.isPending} disabled={!to.includes('@')} onClick={() => test.mutate()}>Enviar prueba</RetroButton>}</div>
      <Async q={ob}><RetroTable rows={ob.data ?? []} empty="Sin correos todavía" columns={[{ key: 'a', header: 'Fecha', render: (r: any) => fmtDate(r.createdAt) }, { key: 'k', header: 'Tipo', render: (r: any) => r.kind }, { key: 't', header: 'Para', render: (r: any) => r.to.join(', ') }, { key: 's', header: 'Asunto', render: (r: any) => r.subject }, { key: 'e', header: 'Estado', render: (r: any) => <><RetroBadge tone={r.status === 'SENT' ? 'ok' : r.status === 'FAILED' ? 'danger' : 'warn'}>{r.status}</RetroBadge>{r.lastError && <div className="rb-hint">{r.lastError}</div>}</> }]} /></Async></div></RetroCard>}</>;
}
