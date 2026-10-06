import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { RetroBadge, type Tone, cx } from './core';

export const formatMoney = (n: number | null | undefined, currency = 'MXN') =>
  n == null ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
export const formatMoney2 = (n: number | null | undefined, currency = 'MXN') =>
  n == null ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const mmss = (sec: number) => `${String(Math.floor(Math.max(sec, 0) / 60)).padStart(2, '0')}:${String(Math.max(sec, 0) % 60).padStart(2, '0')}`;

// ───────────── RetroPOSButton ─────────────
export function RetroPOSButton({ icon, children, color, pressed, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; color?: 'mustard' | 'neon' | 'red' | 'blue'; pressed?: boolean }) {
  return <button type="button" aria-pressed={pressed} className={cx('rb-pos-btn', color && `rb-pos-btn--${color}`, className)} {...rest}>{icon && <span className="em">{icon}</span>}<span>{children}</span></button>;
}

// ───────────── RetroProductCard ─────────────
export function RetroProductCard({ name, price, image, emoji = '🍔', available = true, note, onClick }: { name: string; price: number; image?: string | null; emoji?: string; available?: boolean; note?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="rb-product" disabled={!available} onClick={onClick} aria-label={`${name} ${formatMoney(price)}${available ? '' : ' (agotado)'}`}>
      <div className="rb-product__img" style={image ? { backgroundImage: `url(${image})` } : undefined}>{!image && emoji}</div>
      <div className="rb-product__body">
        <span className="rb-product__name">{name}</span>
        {note && <span className="rb-hint">{note}</span>}
        <span className="rb-product__price">{formatMoney(price)}</span>
        {!available && <RetroBadge tone="danger">Agotado</RetroBadge>}
      </div>
    </button>
  );
}

// ───────────── RetroTableCard ─────────────
const TABLE_LABEL: Record<string, { icon: string; label: string; tone: Tone }> = {
  FREE: { icon: '🟢', label: 'Libre', tone: 'ok' }, OCCUPIED: { icon: '🔴', label: 'Ocupada', tone: 'danger' }, RESERVED: { icon: '🟡', label: 'Reservada', tone: 'warn' }, CLEANING: { icon: '🔵', label: 'Limpieza', tone: 'info' },
};
export function RetroTableCard({ number, capacity, status, customer, seconds, total, round, onClick, extra }: {
  number: number; capacity: number; status: string; customer?: string | null; seconds?: number | null; total?: number | null; round?: boolean; onClick?: () => void; extra?: ReactNode;
}) {
  const s = TABLE_LABEL[status] ?? TABLE_LABEL.FREE!;
  return (
    <button type="button" className="rb-table-card" data-status={status} data-round={round} onClick={onClick} aria-label={`Mesa ${number}, ${s.label}`}>
      <div className="rb-row"><span className="num">{number}</span><span className="rb-end"><RetroBadge tone={s.tone}>{s.icon} {s.label}</RetroBadge></span></div>
      <span className="rb-hint">👥 {capacity} personas</span>
      {customer && <strong>{customer}</strong>}
      {status === 'OCCUPIED' && seconds != null && <span className="rb-mono">⏱ {mmss(seconds)}</span>}
      {status === 'OCCUPIED' && total != null && <span className="rb-display" style={{ fontSize: '1.15rem' }}>{formatMoney(total)}</span>}
      {extra}
    </button>
  );
}

// ───────────── RetroKitchenTicket ─────────────
export interface KitchenTicketData {
  id: string; number: number; tableNumber?: number | null; channel: string; stationKey: string; round: number; status: string; elapsedSeconds: number; sla: 'ok' | 'warn' | 'late';
  items: { id: string; name: string; qty: number; modifiers: string[]; notes?: string | null }[]; orderNotes?: string | null; waiterName?: string | null; customerName?: string | null;
}
export function RetroKitchenTicket({ t, seconds, onClick, actionLabel }: { t: KitchenTicketData; seconds: number; onClick?: () => void; actionLabel?: string }) {
  return (
    <article className="rb-kticket" data-sla={t.status === 'DELIVERED' ? 'ok' : t.sla} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick?.()}>
      <div className="rb-kticket__head">
        <span className="rb-kticket__table">{t.tableNumber ? `MESA ${t.tableNumber}` : t.channel === 'DELIVERY' ? '🛵 DOMICILIO' : t.channel === 'TAKEAWAY' ? '🥡 LLEVAR' : t.channel}</span>
        <span className="rb-mono rb-muted">#{String(t.number).padStart(3, '0')}{t.round > 1 ? ` · R${t.round}` : ''}</span>
        <span className="rb-kticket__timer">⏱ {mmss(seconds)}</span>
      </div>
      <div className="rb-row rb-wrap"><RetroBadge tone="dark">{t.stationKey}</RetroBadge>{t.waiterName && <span className="rb-hint">{t.waiterName}</span>}</div>
      {t.items.map((i) => (
        <div key={i.id}>
          <div className="rb-kticket__item">{i.qty} × {i.name}</div>
          {i.modifiers.map((m) => <div key={m} className="rb-kticket__mod">{m}</div>)}
          {i.notes && <div className="rb-kticket__note">📝 {i.notes}</div>}
        </div>
      ))}
      {t.orderNotes && <div className="rb-kticket__note">NOTAS: {t.orderNotes}</div>}
      {actionLabel && <span className="rb-badge rb-badge--info" style={{ alignSelf: 'flex-start' }}>{actionLabel}</span>}
    </article>
  );
}

// ───────────── RetroOrderCard ─────────────
const ORDER_TONE: Record<string, Tone> = { DRAFT: 'neutral', PENDING: 'warn', CONFIRMED: 'info', PREPARING: 'orange', READY: 'ok', DELIVERED: 'ok', COMPLETED: 'dark', CANCELLED: 'danger' };
export const ORDER_LABEL: Record<string, string> = { DRAFT: 'Borrador', PENDING: 'Pendiente', CONFIRMED: 'Confirmado', PREPARING: 'Preparando', READY: 'Listo', DELIVERED: 'Entregado', COMPLETED: 'Completado', CANCELLED: 'Cancelado' };
export const PAY_LABEL: Record<string, string> = { PENDING: 'Por cobrar', PAID: 'Pagado', PARTIAL: 'Parcial', REFUNDED: 'Devuelto', FAILED: 'Fallido' };
export function RetroOrderCard({ number, status, paymentStatus, total, title, subtitle, onClick, flag }: { number: number; status: string; paymentStatus?: string; total: number; title: ReactNode; subtitle?: ReactNode; onClick?: () => void; flag?: ReactNode }) {
  return (
    <button type="button" className="rb-order-card" onClick={onClick}>
      <div className="rb-row"><span className="rb-display" style={{ fontSize: '1.2rem' }}>#{String(number).padStart(4, '0')}</span>{flag}<span className="rb-end rb-display">{formatMoney(total)}</span></div>
      <div>{title}</div>{subtitle && <div className="rb-hint">{subtitle}</div>}
      <div className="rb-row rb-wrap"><RetroBadge tone={ORDER_TONE[status]}>{ORDER_LABEL[status] ?? status}</RetroBadge>{paymentStatus && <RetroBadge tone={paymentStatus === 'PAID' ? 'ok' : paymentStatus === 'PENDING' ? 'warn' : 'info'}>{PAY_LABEL[paymentStatus] ?? paymentStatus}</RetroBadge>}</div>
    </button>
  );
}
