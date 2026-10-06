import { useMemo, useState } from 'react';
import { ProductDialog, RetroBadge, RetroButton, RetroCard, RetroPOSButton, RetroProductCard, formatMoney2, totalsOf, type CartLine, type MenuData } from '@retroburger/ui';
import { useCart } from '../cart';

/** Catálogo navegable + carrito; lo usan el sitio público y el menú de mesa por QR. */
export function MenuBrowser({ menu, children }: { menu: MenuData & { promotions?: { id: string; name: string; type: string }[] }; children?: (lines: CartLine[]) => React.ReactNode }) {
  const [cat, setCat] = useState('ALL'); const [dlg, setDlg] = useState<MenuData['products'][number] | null>(null); const cart = useCart();
  const products = useMemo(() => menu.products.filter((p) => cat === 'ALL' || p.categoryId === cat), [menu, cat]);
  const quick = (p: MenuData['products'][number]) => cart.add({ key: crypto.randomUUID(), productId: p.id, name: p.name, qty: 1, modifierIds: [], comboChoices: [], unitPrice: p.price, modifierLabels: [] });
  const t = totalsOf(cart.lines);
  return (
    <div className="rb-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(280px,340px)', alignItems: 'start' }}>
      <div className="rb-col">
        {(menu.promotions?.length ?? 0) > 0 && <div className="rb-row rb-wrap">{menu.promotions!.map((p) => <RetroBadge key={p.id} tone="orange">🎟️ {p.name}</RetroBadge>)}</div>}
        <div className="rb-row rb-wrap"><RetroPOSButton className="" icon="🍽️" pressed={cat === 'ALL'} onClick={() => setCat('ALL')} style={{ width: 'auto', minWidth: 90 }}>Todo</RetroPOSButton>
          {menu.categories.map((c) => <RetroPOSButton key={c.id} icon={c.icon ?? '🍔'} pressed={cat === c.id} onClick={() => setCat(c.id)} style={{ width: 'auto', minWidth: 90 }}>{c.name}</RetroPOSButton>)}</div>
        <div className="rb-products">{products.map((p) => <RetroProductCard key={p.id} name={p.name} price={p.price} image={p.imageUrl} emoji={menu.categories.find((c) => c.id === p.categoryId)?.icon ?? '🍔'} available={p.available} note={p.description ?? undefined}
          onClick={() => (p.variants.length || p.comboSlots.length || p.modifierGroupIds.length ? setDlg(p) : quick(p))} />)}</div>
      </div>
      <RetroCard title="🛒 Tu pedido" tone="red" className="rb-sticky">
        <div className="rb-col">
          {cart.lines.length === 0 && <div className="rb-empty"><div className="big">🍟</div>Agrega algo delicioso</div>}
          {cart.lines.map((l) => <div key={l.key} className="rb-ticket__line" style={{ padding: 0 }}><span><strong>{l.qty}×</strong> {l.name}</span><span className="rb-mono">{formatMoney2(l.unitPrice * l.qty)}</span>
            {l.modifierLabels.length > 0 && <span className="mods">{l.modifierLabels.join(' · ')}</span>}
            <span className="rb-qty"><button aria-label="Menos" onClick={() => cart.setQty(l.key, l.qty - 1)}>−</button><button aria-label="Más" onClick={() => cart.setQty(l.key, l.qty + 1)}>+</button></span></div>)}
          <div className="rb-row"><strong>Total</strong><span className="rb-end rb-display" style={{ fontSize: '1.4rem' }}>{formatMoney2(t.total)}</span></div>
          {children?.(cart.lines)}
        </div>
      </RetroCard>
      <ProductDialog key={dlg?.id} product={dlg} menu={menu} onClose={() => setDlg(null)} onAdd={(l) => { cart.add(l); setDlg(null); }} />
      <style>{`@media (max-width: 800px){ .rb-grid[style*="minmax(280px"]{ grid-template-columns: 1fr !important } } .rb-sticky{ position: sticky; top: 12px }`}</style>
      <RetroButton variant="ghost" style={{ display: 'none' }}>.</RetroButton>
    </div>
  );
}
