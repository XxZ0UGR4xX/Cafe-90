import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, forwardRef, useId } from 'react';

const cx = (...a: (string | false | undefined | null)[]) => a.filter(Boolean).join(' ');
export { cx };

// ───────────── RetroButton ─────────────
export interface RetroButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'red' | 'mustard' | 'neon' | 'blue' | 'ink' | 'white' | 'ghost'; size?: 'sm' | 'md' | 'lg'; block?: boolean; loading?: boolean;
}
export const RetroButton = forwardRef<HTMLButtonElement, RetroButtonProps>(function RetroButton({ variant = 'red', size = 'md', block, loading, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} data-loading={loading || undefined} disabled={disabled || loading}
      className={cx('rb-btn', variant !== 'red' && `rb-btn--${variant}`, size !== 'md' && `rb-btn--${size}`, block && 'rb-btn--block', className)} {...rest}>
      {loading && <span className="rb-spinner" aria-hidden />}{children}
    </button>
  );
});

// ───────────── RetroCard ─────────────
export interface RetroCardProps { title?: ReactNode; tone?: 'mustard' | 'red' | 'neon' | 'blue' | 'plain'; actions?: ReactNode; flush?: boolean; hover?: boolean; className?: string; children: ReactNode; onClick?: () => void }
export function RetroCard({ title, tone = 'mustard', actions, flush, hover, className, children, onClick }: RetroCardProps) {
  return (
    <section className={cx('rb-card', tone !== 'mustard' && `rb-card--${tone}`, flush && 'rb-card--flush', hover && 'rb-card--hover', className)} onClick={onClick}>
      {(title || actions) && <header className="rb-card__head"><h3>{title}</h3><span className="rb-end rb-row">{actions}</span></header>}
      <div className="rb-card__body">{children}</div>
    </section>
  );
}

// ───────────── Campos ─────────────
export interface FieldProps { label?: ReactNode; hint?: ReactNode; error?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }
export function RetroField({ label, hint, error, htmlFor, children, className }: FieldProps) {
  return (
    <div className={cx('rb-field', className)}>
      {label && <label className="rb-label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <span className="rb-error-text" role="alert">{error}</span> : hint ? <span className="rb-hint">{hint}</span> : null}
    </div>
  );
}
type WithField = { label?: ReactNode; hint?: ReactNode; error?: ReactNode };
export const RetroInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & WithField & { large?: boolean }>(function RetroInput({ label, hint, error, large, className, id, ...rest }, ref) {
  const uid = useId(); const iid = id ?? uid;
  return <RetroField label={label} hint={hint} error={error} htmlFor={iid}><input ref={ref} id={iid} aria-invalid={!!error || undefined} className={cx('rb-input', large && 'rb-input--lg', className)} {...rest} /></RetroField>;
});
export const RetroTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & WithField>(function RetroTextarea({ label, hint, error, className, id, ...rest }, ref) {
  const uid = useId(); const iid = id ?? uid;
  return <RetroField label={label} hint={hint} error={error} htmlFor={iid}><textarea ref={ref} id={iid} aria-invalid={!!error || undefined} className={cx('rb-textarea', className)} {...rest} /></RetroField>;
});
export interface RetroSelectProps extends SelectHTMLAttributes<HTMLSelectElement>, WithField { options?: { value: string; label: string }[] }
export const RetroSelect = forwardRef<HTMLSelectElement, RetroSelectProps>(function RetroSelect({ label, hint, error, options, className, id, children, ...rest }, ref) {
  const uid = useId(); const iid = id ?? uid;
  return (
    <RetroField label={label} hint={hint} error={error} htmlFor={iid}>
      <select ref={ref} id={iid} aria-invalid={!!error || undefined} className={cx('rb-select', className)} {...rest}>
        {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}{children}
      </select>
    </RetroField>
  );
});
export function RetroCheck({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return <label className="rb-check"><input type="checkbox" {...rest} />{label}</label>;
}

// ───────────── RetroBadge ─────────────
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'dark' | 'orange' | 'neutral';
export function RetroBadge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={cx('rb-badge', tone !== 'neutral' && `rb-badge--${tone}`)}>{children}</span>;
}

// ───────────── RetroTable ─────────────
export interface Column<T> { key: string; header: ReactNode; render?: (row: T) => ReactNode; numeric?: boolean; width?: string }
export function RetroTable<T extends Record<string, any>>({ columns, rows, rowKey, onRowClick, empty = 'Sin registros', footer }: {
  columns: Column<T>[]; rows: T[]; rowKey?: (r: T, i: number) => string; onRowClick?: (r: T) => void; empty?: ReactNode; footer?: ReactNode;
}) {
  return (
    <div className="rb-table-wrap">
      <table className="rb-table">
        <thead><tr>{columns.map((c) => <th key={c.key} style={{ width: c.width, textAlign: c.numeric ? 'right' : undefined }}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length}><div className="rb-empty"><div className="big">🍟</div>{empty}</div></td></tr>}
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : (r.id ?? i)} data-click={!!onRowClick} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key} className={c.numeric ? 'num' : undefined}>{c.render ? c.render(r) : (r[c.key] as ReactNode)}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

// ───────────── RetroTabs ─────────────
export function RetroTabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: ReactNode }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="rb-tabs" role="tablist">
      {tabs.map((t) => <button key={t.key} role="tab" aria-selected={t.key === value} className="rb-tab" onClick={() => onChange(t.key)}>{t.label}</button>)}
    </div>
  );
}

// ───────────── RetroStatCard ─────────────
export function RetroStatCard({ label, value, icon, delta, accent, hint }: { label: ReactNode; value: ReactNode; icon?: ReactNode; delta?: number | null; accent?: string; hint?: ReactNode }) {
  return (
    <div className="rb-stat" style={accent ? ({ ['--accent' as string]: accent } as React.CSSProperties) : undefined}>
      {icon && <span className="rb-stat__icon" aria-hidden>{icon}</span>}
      <span className="rb-stat__label">{label}</span>
      <span className="rb-stat__value">{value}</span>
      {delta !== undefined && delta !== null && <span className={cx('rb-stat__delta', delta >= 0 ? 'rb-stat__delta--up' : 'rb-stat__delta--down')}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs. periodo previo</span>}
      {delta === null && <span className="rb-hint">Sin base de comparación</span>}
      {hint && <span className="rb-hint">{hint}</span>}
    </div>
  );
}

export function RetroSpinner({ label = 'Cargando…' }: { label?: string }) {
  return <div className="rb-row" role="status" style={{ justifyContent: 'center', padding: 24 }}><span className="rb-spinner" style={{ fontSize: 28 }} /><span className="rb-arcade">{label}</span></div>;
}
export function RetroEmpty({ icon = '🍟', children }: { icon?: string; children: ReactNode }) { return <div className="rb-empty"><div className="big">{icon}</div>{children}</div>; }
