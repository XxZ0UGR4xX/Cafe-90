import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RetroButton, RetroCard, RetroInput, RetroSelect, useToast } from '@retroburger/ui';
import { api, ApiError } from '../api';

export function ReservePage({ info }: { info: any }) {
  const toast = useToast(); const branches = (info?.branches ?? []).filter((b: any) => b.status === 'OPEN');
  const [f, setF] = useState({ branchId: '', name: '', phone: '', partySize: 2, date: new Date().toLocaleDateString('en-CA'), time: '20:00', notes: '' }); const [done, setDone] = useState<any>(null); const [busy, setBusy] = useState(false);
  const branchId = f.branchId || branches[0]?.id; const startsAt = new Date(`${f.date}T${f.time}:00`).toISOString();
  const av = useQuery({ queryKey: ['avail', branchId, startsAt, f.partySize], queryFn: () => api('/reservations/availability', { query: { branchId, startsAt, partySize: f.partySize } }), enabled: !!branchId });
  const submit = async () => { setBusy(true); try { setDone(await api('/reservations', { body: { branchId, customerName: f.name, phone: f.phone, partySize: Number(f.partySize), startsAt, notes: f.notes || undefined } })); } catch (e) { toast.error(e instanceof ApiError ? e.message : '⚠️ No pudimos reservar.'); } finally { setBusy(false); } };
  if (done) return <RetroCard title="📅 ¡Reservación recibida!" tone="red"><p>Gracias {f.name}. Tu mesa para {done.partySize} el {new Date(done.startsAt).toLocaleString('es-MX')} está <strong>pendiente de confirmación</strong>. Te contactaremos al {f.phone}.</p></RetroCard>;
  return (
    <RetroCard title="📅 Reserva tu mesa" tone="red"><div className="rb-col" style={{ maxWidth: 520 }}>
      <RetroSelect label="Sucursal" value={branchId ?? ''} onChange={(e) => setF({ ...f, branchId: e.target.value })} options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
      <div className="rb-grid rb-grid-2"><RetroInput label="Fecha" type="date" min={new Date().toLocaleDateString('en-CA')} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /><RetroInput label="Hora" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></div>
      <RetroInput label="Personas" type="number" min={1} max={20} value={f.partySize} onChange={(e) => setF({ ...f, partySize: Number(e.target.value) || 1 })} />
      <div className={av.data && av.data.length ? 'rb-hint' : 'rb-error-text'}>{av.data ? (av.data.length ? `✅ ${av.data.length} mesas disponibles en ese horario` : 'No hay mesas en ese horario; prueba otra hora.') : 'Consultando disponibilidad…'}</div>
      <RetroInput label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroInput label="Teléfono" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /><RetroInput label="Notas" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <RetroButton variant="neon" size="lg" loading={busy} disabled={!f.name || f.phone.length < 7 || !av.data?.length} onClick={submit}>Reservar</RetroButton></div></RetroCard>
  );
}
