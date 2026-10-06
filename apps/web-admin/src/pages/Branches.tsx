import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroInput, RetroSelect, formatMoney } from '@retroburger/ui';
import { post } from '../app/api';
import { useAct, useGet } from '../app/hooks';
import { useBranch } from '../app/branch';
import { useSession } from '../app/auth';
import { Async, FormModal } from './common';

export default function Branches() {
  const q = useGet<any[]>(['dashboard', 'branches'], '/dashboard/branches'); const nav = useNavigate(); const setBranch = useBranch((s) => s.set); const { can } = useSession();
  const [open, setOpen] = useState(false); const [f, setF] = useState<any>({ status: 'OPEN', timezone: 'America/Mexico_City' });
  const create = useAct(() => post('/branches', f), { invalidate: [['dashboard'], ['branches']], ok: 'Sucursal creada 🍔', onSuccess: () => { setOpen(false); setF({ status: 'OPEN', timezone: 'America/Mexico_City' }); } });
  const inv = { NORMAL: ['ok', '🟢 NORMAL'], BAJO: ['warn', '🟡 BAJO'], CRITICO: ['danger', '🔴 CRÍTICO'] } as const;
  return (
    <>
      {can('tenancy.branch.write') && <div className="rb-row"><RetroButton variant="neon" onClick={() => setOpen(true)}>+ Nueva sucursal</RetroButton></div>}
      <Async q={q}><div className="rb-grid rb-grid-2">{(q.data ?? []).map((b) => {
        const i = inv[b.inventory as keyof typeof inv];
        return (
          <RetroCard key={b.id} title={`🍔 ${b.name}`} tone="red">
            <div className="rb-col">
              <div className="rb-row"><span>📍 {b.address ?? '—'}</span><span className="rb-end"><RetroBadge tone={b.status === 'OPEN' ? 'ok' : 'warn'}>{b.status === 'OPEN' ? '🟢 OPERANDO' : b.status}</RetroBadge></span></div>
              <div className="rb-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                <div><div className="rb-label">💰 Ventas del día</div><div className="rb-display" style={{ fontSize: '1.6rem' }}>{formatMoney(Number(b.salesToday))}</div></div>
                <div><div className="rb-label">🧾 Pedidos</div><div className="rb-display" style={{ fontSize: '1.6rem' }}>{b.ordersToday}</div></div>
                <div><div className="rb-label">Ticket promedio</div><strong>{formatMoney(Number(b.avgTicket))}</strong></div>
                <div><div className="rb-label">👥 Empleados / cajas abiertas</div><strong>{b.employees} · {b.openShifts}</strong></div>
              </div>
              <div className="rb-row"><span>📦 Inventario:</span><RetroBadge tone={i[0]}>{i[1]}</RetroBadge>{b.outOfStock > 0 && <span className="rb-hint">{b.outOfStock} agotados</span>}</div>
              <RetroButton variant="mustard" size="lg" block onClick={() => { setBranch(b.id); nav('/'); }}>ENTRAR A SUCURSAL ▶</RetroButton>
            </div>
          </RetroCard>);
      })}</div></Async>
      <FormModal open={open} onClose={() => setOpen(false)} title="Nueva sucursal" busy={create.isPending} onSubmit={() => create.mutate()} disabled={!f.name || !f.code}>
        <RetroInput label="Nombre" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="RETROBURGER ORIENTE" /><RetroInput label="Código (A-Z, 0-9)" value={f.code ?? ''} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        <RetroInput label="Dirección" value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /><RetroInput label="Teléfono" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <RetroSelect label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'OPEN', label: 'Operando' }, { value: 'CLOSED', label: 'Cerrada' }, { value: 'MAINTENANCE', label: 'Mantenimiento' }]} />
      </FormModal>
    </>
  );
}
