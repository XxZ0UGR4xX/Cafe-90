import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RetroButton, RetroCard, RetroInput, RetroSelect, RetroSpinner, RetroTabs, useToast } from '@retroburger/ui';
import { api, ApiError } from '../api';
import { toItems, useCart } from '../cart';
import { MenuBrowser } from './Shared';

export function MenuPage({ info }: { info: any }) {
  const cart = useCart(); const nav = useNavigate(); const toast = useToast();
  const branches = (info?.branches ?? []).filter((b: any) => b.status === 'OPEN');
  useEffect(() => { if (branches.length && (!cart.branchId || !branches.some((b: any) => b.id === cart.branchId))) cart.setBranch(branches[0].id); }, [branches.length]);   // eslint-disable-line
  const menu = useQuery({ queryKey: ['menu', cart.branchId], queryFn: () => api('/menu', { query: { branchId: cart.branchId } }), enabled: !!cart.branchId });
  const [f, setF] = useState({ type: 'PICKUP' as 'PICKUP' | 'DELIVERY', name: '', phone: '', email: '', address: '', notes: '', coupon: '' }); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api('/orders', { body: { branchId: cart.branchId, type: f.type, customer: { name: f.name, phone: f.phone, email: f.email || undefined }, address: f.type === 'DELIVERY' ? f.address : undefined, notes: f.notes || undefined, couponCode: f.coupon || undefined, paymentMethod: 'CASH', items: toItems(cart.lines) } });
      cart.clear(); nav(`/pedido/${r.orderId}`);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : '⚠️ No pudimos registrar tu pedido. Tu carrito sigue guardado; inténtalo de nuevo.'); } finally { setBusy(false); }
  };
  if (!info || menu.isLoading) return <RetroSpinner />;
  return (
    <div className="rb-col">
      <div className="rb-hero"><div style={{ fontSize: '3rem' }}>🍔🍟🥤</div><h1>RETROBURGER</h1><p>THE 90s BURGER EXPERIENCE · PIDE PARA RECOGER O A DOMICILIO</p></div>
      <RetroSelect aria-label="Sucursal" label="Sucursal" value={cart.branchId ?? ''} onChange={(e) => cart.setBranch(e.target.value)} options={branches.map((b: any) => ({ value: b.id, label: `${b.name} — ${b.address ?? ''}` }))} />
      {menu.error ? <RetroCard title="⚠️" tone="red">No pudimos cargar el menú. Inténtalo de nuevo en un momento.</RetroCard> : menu.data && (
        <MenuBrowser menu={menu.data}>{(lines) => lines.length > 0 && (
          <div className="rb-col">
            <RetroTabs value={f.type} onChange={(type) => setF({ ...f, type })} tabs={[{ key: 'PICKUP', label: '🥡 Recoger' }, { key: 'DELIVERY', label: '🛵 Domicilio' }]} />
            <RetroInput label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><RetroInput label="Teléfono" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            {f.type === 'DELIVERY' && <RetroInput label="Dirección de entrega" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} hint="Se agregará el cargo de envío al confirmar." />}
            <RetroInput label="Cupón (opcional)" value={f.coupon} onChange={(e) => setF({ ...f, coupon: e.target.value.toUpperCase() })} /><RetroInput label="Notas" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            <RetroButton variant="neon" size="lg" block loading={busy} disabled={!f.name || f.phone.length < 7 || (f.type === 'DELIVERY' && f.address.length < 5)} onClick={submit}>Hacer pedido (pago al recibir)</RetroButton></div>)}</MenuBrowser>)}
    </div>
  );
}
