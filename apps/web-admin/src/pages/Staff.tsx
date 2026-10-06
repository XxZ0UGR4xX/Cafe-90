import { useMemo, useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroCheck, RetroInput, RetroSelect, RetroTable, RetroTabs, formatMoney2 } from '@retroburger/ui';
import { PERMISSIONS, ROLE_LABELS, type RoleKey } from '@retroburger/shared';
import { del, patch, post, put } from '../app/api';
import { useAct, useGet } from '../app/hooks';
import { useSession } from '../app/auth';
import { Async, FormModal, Row, fmtDate, num } from './common';

type Tab = 'users' | 'employees' | 'roles';
export default function Staff() {
  const { can } = useSession(); const [tab, setTab] = useState<Tab>(can('identity.user.read') ? 'users' : 'employees');
  const tabs = [...(can('identity.user.read') ? [{ key: 'users' as Tab, label: '🔑 Usuarios y accesos' }] : []), ...(can('staff.employee.read') ? [{ key: 'employees' as Tab, label: '👨‍💼 Empleados (RH)' }] : []), ...(can('identity.role.read') ? [{ key: 'roles' as Tab, label: '🛡️ Roles y permisos' }] : [])];
  return <><RetroTabs value={tab} onChange={setTab} tabs={tabs} />{tab === 'users' && <Users />}{tab === 'employees' && <Employees />}{tab === 'roles' && <Roles />}</>;
}

function Users() {
  const { can } = useSession(); const q = useGet<any[]>(['users'], '/users', { limit: 200 }); const roles = useGet<any[]>(['roles'], '/roles', undefined, { enabled: can('identity.role.read') }); const branches = useGet<any[]>(['branches'], '/branches');
  const [f, setF] = useState<any | null>(null);
  const roleOpts = (roles.data ?? [{ key: 'MESERO', name: 'Mesero' }]).map((r) => ({ value: r.key, label: r.name }));
  const save = useAct(() => {
    const assignment = [{ role: f.role, branchIds: f.allBranches ? null : f.branchIds ?? [] }];
    return f.id ? patch(`/users/${f.id}`, { fullName: f.fullName, status: f.status, pin: f.pin || undefined, password: f.password || undefined, roles: assignment })
      : post('/users', { email: f.email, fullName: f.fullName, password: f.password, pin: f.pin || undefined, userCode: f.userCode || undefined, roles: assignment });
  }, { invalidate: [['users']], ok: 'Usuario guardado', onSuccess: () => setF(null) });
  const resetMfa = useAct((id: string) => post(`/users/${id}/mfa/reset`), { invalidate: [['users']], ok: '2FA reiniciado: deberá volver a configurarlo', onSuccess: () => setF(null) });
  const remove = useAct((id: string) => del(`/users/${id}`), { invalidate: [['users']], ok: 'Usuario eliminado', onSuccess: () => setF(null) });
  const edit = (u: any) => { const r = u.roles[0]; setF({ ...u, fullName: u.full_name, userCode: u.user_code, role: r?.role ?? 'MESERO', allBranches: r ? r.branchId === null : false, branchIds: u.roles.filter((x: any) => x.branchId).map((x: any) => x.branchId) }); };
  return (
    <>
      {can('identity.user.write') && <div className="rb-row"><RetroButton variant="neon" onClick={() => setF({ role: 'MESERO', allBranches: false, branchIds: [], status: 'ACTIVE' })}>+ Usuario</RetroButton></div>}
      <Async q={q}><RetroTable rows={q.data ?? []} onRowClick={can('identity.user.write') ? edit : undefined} columns={[{ key: 'n', header: 'Nombre', render: (u: any) => <strong>{u.full_name}</strong> }, { key: 'e', header: 'Correo', render: (u: any) => u.email }, { key: 'c', header: 'Código PIN', render: (u: any) => u.user_code ?? '—' }, { key: 'r', header: 'Rol', render: (u: any) => [...new Set(u.roles.map((r: any) => ROLE_LABELS[r.role as RoleKey] ?? r.role))].join(', ') }, { key: 'b', header: 'Alcance', render: (u: any) => (u.roles.some((r: any) => r.branchId === null) ? '🌎 Todas' : `${u.roles.length} suc.`) }, { key: 'm', header: '2FA', render: (u: any) => (u.mfa_enabled ? <RetroBadge tone="ok">🔐 Activo</RetroBadge> : <span className="rb-hint">—</span>) }, { key: 'l', header: 'Último acceso', render: (u: any) => fmtDate(u.last_login_at) }, { key: 's', header: 'Estado', render: (u: any) => <RetroBadge tone={u.status === 'ACTIVE' ? 'ok' : 'neutral'}>{u.status}</RetroBadge> }]} /></Async>
      <FormModal open={!!f} onClose={() => setF(null)} title={f?.id ? `Editar · ${f.full_name}` : 'Nuevo usuario'} size="lg" busy={save.isPending} disabled={!f?.fullName || (!f?.id && (!f?.email || !f?.password))} onSubmit={() => save.mutate()}>{f && <>
        <Row><RetroInput label="Nombre completo" value={f.fullName ?? ''} onChange={(e) => setF({ ...f, fullName: e.target.value })} /><RetroInput label="Correo" type="email" disabled={!!f.id} value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Row>
        <Row><RetroInput label={f.id ? 'Nueva contraseña (opcional)' : 'Contraseña (mín. 10)'} type="password" autoComplete="new-password" value={f.password ?? ''} onChange={(e) => setF({ ...f, password: e.target.value })} /><RetroInput label={f.id ? 'Nuevo PIN (opcional)' : 'PIN (4-6 dígitos)'} inputMode="numeric" maxLength={6} value={f.pin ?? ''} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} /></Row>
        {!f.id && <RetroInput label="Código para PIN rápido" value={f.userCode ?? ''} onChange={(e) => setF({ ...f, userCode: e.target.value })} placeholder="mesero1-centro" />}
        <Row><RetroSelect label="Rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={roleOpts} />{f.id && <RetroSelect label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'ACTIVE', label: 'Activo' }, { value: 'DISABLED', label: 'Deshabilitado' }]} />}</Row>
        {useSession.getState().me?.isCorporate && <RetroCheck label="Alcance corporativo (todas las sucursales)" checked={f.allBranches} onChange={(e) => setF({ ...f, allBranches: e.target.checked })} />}
        {!f.allBranches && <><div className="rb-label">Sucursales</div><div className="rb-row rb-wrap">{(branches.data ?? []).map((b) => <RetroCheck key={b.id} label={b.name} checked={(f.branchIds ?? []).includes(b.id)} onChange={(e) => setF({ ...f, branchIds: e.target.checked ? [...(f.branchIds ?? []), b.id] : f.branchIds.filter((x: string) => x !== b.id) })} />)}</div></>}
        {f.id && f.mfa_enabled && f.id !== useSession.getState().me?.id && <RetroButton size="sm" variant="white" loading={resetMfa.isPending} onClick={() => { if (confirm('¿Reiniciar el 2FA de esta persona? Se cerrarán sus sesiones y deberá configurarlo de nuevo.')) resetMfa.mutate(f.id); }}>🔐 Reiniciar 2FA</RetroButton>}
        {f.id && <RetroButton size="sm" variant="ink" onClick={() => { if (confirm('¿Eliminar usuario? Se conserva su historial.')) remove.mutate(f.id); }}>Eliminar usuario</RetroButton>}</>}</FormModal>
    </>
  );
}

function Employees() {
  const { can } = useSession(); const q = useGet<any[]>(['employees'], '/employees'); const branches = useGet<any[]>(['branches'], '/branches'); const [f, setF] = useState<any | null>(null);
  const salary = can('staff.salary.read');
  const save = useAct(() => { const b = { branchId: f.branchId || null, fullName: f.fullName, phone: f.phone || undefined, email: f.email || undefined, position: f.position, salary: salary && f.salary !== '' && f.salary != null ? num(String(f.salary)) : undefined, hiredAt: f.hiredAt?.slice(0, 10) || undefined, status: f.status ?? 'ACTIVE' }; return f.id ? put(`/employees/${f.id}`, b) : post('/employees', b); }, { invalidate: [['employees']], ok: 'Empleado guardado', onSuccess: () => setF(null) });
  return (
    <>
      {can('staff.employee.write') && <div className="rb-row"><RetroButton variant="neon" onClick={() => setF({ status: 'ACTIVE', position: '' })}>+ Empleado</RetroButton></div>}
      <Async q={q}><RetroTable rows={q.data ?? []} onRowClick={can('staff.employee.write') ? setF : undefined} columns={[{ key: 'n', header: 'Nombre', render: (e: any) => <strong>{e.fullName}</strong> }, { key: 'p', header: 'Puesto', render: (e: any) => e.position }, { key: 'b', header: 'Sucursal', render: (e: any) => e.branch ?? '—' }, { key: 'ph', header: 'Teléfono', render: (e: any) => e.phone ?? '' }, ...(salary ? [{ key: 's', header: 'Salario mensual', numeric: true, render: (e: any) => (e.salary == null ? '—' : formatMoney2(e.salary)) }] : []), { key: 'h', header: 'Ingreso', render: (e: any) => (e.hiredAt ? String(e.hiredAt).slice(0, 10) : '—') }, { key: 'st', header: 'Estado', render: (e: any) => <RetroBadge tone={e.status === 'ACTIVE' ? 'ok' : 'neutral'}>{e.status}</RetroBadge> }]} /></Async>
      <FormModal open={!!f} onClose={() => setF(null)} title="Empleado" busy={save.isPending} disabled={!f?.fullName || !f?.position} onSubmit={() => save.mutate()}>{f && <>
        <RetroInput label="Nombre" value={f.fullName ?? ''} onChange={(e) => setF({ ...f, fullName: e.target.value })} /><Row><RetroInput label="Puesto" value={f.position ?? ''} onChange={(e) => setF({ ...f, position: e.target.value })} /><RetroSelect label="Sucursal" value={f.branchId ?? ''} onChange={(e) => setF({ ...f, branchId: e.target.value })} options={[{ value: '', label: 'Corporativo' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))]} /></Row>
        <Row><RetroInput label="Teléfono" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /><RetroInput label="Correo" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Row>
        <Row>{salary && <RetroInput label="Salario mensual" inputMode="decimal" value={f.salary ?? ''} onChange={(e) => setF({ ...f, salary: e.target.value })} />}<RetroInput label="Fecha de ingreso" type="date" value={(f.hiredAt ?? '').slice(0, 10)} onChange={(e) => setF({ ...f, hiredAt: e.target.value })} /></Row>
        <RetroSelect label="Estado" value={f.status ?? 'ACTIVE'} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'ACTIVE', label: 'Activo' }, { value: 'INACTIVE', label: 'Inactivo' }]} /></>}</FormModal>
    </>
  );
}

function Roles() {
  const { can } = useSession(); const q = useGet<any[]>(['roles'], '/roles'); const [f, setF] = useState<any | null>(null);
  const modules = useMemo(() => { const m = new Map<string, string[]>(); for (const p of PERMISSIONS) m.set(p.split('.')[0]!, [...(m.get(p.split('.')[0]!) ?? []), p]); return [...m.entries()]; }, []);
  const save = useAct(() => (f.id ? put(`/roles/${f.id}`, { name: f.name, permissions: f.permissions }) : post('/roles', { key: f.key, name: f.name, permissions: f.permissions })), { invalidate: [['roles']], ok: 'Rol guardado', onSuccess: () => setF(null) });
  const remove = useAct((id: string) => del(`/roles/${id}`), { invalidate: [['roles']], ok: 'Rol eliminado', onSuccess: () => setF(null) });
  const toggle = (p: string) => setF({ ...f, permissions: f.permissions.includes(p) ? f.permissions.filter((x: string) => x !== p) : [...f.permissions, p] });
  return (
    <>
      {can('identity.role.write') && <div className="rb-row"><RetroButton variant="neon" onClick={() => setF({ key: '', name: '', permissions: [] })}>+ Rol personalizado</RetroButton></div>}
      <Async q={q}><RetroTable rows={q.data ?? []} onRowClick={setF} columns={[{ key: 'n', header: 'Rol', render: (r: any) => <strong>{r.name}</strong> }, { key: 'k', header: 'Clave', render: (r: any) => r.key }, { key: 't', header: 'Tipo', render: (r: any) => <RetroBadge tone={r.isSystem ? 'dark' : 'info'}>{r.isSystem ? 'Sistema' : 'Personalizado'}</RetroBadge> }, { key: 'p', header: 'Permisos', numeric: true, render: (r: any) => r.permissions.length }]} /></Async>
      <FormModal open={!!f} onClose={() => setF(null)} title={f?.id ? `Rol · ${f.name}` : 'Nuevo rol'} size="lg" busy={save.isPending} disabled={!f?.name || (!f?.id && !f?.key) || f?.isSystem || !can('identity.role.write')} submitLabel={f?.isSystem ? 'Solo lectura' : 'Guardar'} onSubmit={() => save.mutate()}>{f && <>
        <Row><RetroInput label="Nombre" value={f.name} disabled={f.isSystem} onChange={(e) => setF({ ...f, name: e.target.value })} />{!f.id && <RetroInput label="Clave" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />}</Row>
        {f.isSystem && <div className="rb-hint">Los roles del sistema no se modifican; crea un rol personalizado para ajustar permisos.</div>}
        {modules.map(([m, perms]) => <RetroCard key={m} title={m.toUpperCase()} tone="plain"><div className="rb-grid rb-grid-3" style={{ gap: 6 }}>{perms.map((p) => <RetroCheck key={p} label={<span style={{ fontSize: '.8rem' }}>{p.split('.').slice(1).join('.')}</span>} checked={f.permissions.includes(p)} disabled={f.isSystem || !can(p)} onChange={() => toggle(p)} />)}</div></RetroCard>)}
        {f.id && !f.isSystem && <RetroButton size="sm" variant="ink" onClick={() => remove.mutate(f.id)}>Eliminar rol</RetroButton>}</>}</FormModal>
    </>
  );
}
