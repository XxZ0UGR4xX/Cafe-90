import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RetroBadge, RetroButton, RetroCard, RetroInput, RetroSpinner, formatMoney2, useToast } from '@retroburger/ui';
import { api, ApiError } from '../api';
import { toItems, useCart } from '../cart';
import { MenuBrowser } from './Shared';

/** Menú de mesa: el cliente escanea el QR, pide, llama al mesero o solicita la cuenta. */
export function QrPage() {
  const { token } = useParams(); const toast = useToast(); const cart = useCart(); const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [sent, setSent] = useState<any>(null);
  const q = useQuery({ queryKey: ['qr', token], queryFn: () => api(`/tables/${token}`) });
  const bill = useQuery({ queryKey: ['qr-bill', token], queryFn: () => api(`/tables/${token}/bill`), refetchInterval: 15000, enabled: !!q.data });
  const call = async (kind: 'call-waiter' | 'request-bill') => { try { await api(`/tables/${token}/${kind}`, { method: 'POST', body: {} }); toast.ok(kind === 'call-waiter' ? '🙋 Avisamos a tu mesero' : '🧾 Pediste la cuenta'); } catch (e) { toast.error(e instanceof ApiError ? e.message : '⚠️ No pudimos avisar.'); } };
  const order = async () => { setBusy(true); try { const r = await api(`/tables/${token}/orders`, { body: { customerName: name || undefined, items: toItems(cart.lines) } }); setSent(r); cart.clear(); bill.refetch(); } catch (e) { toast.error(e instanceof ApiError ? e.message : '⚠️ No pudimos enviar tu pedido.'); } finally { setBusy(false); } };
  if (q.isLoading) return <RetroSpinner />;
  if (q.error) return <RetroCard title="🔍" tone="red">Este código QR no es válido.</RetroCard>;
  return (
    <div className="rb-col">
      <div className="rb-hero"><h1>MESA {q.data.table.number}</h1><p>{q.data.table.branch}</p></div>
      <div className="rb-row rb-wrap" style={{ justifyContent: 'center' }}><RetroButton variant="mustard" onClick={() => call('call-waiter')}>🙋 Llamar mesero</RetroButton><RetroButton variant="blue" onClick={() => call('request-bill')}>🧾 Pedir la cuenta</RetroButton></div>
      {sent && <RetroCard title="✅ ¡Pedido enviado!" tone="neon"><p style={{ margin: 0 }}>Orden #{String(sent.number).padStart(4, '0')} · {sent.confirmed ? 'ya está en cocina' : 'tu mesero la confirmará en un momento'}.</p></RetroCard>}
      {bill.data && bill.data.orders.length > 0 && <RetroCard title="Tu cuenta" tone="plain"><div className="rb-row"><span>Pedidos: {bill.data.orders.length}</span><RetroBadge tone="info">Pagado {formatMoney2(bill.data.paid)}</RetroBadge><strong className="rb-end rb-display">{formatMoney2(bill.data.total)}</strong></div></RetroCard>}
      <MenuBrowser menu={q.data.menu}>{(lines) => lines.length > 0 && <div className="rb-col"><RetroInput label="Tu nombre (opcional)" value={name} onChange={(e) => setName(e.target.value)} /><RetroButton variant="neon" size="lg" block loading={busy} onClick={order}>Enviar pedido a mi mesa</RetroButton></div>}</MenuBrowser>
    </div>
  );
}
