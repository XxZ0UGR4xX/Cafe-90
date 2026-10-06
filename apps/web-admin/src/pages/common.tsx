import { type ReactNode, useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroEmpty, RetroModal, RetroSpinner, type Tone, formatMoney } from '@retroburger/ui';
import { ApiError } from '../app/api';
import { useBranchId } from '../app/hooks';

export const money = formatMoney;
export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtDay = (s?: string | null) => (s ? new Date(s).toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' }) : '—');
export const fmtTime = (s?: string | null) => (s ? new Date(s).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—');
export const today = () => new Date().toLocaleDateString('en-CA');
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA');

/** Estados de carga/error uniformes con mensajes humanos. */
export function Async({ q, children }: { q: { isLoading: boolean; error: unknown; refetch?: () => void }; children: ReactNode }) {
  if (q.isLoading) return <RetroSpinner />;
  if (q.error) return <RetroCard title="⚠️ Algo salió mal" tone="red"><p style={{ marginTop: 0 }}>{(q.error as ApiError).message}</p>{q.refetch && <RetroButton onClick={() => q.refetch?.()}>Reintentar</RetroButton>}</RetroCard>;
  return <>{children}</>;
}
export function NeedBranch({ children }: { children: (branchId: string) => ReactNode }) {
  const b = useBranchId();
  return b ? <>{children(b)}</> : <RetroEmpty icon="🏪">Selecciona una sucursal en la barra superior.</RetroEmpty>;
}
export const StatusBadge = ({ s, map }: { s: string; map: Record<string, [Tone, string]> }) => { const [tone, label] = map[s] ?? ['neutral', s]; return <RetroBadge tone={tone}>{label}</RetroBadge>; };

export const INV_STATUS: Record<string, [Tone, string]> = { AVAILABLE: ['ok', '🟢 Normal'], LOW: ['warn', '🟡 Bajo'], CRITICAL: ['danger', '🔴 Crítico'], OUT_OF_STOCK: ['dark', '⚫ Agotado'] };

/** Modal de formulario con acciones Guardar/Cancelar y error visible. */
export function FormModal({ open, title, onClose, onSubmit, children, busy, submitLabel = 'Guardar', size = 'md', disabled }: { open: boolean; title: ReactNode; onClose: () => void; onSubmit: () => void; children: ReactNode; busy?: boolean; submitLabel?: string; size?: 'sm' | 'md' | 'lg'; disabled?: boolean }) {
  return (
    <RetroModal open={open} title={title} onClose={onClose} size={size} footer={<><RetroButton variant="white" onClick={onClose}>Cancelar</RetroButton><RetroButton variant="neon" loading={busy} disabled={disabled} onClick={onSubmit}>{submitLabel}</RetroButton></>}>
      <form className="rb-col" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>{children}</form>
    </RetroModal>
  );
}
export function useToggle(initial = false): [boolean, () => void, () => void] { const [v, set] = useState(initial); return [v, () => set(true), () => set(false)]; }
export const num = (v: string) => (v === '' ? 0 : Number(v));
export const Row = ({ children }: { children: ReactNode }) => <div className="rb-grid rb-grid-2" style={{ gap: 12 }}>{children}</div>;
