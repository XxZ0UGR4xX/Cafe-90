import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RetroButton, cx } from './core';

// ───────────── RetroModal ─────────────
export function RetroModal({ open, title, onClose, children, footer, size = 'md', dismissible = true }: {
  open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg'; dismissible?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissible) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose, dismissible]);
  if (!open) return null;
  return (
    <div className="rb-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && dismissible) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx('rb-modal', size !== 'md' && `rb-modal--${size}`)}>
        <header className="rb-modal__head"><h3>{title}</h3>{dismissible && <RetroButton data-close size="sm" variant="white" aria-label="Cerrar" onClick={onClose}>✕</RetroButton>}</header>
        <div className="rb-modal__body">{children}</div>
        {footer && <footer className="rb-modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

// ───────────── RetroDialog (confirmación) ─────────────
export function RetroDialog({ open, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger, onConfirm, onCancel, loading }: {
  open: boolean; title: ReactNode; message: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  return (
    <RetroModal open={open} size="sm" title={title} onClose={onCancel}
      footer={<><RetroButton variant="white" onClick={onCancel}>{cancelLabel}</RetroButton><RetroButton variant={danger ? 'red' : 'neon'} loading={loading} onClick={onConfirm}>{confirmLabel}</RetroButton></>}>
      <p style={{ margin: 0, fontWeight: 600 }}>{message}</p>
    </RetroModal>
  );
}

// ───────────── RetroToast ─────────────
type ToastKind = 'ok' | 'error' | 'warn' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: ReactNode }
const ToastCtx = createContext<{ push: (kind: ToastKind, text: ReactNode) => void } | null>(null);
export function RetroToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, text: ReactNode) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 3800);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  const icon: Record<ToastKind, string> = { ok: '✅', error: '⚠️', warn: '🔔', info: 'ℹ️' };
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="rb-toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={cx('rb-toast', `rb-toast--${t.kind}`)}><span>{icon[t.kind]}</span><span>{t.text}</span></div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast requiere <RetroToastProvider>');
  return { ok: (t: ReactNode) => c.push('ok', t), error: (t: ReactNode) => c.push('error', t), warn: (t: ReactNode) => c.push('warn', t), info: (t: ReactNode) => c.push('info', t) };
}
