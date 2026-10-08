import { useState } from 'react';
import { PinPad, RetroButton, RetroCard, RetroInput, RetroLogo, RetroTabs } from '@retroburger/ui';
import { useSession } from '../app/auth';
import { ApiError, api } from '../app/api';
import { CodeInput, MfaQr, RecoveryCodes } from '../app/MfaEnroll';

const TENANT_KEY = 'rb.tenant';
export function Login() {
  const { login, pinLogin, verifyMfa, finishEnroll, completeEnroll } = useSession();
  // Paso 2FA: 'code' = pedir código; 'enroll' = enrolar (obligatorio por rol); 'codes' = mostrar códigos de recuperación
  const [stage, setStage] = useState<{ kind: 'creds' } | { kind: 'code' | 'enroll'; token: string } | { kind: 'codes'; codes: string[] }>({ kind: 'creds' });
  const [mfaCode, setMfaCode] = useState(''); const [enrollInfo, setEnrollInfo] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [tab, setTab] = useState<'email' | 'pin'>('email');
  const [tenant, setTenant] = useState(() => { try { return localStorage.getItem(TENANT_KEY) ?? 'retroburger'; } catch { return 'retroburger'; } });
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState(''); const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault(); setBusy(true); setError(null);
    try {
      try { localStorage.setItem(TENANT_KEY, tenant); } catch { /* */ }
      if (tab === 'email') {
        const r = await login(tenant.trim().toLowerCase(), email.trim(), password);
        if (r.step === 'mfa') { setStage({ kind: 'code', token: r.mfaToken }); setMfaCode(''); }
        else if (r.step === 'enroll') {
          setEnrollInfo(await api('/auth/2fa/enroll/start', { method: 'POST', body: { mfaToken: r.mfaToken }, noAuth: true }));
          setStage({ kind: 'enroll', token: r.mfaToken }); setMfaCode('');
        }
      } else await pinLogin(tenant.trim().toLowerCase(), code.trim(), pin);
    } catch (err) { setError(err instanceof ApiError ? err.message : '⚠️ No pudimos iniciar sesión. Inténtalo nuevamente.'); setPin(''); }
    finally { setBusy(false); }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault(); if (stage.kind !== 'code' && stage.kind !== 'enroll') return; setBusy(true); setError(null);
    try {
      if (stage.kind === 'code') await verifyMfa(stage.token, mfaCode.trim());
      else setStage({ kind: 'codes', codes: await finishEnroll(stage.token, mfaCode) });
    } catch (err) {
      setMfaCode('');
      if (err instanceof ApiError && (err.status === 423 || (err.status === 401 && err.code !== 'MFA_INVALID'))) { setStage({ kind: 'creds' }); setPassword(''); }
      setError(err instanceof ApiError ? err.message : '⚠️ No pudimos verificar el código. Inténtalo nuevamente.');
    } finally { setBusy(false); }
  };
  const back = () => { setStage({ kind: 'creds' }); setPassword(''); setMfaCode(''); setError(null); setEnrollInfo(null); };

  if (stage.kind !== 'creds') return (
    <div className="rb-login"><div className="rb-login__card rb-col">
      <div className="rb-hero"><div style={{ fontSize: '3rem' }}>🔐</div><h1>VERIFICACIÓN</h1><p>SEGURIDAD EN DOS PASOS</p></div>
      <RetroCard title={stage.kind === 'enroll' ? '🔐 Activa tu verificación en dos pasos' : stage.kind === 'codes' ? '🗝️ Códigos de recuperación' : '🔐 Código de verificación'} tone="red">
        {stage.kind === 'codes' ? <RecoveryCodes codes={stage.codes} busy={busy} onDone={() => { setBusy(true); void completeEnroll().finally(() => setBusy(false)); }} />
          : <form className="rb-col" onSubmit={submitCode}>
            {stage.kind === 'enroll' && enrollInfo && <>
              <p className="rb-hint" style={{ margin: 0 }}>Tu rol exige verificación en dos pasos. Escanea el QR con Google Authenticator, Authy, 1Password…, y escribe el código que muestra.</p>
              <MfaQr uri={enrollInfo.otpauthUri} secret={enrollInfo.secret} />
            </>}
            {stage.kind === 'code' && <p className="rb-hint" style={{ margin: 0 }}>Escribe el código de tu app de autenticación, o un código de recuperación (<code>ABCD-EFGH</code>).</p>}
            {stage.kind === 'code'
              ? <RetroInput label="Código" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.trim().slice(0, 20))} autoComplete="one-time-code" autoFocus required />
              : <CodeInput value={mfaCode} onChange={setMfaCode} />}
            {error && <div className="rb-error-text" role="alert" style={{ fontSize: '.95rem' }}>{error}</div>}
            <RetroButton type="submit" variant="neon" size="lg" block loading={busy} disabled={stage.kind === 'enroll' ? mfaCode.length !== 6 : mfaCode.length < 6}>{stage.kind === 'enroll' ? '✅ Activar y entrar' : '▶ Verificar'}</RetroButton>
            <RetroButton type="button" variant="white" block onClick={back}>← Volver</RetroButton>
          </form>}
      </RetroCard>
    </div></div>
  );

  return (
    <div className="rb-login">
      <div className="rb-login__card rb-col">
        <div className="rb-hero"><div>🍔🍟🥤</div><h1><RetroLogo name="AMERIX BURGER" /></h1><p>ERP · POS · KDS</p></div>
        <RetroCard title="🍒 Bienvenido · Iniciar sesión" tone="red">
          <form className="rb-col" onSubmit={submit}>
            <RetroInput label="Restaurante" value={tenant} onChange={(e) => setTenant(e.target.value)} autoCapitalize="none" autoCorrect="off" required />
            <RetroTabs tabs={[{ key: 'email', label: 'Correo' }, { key: 'pin', label: 'PIN rápido' }]} value={tab} onChange={(k) => { setTab(k); setError(null); }} />
            {tab === 'email' ? (<>
              <RetroInput label="Correo" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              <RetroInput label="Contraseña" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </>) : (<>
              <RetroInput label="Código de usuario" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" placeholder="ej. mesero1-centro" required />
              <PinPad value={pin} onChange={setPin} onSubmit={() => void submit()} />
            </>)}
            {error && <div className="rb-error-text" role="alert" style={{ fontSize: '.95rem' }}>{error}</div>}
            {tab === 'email' && <RetroButton type="submit" variant="neon" size="lg" block loading={busy}>▶ Entrar</RetroButton>}
          </form>
        </RetroCard>
      </div>
    </div>
  );
}
