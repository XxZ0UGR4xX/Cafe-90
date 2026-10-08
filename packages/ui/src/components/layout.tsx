import { type ReactNode, useEffect } from 'react';
import { NavLink } from './nav-link';
import { RetroButton, RetroLogo, cx } from './core';

export interface NavItem { to: string; icon: string; label: string; badge?: ReactNode }
export type NavEntry = NavItem | 'sep';

// ───────────── RetroSidebar (gabinete arcade) ─────────────
export function RetroSidebar({ items, collapsed, onToggle, footer, brand = 'AMERIX BURGER', tagline = 'DINER · POS · ERP' }: {
  items: NavEntry[]; collapsed: boolean; onToggle: () => void; footer?: ReactNode; brand?: string; tagline?: string;
}) {
  return (
    <aside className="rb-sidebar" aria-label="Navegación principal">
      <div className="rb-brand"><span style={{ fontSize: '1.6rem' }}>🍔</span><span className="rb-brand__text"><RetroLogo name={brand} /><small>{tagline}</small></span></div>
      <nav className="rb-nav">
        {items.map((it, i) => it === 'sep' ? <div key={`s${i}`} className="rb-nav-sep" /> : (
          <NavLink key={it.to} to={it.to} title={collapsed ? it.label : undefined}><span className="ico">{it.icon}</span><span className="lbl">{it.label}</span>{it.badge}</NavLink>
        ))}
      </nav>
      <div className="rb-sidebar__foot">
        {footer}
        <button className="rb-navitem" onClick={onToggle} aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}><span className="ico">{collapsed ? '▶' : '◀'}</span><span className="lbl">Contraer</span></button>
      </div>
    </aside>
  );
}

// ───────────── RetroNavbar ─────────────
export function RetroNavbar({ title, children, onMenu }: { title: ReactNode; children?: ReactNode; onMenu?: () => void }) {
  return (
    <header className="rb-navbar">
      {onMenu && <RetroButton className="rb-menu-btn" variant="ink" size="sm" aria-label="Abrir menú" onClick={onMenu}>☰</RetroButton>}
      <h1>{title}</h1>
      <div className="rb-row rb-wrap rb-end">{children}</div>
    </header>
  );
}

export function RetroAppShell({ collapsed, mobileOpen, sidebar, navbar, children }: { collapsed: boolean; mobileOpen: boolean; sidebar: ReactNode; navbar: ReactNode; children: ReactNode }) {
  return (
    <div className="rb-app" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
      {sidebar}
      <div className="rb-main">{navbar}<div className="rb-checker" /><main className="rb-page">{children}</main></div>
    </div>
  );
}

// ───────────── Indicador de conexión ─────────────
export type ConnectionState = 'online' | 'syncing' | 'offline';
export function ConnectionIndicator({ state, pending = 0 }: { state: ConnectionState; pending?: number }) {
  const label = state === 'online' ? 'ONLINE' : state === 'syncing' ? 'SINCRONIZANDO' : 'OFFLINE';
  return <span className="rb-conn" data-s={state} role="status" title={pending ? `${pending} operaciones pendientes` : undefined}><i />{label}{pending > 0 && ` (${pending})`}</span>;
}

// ───────────── Pantalla arcade ─────────────
export function ArcadeScreen({ onWake }: { onWake: () => void }) {
  useEffect(() => {
    const h = () => onWake();
    window.addEventListener('keydown', h); window.addEventListener('pointerdown', h);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('pointerdown', h); };
  }, [onWake]);
  return (
    <div className="rb-arcade-screen" role="dialog" aria-label="Protector de pantalla">
      <div><div className="burger">🍔</div><h1>RETROBURGER</h1><div className="coin">INSERT COIN</div><p className="coin" style={{ animationDelay: '.5s', marginTop: 18 }}>PRESS START</p></div>
    </div>
  );
}

// ───────────── PIN pad (táctil) ─────────────
export function PinPad({ value, onChange, length = 6, onSubmit }: { value: string; onChange: (v: string) => void; length?: number; onSubmit?: () => void }) {
  const press = (d: string) => { if (value.length < length) onChange(value + d); };
  return (
    <div>
      <div className="rb-pin-dots" aria-label={`${value.length} dígitos`}>{Array.from({ length }, (_, i) => <i key={i} className={cx(i < value.length && 'on')} />)}</div>
      <div className="rb-pin">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <RetroButton key={d} variant="white" onClick={() => press(d)}>{d}</RetroButton>)}
        <RetroButton variant="mustard" onClick={() => onChange(value.slice(0, -1))} aria-label="Borrar">⌫</RetroButton>
        <RetroButton variant="white" onClick={() => press('0')}>0</RetroButton>
        <RetroButton variant="neon" onClick={onSubmit} disabled={value.length < 4}>OK</RetroButton>
      </div>
    </div>
  );
}
