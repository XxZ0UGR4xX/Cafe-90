import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArcadeScreen, ConnectionIndicator, RetroAppShell, RetroBadge, RetroButton, RetroModal, RetroNavbar, RetroSelect, RetroSidebar } from '@retroburger/ui';
import { ROLE_LABELS, type RoleKey } from '@retroburger/shared';
import { useSession } from './auth';
import { useBranch } from './branch';
import { useGet, useAct } from './hooks';
import { buildNav, titleOf } from './nav';
import { useRealtimeSync } from './realtime';
import { SupervisorProvider } from './supervisor';
import { useSound } from './sound';
import { useArcade } from './idle';
import { post } from './api';
import { startConnectionMonitor, useConnection } from '../offline/connection';

const COLLAPSE_KEY = 'rb.collapsed';

export function Shell() {
  const { me, can, logout } = useSession(); const loc = useLocation(); const nav = useNavigate(); const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const [mobile, setMobile] = useState(false); const [bell, setBell] = useState(false); const [idle, setIdle] = useState(false);
  const { branchId, set: setBranch } = useBranch(); const conn = useConnection(); const sound = useSound(); const arcade = useArcade();
  useRealtimeSync(); useEffect(() => { startConnectionMonitor(); }, []);
  useEffect(() => { setMobile(false); }, [loc.pathname]);

  const branches = useGet<{ id: string; name: string; code: string }[]>(['branches'], '/branches', undefined, { enabled: can('tenancy.branch.read') });
  useEffect(() => {   // sucursal activa: válida y dentro del alcance del usuario
    const list = branches.data; if (!list?.length) return;
    if (!branchId || !list.some((b) => b.id === branchId)) setBranch(list[0]!.id);
  }, [branches.data, branchId, setBranch]);

  const notes = useGet<any[]>(['notifications'], '/notifications', { limit: 30 }, { enabled: can('notifications.read'), refetchInterval: 60_000 });
  const unread = (notes.data ?? []).filter((n) => !n.read).length;
  const readAll = useAct(() => post('/notifications/read-all'), { invalidate: [['notifications']] });

  // Protector de pantalla "INSERT COIN" (opcional, nunca sobre POS con carrito ni KDS)
  useEffect(() => {
    if (!arcade.enabled || arcade.blockers > 0) { setIdle(false); return; }
    let t: ReturnType<typeof setTimeout>; const reset = () => { clearTimeout(t); t = setTimeout(() => setIdle(true), arcade.minutes * 60_000); };
    const evs = ['pointerdown', 'keydown', 'pointermove'] as const; evs.forEach((e) => window.addEventListener(e, reset, { passive: true })); reset();
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, reset)); };
  }, [arcade.enabled, arcade.minutes, arcade.blockers]);

  if (!me) return null;
  const roles = [...new Set(me.roles.map((r) => ROLE_LABELS[r.roleKey as RoleKey] ?? r.roleKey))].join(' · ');
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* */ } return !c; });
  const fullscreen = loc.pathname.startsWith('/kitchen');

  return (
    <SupervisorProvider>
      <RetroAppShell collapsed={collapsed} mobileOpen={mobile}
        sidebar={<RetroSidebar items={buildNav(can)} collapsed={collapsed} onToggle={toggle}
          footer={<div className="rb-row" style={{ color: 'var(--cream)', padding: '2px 6px' }}><span style={{ fontSize: '1.4rem' }}>👤</span><span className="lbl" style={{ minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.fullName}</strong><small style={{ opacity: .7 }}>{roles}</small></span></div>} />}
        navbar={<RetroNavbar title={titleOf(loc.pathname)} onMenu={() => setMobile((m) => !m)}>
          {(branches.data?.length ?? 0) > 0 && <RetroSelect aria-label="Sucursal" value={branchId ?? ''} onChange={(e) => { setBranch(e.target.value); qc.invalidateQueries(); }} options={branches.data!.map((b) => ({ value: b.id, label: b.name }))} />}
          <ConnectionIndicator state={conn.state} pending={conn.pending} />
          <RetroButton size="sm" variant="white" aria-label="Sonidos" title="Sonidos" onClick={() => sound.setEnabled(!sound.enabled)}>{sound.enabled ? '🔔' : '🔕'}</RetroButton>
          {can('notifications.read') && <RetroButton size="sm" variant="mustard" aria-label="Notificaciones" onClick={() => setBell(true)}>📣{unread > 0 && <RetroBadge tone="danger">{unread}</RetroBadge>}</RetroButton>}
          <RetroButton size="sm" variant="ink" onClick={async () => { await logout(); nav('/'); }}>Salir</RetroButton>
        </RetroNavbar>}>
        {fullscreen ? <Outlet /> : <Outlet />}
      </RetroAppShell>
      <RetroModal open={bell} title="📣 Notificaciones" onClose={() => setBell(false)} footer={<RetroButton variant="white" onClick={() => readAll.mutate()}>Marcar todas como leídas</RetroButton>}>
        <div className="rb-col" style={{ gap: 8 }}>
          {(notes.data ?? []).length === 0 && <div className="rb-empty">Sin notificaciones 🎉</div>}
          {(notes.data ?? []).map((n) => (
            <div key={n.id} className="rb-row" style={{ opacity: n.read ? .55 : 1, borderBottom: '2px dashed var(--line)', paddingBottom: 6 }}>
              <div className="rb-grow"><strong>{n.title}</strong>{n.body && <div className="rb-hint">{n.body}</div>}<div className="rb-hint">{new Date(n.createdAt).toLocaleString('es-MX')}</div></div>
              <RetroBadge tone={n.severity === 'CRITICAL' ? 'danger' : n.severity === 'WARNING' ? 'warn' : 'info'}>{n.severity}</RetroBadge>
            </div>
          ))}
        </div>
      </RetroModal>
      {idle && <ArcadeScreen onWake={() => setIdle(false)} />}
    </SupervisorProvider>
  );
}
