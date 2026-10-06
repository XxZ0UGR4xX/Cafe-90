import { useEffect, useMemo, useState } from 'react';
import { RetroBadge, RetroButton, RetroInput, RetroModal, formatMoney2 } from '@retroburger/ui';

export interface PaymentDraft { method: 'CASH' | 'CARD' | 'TRANSFER' | 'QR'; amount: number; tip: number; tendered?: number; reference?: string }
const METHODS: { key: PaymentDraft['method']; icon: string; label: string }[] = [{ key: 'CASH', icon: '💵', label: 'Efectivo' }, { key: 'CARD', icon: '💳', label: 'Tarjeta' }, { key: 'TRANSFER', icon: '🏦', label: 'Transferencia' }, { key: 'QR', icon: '📱', label: 'QR' }];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Cobro rápido: método, propina, efectivo/cambio y pagos mixtos. Pensado para táctil. */
export function PayDialog({ open, total, remaining, onClose, onSubmit, busy }: { open: boolean; total: number; remaining: number; onClose: () => void; onSubmit: (p: PaymentDraft[]) => Promise<void>; busy?: boolean }) {
  const [added, setAdded] = useState<PaymentDraft[]>([]); const [method, setMethod] = useState<PaymentDraft['method']>('CASH');
  const [amount, setAmount] = useState(''); const [tendered, setTendered] = useState(''); const [tipPct, setTipPct] = useState<number | null>(0); const [tipCustom, setTipCustom] = useState(''); const [reference, setReference] = useState('');
  const paid = r2(added.reduce((a, p) => a + p.amount, 0)); const left = r2(Math.max(remaining - paid, 0));
  useEffect(() => { if (open) { setAdded([]); setMethod('CASH'); setAmount(String(remaining)); setTendered(''); setTipPct(0); setTipCustom(''); setReference(''); } }, [open, remaining]);
  useEffect(() => { setAmount(String(left)); }, [left]);

  const amt = Number(amount) || 0;
  const tip = useMemo(() => (tipPct === null ? Number(tipCustom) || 0 : r2((total * tipPct) / 100)), [tipPct, tipCustom, total]);
  const tenderedN = Number(tendered) || 0; const change = method === 'CASH' && tenderedN > amt ? r2(tenderedN - amt) : 0;
  const valid = amt > 0 && amt <= left + 0.001 && (method !== 'CASH' || !tendered || tenderedN >= amt);
  const addPayment = () => { if (!valid) return; setAdded([...added, { method, amount: amt, tip: added.length === 0 ? tip : 0, tendered: method === 'CASH' && tenderedN ? tenderedN : undefined, reference: reference || undefined }]); setTendered(''); setReference(''); };
  const finalList = (): PaymentDraft[] => (left > 0 && valid ? [...added, { method, amount: amt, tip: added.length === 0 ? tip : 0, tendered: method === 'CASH' && tenderedN ? tenderedN : undefined, reference: reference || undefined }] : added);
  const canFinish = r2(finalList().reduce((a, p) => a + p.amount, 0)) > 0;
  const quick = [...new Set([left, 50, 100, 200, 500, 1000].filter((v) => v >= left))].slice(0, 5);

  return (
    <RetroModal open={open} onClose={onClose} size="lg" title={`💰 Cobrar · ${formatMoney2(remaining)}`}
      footer={<><RetroButton variant="white" onClick={onClose}>Cancelar</RetroButton><RetroButton variant="neon" size="lg" loading={busy} disabled={!canFinish} onClick={() => onSubmit(finalList())}>✔ Cobrar {formatMoney2(finalList().reduce((a, p) => a + p.amount, 0))}</RetroButton></>}>
      <div className="rb-grid rb-grid-2">
        <div className="rb-col">
          <div className="rb-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>{METHODS.map((m) => <RetroButton key={m.key} size="lg" variant={method === m.key ? 'red' : 'white'} onClick={() => setMethod(m.key)}>{m.icon} {m.label}</RetroButton>)}</div>
          <RetroInput label="Monto a cobrar con este método" large inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          {method === 'CASH' && <>
            <RetroInput label="Efectivo recibido" large inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ''))} />
            <div className="rb-row rb-wrap">{quick.map((q) => <RetroButton key={q} size="sm" variant="mustard" onClick={() => setTendered(String(q))}>{q === left ? 'Exacto' : formatMoney2(q)}</RetroButton>)}</div>
            {change > 0 && <div className="rb-display" style={{ fontSize: '1.6rem', color: 'var(--neon-dark)' }}>CAMBIO {formatMoney2(change)}</div>}
          </>}
          {method !== 'CASH' && <RetroInput label="Referencia / autorización" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />}
        </div>
        <div className="rb-col">
          <div><div className="rb-label">Propina</div><div className="rb-row rb-wrap">{[0, 10, 15, 20].map((p) => <RetroButton key={p} size="sm" variant={tipPct === p ? 'red' : 'white'} onClick={() => { setTipPct(p); setTipCustom(''); }}>{p}%</RetroButton>)}<RetroButton size="sm" variant={tipPct === null ? 'red' : 'white'} onClick={() => setTipPct(null)}>Otra</RetroButton></div>
            {tipPct === null && <RetroInput aria-label="Propina" inputMode="decimal" placeholder="$ propina" value={tipCustom} onChange={(e) => setTipCustom(e.target.value.replace(/[^\d.]/g, ''))} />}
            <div className="rb-hint">Propina: {formatMoney2(tip)} (se registra aparte del importe de la cuenta)</div></div>
          <div className="rb-card" style={{ boxShadow: 'none' }}><div className="rb-card__body rb-col" style={{ gap: 6 }}>
            <div className="rb-row"><span>Cuenta</span><strong className="rb-end rb-mono">{formatMoney2(total)}</strong></div>
            {added.map((p, i) => <div key={i} className="rb-row"><RetroBadge tone="ok">{METHODS.find((m) => m.key === p.method)?.icon} {p.method}</RetroBadge><span className="rb-end rb-mono">{formatMoney2(p.amount)}</span><RetroButton size="sm" variant="ghost" aria-label="Quitar" onClick={() => setAdded(added.filter((_, j) => j !== i))}>✕</RetroButton></div>)}
            <div className="rb-row"><span>Por cobrar</span><strong className="rb-end rb-mono">{formatMoney2(left)}</strong></div>
            {left > 0 && <RetroButton variant="mustard" onClick={addPayment} disabled={!valid || amt >= left - 0.001}>+ Agregar pago y dividir con otro método</RetroButton>}
          </div></div>
        </div>
      </div>
    </RetroModal>
  );
}
