import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { RetroButton, RetroCheck, RetroInput } from '@retroburger/ui';

/** QR del otpauth:// + secreto manual (para apps que no escanean). El secreto sólo vive en memoria mientras se muestra. */
export function MfaQr({ uri, secret }: { uri: string; secret: string }) {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: '#111111', light: '#ffffff' } }).then((d) => { if (alive) setImg(d); }).catch(() => { if (alive) setImg(null); });
    return () => { alive = false; };
  }, [uri]);
  return (
    <div className="rb-col" style={{ alignItems: 'center' }}>
      {img ? <img src={img} width={220} height={220} alt="Código QR para tu app de autenticación" style={{ border: '3px solid var(--ink, #111)', background: '#fff' }} /> : <div className="rb-hint">Generando QR…</div>}
      <div className="rb-hint" style={{ textAlign: 'center' }}>¿No puedes escanear? Escribe esta clave en tu app:</div>
      <code data-testid="mfa-secret" style={{ letterSpacing: 2, fontSize: '1.05rem', wordBreak: 'break-all', textAlign: 'center' }}>{secret.match(/.{1,4}/g)?.join(' ')}</code>
    </div>
  );
}

/** Campo de código de 6 dígitos (autocompleta desde el SMS/app en móviles). */
export function CodeInput({ value, onChange, label = 'Código de 6 dígitos', autoFocus = true }: { value: string; onChange: (v: string) => void; label?: string; autoFocus?: boolean }) {
  return <RetroInput label={label} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} autoFocus={autoFocus} required />;
}

/** Muestra los códigos de recuperación una sola vez y exige confirmar que se guardaron. */
export function RecoveryCodes({ codes, onDone, busy }: { codes: string[]; onDone: () => void; busy?: boolean }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`RETROBURGER — códigos de recuperación 2FA (un solo uso cada uno)\n\n${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = 'retroburger-codigos-recuperacion.txt'; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="rb-col">
      <strong>🗝️ Guarda tus códigos de recuperación</strong>
      <p className="rb-hint" style={{ margin: 0 }}>Si pierdes tu teléfono, cada código te permite entrar <b>una sola vez</b>. No volverán a mostrarse.</p>
      <div className="rb-grid rb-grid-2" data-testid="recovery-codes" style={{ fontFamily: 'monospace', fontSize: '1.05rem' }}>{codes.map((c) => <code key={c}>{c}</code>)}</div>
      <div className="rb-row rb-wrap">
        <RetroButton size="sm" variant="white" onClick={() => { void navigator.clipboard?.writeText(text); }}>📋 Copiar</RetroButton>
        <RetroButton size="sm" variant="white" onClick={download}>⬇️ Descargar</RetroButton>
      </div>
      <RetroCheck label="Ya guardé mis códigos en un lugar seguro" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
      <RetroButton variant="neon" disabled={!saved} loading={busy} onClick={onDone}>Continuar</RetroButton>
    </div>
  );
}
