import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RetroBadge, RetroButton, RetroCard, RetroDialog, RetroInput, RetroModal, RetroPOSButton, RetroProductCard, formatMoney, formatMoney2, useToast } from '@retroburger/ui';
import { ApiError, get, post, patch } from '../app/api';
import { useBranchId } from '../app/hooks';
import { useSession } from '../app/auth';
import { useArcade } from '../app/idle';
import { play } from '../app/sound';
import { useWithSupervisor } from '../app/supervisor';
import { cacheGet, cacheSet, enqueue } from '../offline/store';
import { refreshPending, syncNow, useConnection } from '../offline/connection';
import { totalsOf, type CartLine } from '../offline/estimate';
import { useCart } from './pos/cart';
import { PayDialog, type PaymentDraft } from './pos/PayDialog';
import { CustomerPicker, DiscountDialog, NoteDialog, SplitDialog, TablePicker } from './pos/Pickers';
import { ProductDialog, type MenuData } from './pos/ProductDialog';

const toItems = (lines: CartLine[]) => lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty, notes: l.notes, modifierIds: l.modifierIds, comboChoices: l.comboChoices }));

/** Menú con caché local: sigue disponible sin Internet. */
function useMenu(branchId: string | null) {
  return useQuery<MenuData>({
    queryKey: ['menu', branchId], enabled: !!branchId, staleTime: 60_000,
    queryFn: async () => {
      try { const m = await get<MenuData>('/menu', { branchId }); void cacheSet(`menu:${branchId}`, m); return m; }
      catch (e) { if (e instanceof ApiError && e.isNetwork) { const c = await cacheGet<MenuData>(`menu:${branchId}`); if (c) return c.value; } throw e; }
    },
  });
}

export function PosInner() {
  const branchId = useBranchId(); const toast = useToast(); const qc = useQueryClient(); const { can, me } = useSession(); const withSup = useWithSupervisor();
  const cart = useCart(); const conn = useConnection(); const menuQ = useMenu(branchId);
  const [cat, setCat] = useState<string>('ALL'); const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<MenuData['products'][number] | null>(null);
  const [modal, setModal] = useState<null | 'tables' | 'pay' | 'discount' | 'note' | 'split' | 'customer' | 'cancel' | 'shift'>(null);
  const [busy, setBusy] = useState(false); const [lastOrder, setLastOrder] = useState<any>(null);
  const [float, setFloat] = useState('500');

  const block = useArcade((s) => s.block);   // el protector de pantalla no debe cubrir un carrito activo
  useEffect(() => (cart.lines.length || cart.orderId ? block() : undefined), [cart.lines.length, cart.orderId, block]);

  const order = useQuery({ queryKey: ['orders', 'one', cart.orderId], enabled: !!cart.orderId, queryFn: () => get<any>(`/orders/${cart.orderId}`), refetchInterval: 20_000 });
  const activeOffline = cart.offline.find((o) => o.clientUuid === cart.activeOffline) ?? null;
  const menu = menuQ.data;
  const products = useMemo(() => (menu?.products ?? []).filter((p) => (cat === 'ALL' || p.categoryId === cat) && (!search || p.name.toLowerCase().includes(search.toLowerCase()))), [menu, cat, search]);
  const est = totalsOf(cart.lines);
  const srv = order.data;
  const serverTotal = srv ? srv.total : 0; const grand = (srv?.total ?? 0) + est.total + (activeOffline?.total ?? 0);
  const openOrderLines = (srv?.items ?? []).filter((i: any) => !i.parentItemId && i.status !== 'CANCELLED');

  const addLine = useCallback((l: CartLine) => { cart.add(l); play('coin'); }, [cart]);
  const onProduct = (p: MenuData['products'][number]) => {
    if (!p.available) return;
    if (p.variants.length || p.comboSlots.length || p.modifierGroupIds.length) return setDialog(p);
    addLine({ key: crypto.randomUUID(), productId: p.id, name: p.name, qty: 1, modifierIds: [], comboChoices: [], unitPrice: p.price, modifierLabels: [] });
  };
  const fail = (e: unknown) => { play('error'); toast.error(e instanceof ApiError ? e.message : '⚠️ No pudimos completar la operación. La información permanece guardada y puedes intentarlo nuevamente.'); };

  /** Envía a cocina. Sin conexión → se guarda en la cola local y se sincroniza al reconectar (no se pierde la venta). */
  const send = async (): Promise<string | null> => {
    if (!branchId || !cart.lines.length) return cart.orderId;
    setBusy(true); const lines = cart.lines;
    try {
      let res: any;
      if (cart.orderId) res = await post(`/orders/${cart.orderId}/items`, { items: toItems(lines), send: true });
      else res = await post('/orders', { clientUuid: crypto.randomUUID(), branchId, channel: cart.channel, tableId: cart.channel === 'DINE_IN' ? cart.tableId ?? undefined : undefined, customerId: cart.customer?.id, customerName: cart.customer?.name, notes: cart.notes || undefined, send: true, items: toItems(lines) });
      cart.set({ orderId: res.id, lines: [] }); toast.ok(`🔔 Orden #${String(res.number).padStart(4, '0')} enviada a cocina`);
      qc.invalidateQueries({ queryKey: ['tables'] }); qc.invalidateQueries({ queryKey: ['orders'] });
      return res.id as string;
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork && !cart.orderId) {
        const clientUuid = crypto.randomUUID(); const label = `OFF-${String(cart.offline.length + 1).padStart(3, '0')}`;
        await enqueue({ opId: crypto.randomUUID(), type: 'ORDER_CREATE', branchId, label, payload: { clientUuid, branchId, channel: cart.channel, tableId: cart.channel === 'DINE_IN' ? cart.tableId ?? undefined : undefined, customerId: cart.customer?.id, notes: cart.notes || undefined, send: true, items: toItems(lines) } });
        cart.addOffline({ clientUuid, label, lines, total: totalsOf(lines).total, channel: cart.channel, tableId: cart.tableId ?? undefined, branchId, paid: false, createdAt: new Date().toISOString() });
        cart.set({ lines: [], activeOffline: clientUuid }); await refreshPending();
        toast.warn(`📡 Sin conexión: ${label} guardada. Se enviará a cocina al reconectar.`); return null;
      }
      fail(e); return null;
    } finally { setBusy(false); }
  };

  const loadTable = async (t: any) => {
    setModal(null);
    cart.set({ channel: 'DINE_IN', tableId: t.id, tableNumber: t.number, orderId: null, lines: [] });
    if (t.status === 'OCCUPIED') {
      try {
        const list = await get<any[]>('/orders', { branchId, tableId: t.id, status: 'PENDING,CONFIRMED,PREPARING,READY,DELIVERED', limit: 10 });
        const open = list.find((o) => o.paymentStatus !== 'PAID'); if (open) cart.set({ orderId: open.id });
      } catch (e) { fail(e); }
    }
  };

  const doPay = async (payments: PaymentDraft[]) => {
    setBusy(true);
    try {
      if (activeOffline) {   // cobro sin conexión: entra a la cola con IDs propios (idempotente)
        await enqueue({ opId: crypto.randomUUID(), type: 'ORDER_PAY', branchId: branchId!, label: activeOffline.label, payload: { orderClientUuid: activeOffline.clientUuid, payments: payments.map((p) => ({ ...p, clientUuid: crypto.randomUUID() })) } });
        cart.markOfflinePaid(activeOffline.clientUuid); await refreshPending(); setModal(null); toast.warn(`📡 Cobro de ${activeOffline.label} guardado; se registrará en caja al reconectar.`); play('coin'); void syncNow(); return;
      }
      const id = (await send()) ?? cart.orderId; if (!id) return;
      const res = await withSup(() => post(`/orders/${id}/pay`, { payments: payments.map((p) => ({ ...p, clientUuid: crypto.randomUUID() })) }));
      play('coin'); setModal(null); setLastOrder(res); cart.reset(); qc.invalidateQueries({ queryKey: ['tables'] }); qc.invalidateQueries({ queryKey: ['orders'] });
      toast.ok(res.change ? `🪙 Cobrado. Cambio: ${formatMoney2(res.change)}` : '🪙 Venta completada');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SHIFT_NOT_OPEN') { setModal('shift'); } else fail(e);
    } finally { setBusy(false); }
  };

  const openShift = async () => {
    setBusy(true);
    try { await post('/cash/shifts/open', { branchId, openingFloat: Number(float) || 0 }); toast.ok('💰 Caja abierta'); setModal('pay'); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const orderAction = async (fn: () => Promise<any>, close = true) => { setBusy(true); try { await fn(); qc.invalidateQueries({ queryKey: ['orders'] }); if (close) setModal(null); } catch (e) { fail(e); } finally { setBusy(false); } };
  const cancelAll = () => orderAction(async () => {
    if (cart.orderId) await withSup((sup) => post(`/orders/${cart.orderId}/cancel`, { reason: 'Cancelada desde POS', supervisor: sup }));
    if (activeOffline) cart.dropOffline(activeOffline.clientUuid);
    cart.reset(); qc.invalidateQueries({ queryKey: ['tables'] }); toast.ok('Orden cancelada');
  });

  if (!branchId) return <RetroCard title="POS">Selecciona una sucursal.</RetroCard>;
  const stationless = !menu;
  const canPay = can('sales.order.pay', branchId); const hasAnything = cart.lines.length > 0 || !!cart.orderId || !!activeOffline;

  return (
    <>
      <div className="rb-row rb-wrap" style={{ marginBottom: -6 }}>
        <RetroButton variant={cart.channel === 'DINE_IN' ? 'red' : 'white'} onClick={() => cart.set({ channel: 'DINE_IN' })}>🪑 Mesa</RetroButton>
        <RetroButton variant={cart.channel === 'TAKEAWAY' ? 'red' : 'white'} onClick={() => cart.set({ channel: 'TAKEAWAY', tableId: null, tableNumber: null })}>🥡 Para llevar</RetroButton>
        {cart.channel === 'DINE_IN' && <RetroButton variant="mustard" onClick={() => setModal('tables')}>{cart.tableNumber ? `Mesa ${cart.tableNumber} ✎` : 'Elegir mesa'}</RetroButton>}
        <RetroButton variant="white" onClick={() => setModal('customer')}>👤 {cart.customer?.name ?? 'Cliente'}</RetroButton>
        {cart.offline.filter((o) => !o.paid || true).length > 0 && <span className="rb-row rb-wrap">{cart.offline.map((o) => <RetroButton key={o.clientUuid} size="sm" variant={o.clientUuid === cart.activeOffline ? 'red' : 'ghost'} onClick={() => cart.set({ activeOffline: o.clientUuid })}>📡 {o.label}{o.paid ? ' ✔' : ''}</RetroButton>)}</span>}
        <span className="rb-end rb-muted">{conn.state === 'offline' && '⚠️ Modo offline: las ventas se guardan localmente'}</span>
      </div>
      <div className="rb-pos">
        <div className="rb-pos__cats rb-col" style={{ gap: 8 }}>
          <RetroPOSButton icon="🍽️" pressed={cat === 'ALL'} onClick={() => setCat('ALL')}>Todo</RetroPOSButton>
          {(menu?.categories ?? []).map((c) => <RetroPOSButton key={c.id} icon={c.icon ?? '🍔'} pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</RetroPOSButton>)}
        </div>
        <div className="rb-pos__products">
          <RetroInput aria-label="Buscar producto" placeholder="🔎 Buscar producto…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 12 }} />
          {menuQ.isLoading && <div className="rb-empty">Cargando menú…</div>}
          {menuQ.error && !menu && <div className="rb-empty">⚠️ {(menuQ.error as ApiError).message}</div>}
          <div className="rb-products">
            {products.map((p) => <RetroProductCard key={p.id} name={p.name} price={p.price} image={p.imageUrl} emoji={menu?.categories.find((c) => c.id === p.categoryId)?.icon ?? '🍔'} available={p.available} note={p.kind === 'COMBO' ? '🔥 Combo' : undefined} onClick={() => onProduct(p)} />)}
          </div>
          {!stationless && products.length === 0 && <div className="rb-empty">No hay productos en esta categoría.</div>}
        </div>
        <RetroCard className="rb-pos__ticket" title={`🧾 ${cart.tableNumber ? `MESA ${cart.tableNumber}` : cart.channel === 'TAKEAWAY' ? 'PARA LLEVAR' : 'TICKET'}${srv ? ` · #${String(srv.number).padStart(4, '0')}` : ''}`} tone="red" flush>
          <div className="rb-ticket">
            <div className="rb-ticket__lines">
              {!hasAnything && <div className="rb-empty"><div className="big">🍔</div>Toca un producto para comenzar</div>}
              {openOrderLines.map((i: any) => (
                <div key={i.id} className="rb-ticket__line" style={{ opacity: 0.8 }}>
                  <span><strong>{i.qty}×</strong> {i.name} <RetroBadge tone={i.status === 'PENDING' ? 'warn' : i.status === 'READY' ? 'ok' : 'info'}>{i.status === 'PENDING' ? 'Sin enviar' : i.status === 'SENT' ? 'En cocina' : i.status === 'PREPARING' ? 'Preparando' : i.status === 'READY' ? 'Listo' : 'Entregado'}</RetroBadge></span>
                  <span className="rb-mono">{formatMoney(i.lineTotal)}</span>
                  {i.modifiers.length > 0 && <span className="mods">{i.modifiers.map((m: any) => `${m.type === 'REMOVE' ? 'SIN' : '+'} ${m.name}`).join(' · ')}</span>}
                </div>
              ))}
              {activeOffline && <div className="rb-hint" style={{ padding: '4px 0' }}>📡 {activeOffline.label} — pendiente de sincronizar</div>}
              {(activeOffline?.lines ?? []).map((l) => <div key={l.key} className="rb-ticket__line" style={{ opacity: .8 }}><span><strong>{l.qty}×</strong> {l.name}</span><span className="rb-mono">{formatMoney(l.unitPrice * l.qty)}</span></div>)}
              {cart.lines.map((l) => (
                <div key={l.key} className="rb-ticket__line">
                  <span><strong>{l.name}</strong></span><span className="rb-mono">{formatMoney(l.unitPrice * l.qty)}</span>
                  <span className="rb-qty"><button aria-label="Menos" onClick={() => cart.setQty(l.key, l.qty - 1)}>−</button><strong style={{ minWidth: 22, textAlign: 'center' }}>{l.qty}</strong><button aria-label="Más" onClick={() => cart.setQty(l.key, l.qty + 1)}>+</button></span>
                  <span style={{ textAlign: 'right' }}><RetroButton size="sm" variant="ghost" aria-label="Quitar" onClick={() => cart.remove(l.key)}>🗑</RetroButton></span>
                  {(l.modifierLabels.length > 0 || l.notes) && <span className="mods">{[...l.modifierLabels, l.notes ? `📝 ${l.notes}` : ''].filter(Boolean).join(' · ')}</span>}
                </div>
              ))}
            </div>
            <div className="rb-ticket__totals">
              {srv && srv.discountTotal > 0 && <div className="rb-row"><span>Descuento</span><span className="rb-end rb-mono">−{formatMoney2(srv.discountTotal)}</span></div>}
              <div className="rb-row"><span>Subtotal</span><span className="rb-end rb-mono">{formatMoney2((srv?.subtotal ?? 0) + est.subtotal + (activeOffline?.total ?? 0))}</span></div>
              <div className="rb-ticket__total"><span>TOTAL</span><span>{formatMoney2(grand - (srv?.discountTotal ?? 0) * 0)}</span></div>
              {srv?.paidTotal > 0 && <div className="rb-row"><span>Pagado</span><span className="rb-end rb-mono">{formatMoney2(srv.paidTotal)}</span></div>}
            </div>
            <div className="rb-ticket__actions">
              <RetroButton variant="mustard" block loading={busy} disabled={!cart.lines.length} onClick={() => void send()}>🔥 Enviar cocina</RetroButton>
              <RetroButton variant="neon" block disabled={!hasAnything || !canPay || (!!activeOffline && activeOffline.paid)} onClick={() => setModal('pay')}>💰 Cobrar</RetroButton>
              <RetroButton variant="white" disabled={!srv} onClick={() => setModal('split')}>✂️ Dividir</RetroButton>
              <RetroButton variant="white" disabled={!srv || !can('sales.discount.apply', branchId)} onClick={() => setModal('discount')}>🏷️ Descuento</RetroButton>
              <RetroButton variant="white" onClick={() => setModal('note')}>📝 Nota</RetroButton>
              <RetroButton variant="ink" disabled={!hasAnything} onClick={() => (cart.orderId || activeOffline ? setModal('cancel') : cart.reset())}>🗑 Cancelar</RetroButton>
            </div>
          </div>
        </RetroCard>
      </div>

      {menu && <ProductDialog key={dialog?.id} product={dialog} menu={menu} onClose={() => setDialog(null)} onAdd={(l) => { addLine(l); setDialog(null); }} />}
      <TablePicker open={modal === 'tables'} branchId={branchId} onClose={() => setModal(null)} onPick={loadTable} />
      <CustomerPicker open={modal === 'customer'} onClose={() => setModal(null)} onPick={(c) => { cart.set({ customer: c }); setModal(null); if (cart.orderId) void patch(`/orders/${cart.orderId}`, { customerId: c.id, customerName: c.name }).then(() => qc.invalidateQueries({ queryKey: ['orders'] })).catch(fail); }} />
      <NoteDialog open={modal === 'note'} value={srv?.notes ?? cart.notes} onClose={() => setModal(null)} onSave={(v) => { cart.set({ notes: v }); setModal(null); if (cart.orderId) void patch(`/orders/${cart.orderId}`, { notes: v }).then(() => qc.invalidateQueries({ queryKey: ['orders'] })).catch(fail); }} />
      <DiscountDialog open={modal === 'discount'} busy={busy} onClose={() => setModal(null)} onApply={(d) => orderAction(() => withSup((sup) => post(`/orders/${cart.orderId}/discount`, { ...d, supervisor: sup })))} />
      <SplitDialog open={modal === 'split'} order={srv} busy={busy} onClose={() => setModal(null)} onSplit={(ids) => orderAction(async () => { const r = await post(`/orders/${cart.orderId}/split`, { itemIds: ids }); toast.ok(`Cuenta separada #${String(r.created.number).padStart(4, '0')} creada`); cart.set({ orderId: r.created.id }); })} />
      <PayDialog open={modal === 'pay'} busy={busy} total={(srv?.total ?? 0) + est.total + (activeOffline && !activeOffline.paid ? activeOffline.total : 0)} remaining={Math.round((((srv?.remaining ?? 0) + est.total + (activeOffline && !activeOffline.paid ? activeOffline.total : 0))) * 100) / 100} onClose={() => setModal(null)} onSubmit={doPay} />
      <RetroDialog open={modal === 'cancel'} danger title="¿Cancelar la orden?" message="Se cancelará la cuenta y se liberará la mesa. Si ya está en cocina se pedirá autorización de un gerente." confirmLabel="Sí, cancelar" cancelLabel="Volver" loading={busy} onCancel={() => setModal(null)} onConfirm={() => void cancelAll()} />
      <RetroModal open={modal === 'shift'} size="sm" title="💰 Abre tu caja" onClose={() => setModal(null)} footer={<RetroButton variant="neon" loading={busy} onClick={openShift}>Abrir caja y continuar</RetroButton>}>
        <p style={{ marginTop: 0 }}>Necesitas una caja abierta para cobrar. Cuenta tu fondo inicial.</p><RetroInput label="Fondo inicial" large inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value.replace(/[^\d.]/g, ''))} />
      </RetroModal>
      <RetroModal open={!!lastOrder} size="sm" title="🪙 Venta completada" onClose={() => setLastOrder(null)} footer={<><RetroButton variant="white" onClick={() => { void printReceipt(lastOrder.id); }}>🖨️ Ticket</RetroButton><RetroButton variant="neon" onClick={() => setLastOrder(null)}>Nueva orden</RetroButton></>}>
        <div className="rb-col" style={{ textAlign: 'center' }}><div style={{ fontSize: '3rem' }}>🍔✨</div><div className="rb-display" style={{ fontSize: '1.6rem' }}>{formatMoney2(lastOrder?.total)}</div>{lastOrder?.change > 0 && <div className="rb-display" style={{ color: 'var(--neon-dark)' }}>CAMBIO {formatMoney2(lastOrder.change)}</div>}<span className="rb-hint">Orden #{String(lastOrder?.number ?? 0).padStart(4, '0')} · {me?.fullName}</span></div>
      </RetroModal>
    </>
  );
  void serverTotal;
}

export async function printReceipt(orderId: string) {
  try {
    const { api } = await import('../app/api'); const txt = await api<string>(`/orders/${orderId}/receipt.txt`, { query: { width: 42 } });
    const w = window.open('', '_blank', 'width=380,height=640'); if (!w) return;
    w.document.write(`<pre style="font:13px/1.35 'Courier New',monospace;margin:8px">${String(txt).replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</pre>`); w.document.close(); w.focus(); w.print();
  } catch { /* la impresión es opcional */ }
}

export default PosInner;
