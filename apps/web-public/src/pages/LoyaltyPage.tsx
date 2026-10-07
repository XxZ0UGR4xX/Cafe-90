import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroInput, RetroStatCard, RetroTable, useToast } from '@retroburger/ui';
import { api, ApiError } from '../api';

export function LoyaltyPage({ info }: { info: any }) {
  const toast = useToast(); const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [d, setD] = useState<any>(null); const [busy, setBusy] = useState(false);
  const look = async () => { setBusy(true); try { setD(await api('/loyalty', { body: { phone, email } })); } catch (e) { setD(null); toast.error(e instanceof ApiError ? e.message : '⚠️ No pudimos consultar tus puntos.'); } finally { setBusy(false); } };
  return (
    <div className="rb-col"><RetroCard title="⭐ Mis puntos" tone="red"><div className="rb-col" style={{ maxWidth: 480 }}>
      <p style={{ margin: 0 }}>Cada <strong>${info?.loyalty?.currencyPerPoint ?? 10}</strong> gastados = 1 punto. Consulta con el teléfono y correo que registraste.</p>
      <RetroInput label="Teléfono" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /><RetroInput label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <RetroButton variant="neon" loading={busy} disabled={phone.length < 7 || !email} onClick={look}>Consultar</RetroButton></div></RetroCard>
      {d && <><div className="rb-grid rb-grid-3"><RetroStatCard label={`Hola, ${d.name}`} value={`${d.balance} pts`} icon="⭐" /><RetroStatCard label="Nivel" value={d.level} icon="🏅" accent="var(--mustard)" /></div>
        <RetroCard title="🎁 Recompensas" tone="plain"><RetroTable rows={d.rewards} rowKey={(r: any) => r.name} columns={[{ key: 'name', header: 'Recompensa' }, { key: 'pointsCost', header: 'Puntos', numeric: true }, { key: 'ok', header: '', render: (r: any) => <RetroBadge tone={d.balance >= r.pointsCost ? 'ok' : 'neutral'}>{d.balance >= r.pointsCost ? '¡Canjeable en sucursal!' : `Te faltan ${r.pointsCost - d.balance}`}</RetroBadge> }]} /></RetroCard></>}</div>
  );
}
