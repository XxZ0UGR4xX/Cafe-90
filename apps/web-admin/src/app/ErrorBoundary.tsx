import { Component, type ReactNode } from 'react';
import { RetroButton, RetroCard } from '@retroburger/ui';

/** Red de seguridad de UI: nunca pantalla en blanco ni mensajes técnicos. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error('UI error', e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="rb-login"><RetroCard title="⚠️ Algo salió mal" tone="red"><p style={{ marginTop: 0 }}>No pudimos mostrar esta pantalla. Tu información permanece guardada. Recarga para intentarlo nuevamente.</p><RetroButton onClick={() => location.reload()}>Recargar</RetroButton></RetroCard></div>;
  }
}
