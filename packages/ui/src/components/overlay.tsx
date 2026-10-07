import { type ReactNode, createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { RetroButton, cx } from './core';

// ───────────── RetroModal ─────────────
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function RetroModal({ open, title, onClose, children, footer, size = 'md', dismissible = true }: {
  open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg'; dismissible?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // `onClose` suele llegar como función en línea (cambia en cada render): se guarda en una ref para que el efecto dependa SÓLO de `open`.
  // Antes el efecto se re-ejecutaba en cada tecla y devolvía el foco al primer campo: al teclear en el 2.º campo, el resto del texto caía en el 1.º.
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const dismissRef = useRef(dismissible); dismissRef.current = dismissible;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current;
    root?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissRef.current) { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !root) return;
      // el foco no sale del diálogo: Tab en el último vuelve al primero y Mayús+Tab en el primero va al último
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => { const st = getComputedStyle(el); return !el.hidden && st.display !== 'none' && st.visibility !== 'hidden'; });
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0]!, last = items[items.length - 1]!, active = document.activeElement;
      if (!root.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="rb-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && dismissible) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx('rb-modal', size !== 'md' && `rb-modal--${size}`)}>
        <header className="rb-modal__head"><h3 id={titleId}>{title}</h3>{dismissible && <RetroButton data-close size="sm" variant="white" aria-label="Cerrar" onClick={onClose}>✕</RetroButton>}</header>
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
