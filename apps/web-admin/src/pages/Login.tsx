import { useState } from 'react';
import { PinPad, RetroButton, RetroCard, RetroInput, RetroTabs } from '@retroburger/ui';
import { useSession } from '../app/auth';
import { ApiError } from '../app/api';

const TENANT_KEY = 'rb.tenant';
export function Login() {
  const { login, pinLogin } = useSession();
  const [tab, setTab] = useState<'email' | 'pin'>('email');
  const [tenant, setTenant] = useState(() => { try { return localStorage.getItem(TENANT_KEY) ?? 'retroburger'; } catch { return 'retroburger'; } });
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState(''); const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault(); setBusy(true); setError(null);
    try {
      try { localStorage.setItem(TENANT_KEY, tenant); } catch { /* */ }
      if (tab === 'email') await login(tenant.trim().toLowerCase(), email.trim(), password); else await pinLogin(tenant.trim().toLowerCase(), code.trim(), pin);
    } catch (err) { setError(err instanceof ApiError ? err.message : '⚠️ No pudimos iniciar sesión. Inténtalo nuevamente.'); setPin(''); }
    finally { setBusy(false); }
  };

  return (
    <div className="rb-login">
      <div className="rb-login__card rb-col">
        <div className="rb-hero"><div style={{ fontSize: '3.4rem' }}>🍔🍟🥤</div><h1>RETROBURGER</h1><p>ERP · POS · KDS — THE 90s BURGER EXPERIENCE</p></div>
        <RetroCard title="🕹️ Insert coin · Iniciar sesión" tone="red">
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
            {tab === 'email' && <RetroButton type="submit" variant="neon" size="lg" block loading={busy}>▶ Press start</RetroButton>}
          </form>
        </RetroCard>
      </div>
    </div>
  );
}
