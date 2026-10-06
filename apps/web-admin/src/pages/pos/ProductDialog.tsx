import { useMemo, useState } from 'react';
import { RetroButton, RetroCheck, RetroInput, RetroModal, formatMoney } from '@retroburger/ui';
import { unitPriceOf, type CartLine, type MenuModifierGroup, type MenuProduct } from '../../offline/estimate';

export interface MenuData { products: (MenuProduct & { categoryId: string | null; available: boolean; imageUrl?: string | null; description?: string | null; stationKey?: string | null })[]; modifierGroups: MenuModifierGroup[]; categories: { id: string; name: string; icon: string | null; color: string | null }[] }

/** Selección de variante, modificadores (con mínimos/máximos), componentes de combo y notas. */
export function ProductDialog({ product, menu, onClose, onAdd }: { product: MenuData['products'][number] | null; menu: MenuData; onClose: () => void; onAdd: (l: CartLine) => void }) {
  const [variantId, setVariantId] = useState<string | undefined>(undefined);
  const [mods, setMods] = useState<string[]>([]); const [qty, setQty] = useState(1); const [notes, setNotes] = useState('');
  const [choices, setChoices] = useState<Record<string, { productId: string; modifierIds: string[] }>>({});
  const groups = useMemo(() => menu.modifierGroups.filter((g) => product?.modifierGroupIds.includes(g.id)), [menu, product]);
  const byId = useMemo(() => new Map(menu.products.map((p) => [p.id, p])), [menu]);
  if (!product) return null;

  const comboChoices = product.comboSlots.map((s) => ({ slotId: s.id, productId: choices[s.id]?.productId ?? s.defaultProductId, modifierIds: choices[s.id]?.modifierIds ?? [] }));
  const unit = unitPriceOf(product, menu.modifierGroups, { variantId: variantId ?? product.variants[0]?.id, modifierIds: mods, comboChoices });
  const groupError = groups.find((g) => { const n = mods.filter((m) => g.modifiers.some((x) => x.id === m)).length; return n < g.minSelect || n > g.maxSelect; });
  const toggle = (g: MenuModifierGroup, id: string) => setMods((cur) => {
    if (cur.includes(id)) return cur.filter((x) => x !== id);
    const inGroup = cur.filter((m) => g.modifiers.some((x) => x.id === m));
    if (g.type === 'CHOICE' && g.maxSelect === 1) return [...cur.filter((m) => !inGroup.includes(m)), id];
    return inGroup.length >= g.maxSelect ? cur : [...cur, id];
  });
  const labels = [...mods.map((id) => { const m = menu.modifierGroups.flatMap((g) => g.modifiers.map((x) => ({ ...x, type: g.type }))).find((x) => x.id === id); return m ? `${m.type === 'REMOVE' ? 'SIN' : '+'} ${m.name}` : ''; })].filter(Boolean);
  const vId = variantId ?? product.variants[0]?.id;
  const add = () => onAdd({ key: crypto.randomUUID(), productId: product.id, name: vId ? `${product.name} (${product.variants.find((v) => v.id === vId)?.name})` : product.name, qty, variantId: vId, modifierIds: mods, comboChoices, notes: notes || undefined, unitPrice: unit,
    modifierLabels: [...labels, ...comboChoices.filter((c, i) => c.productId !== product.comboSlots[i]!.defaultProductId).map((c) => `↔ ${byId.get(c.productId)?.name}`)] });

  return (
    <RetroModal open title={`${product.name} · ${formatMoney(unit)}`} onClose={onClose} size="lg"
      footer={<>
        <div className="rb-qty"><button aria-label="Menos" onClick={() => setQty(Math.max(1, qty - 1))}>−</button><strong style={{ minWidth: 28, textAlign: 'center' }}>{qty}</strong><button aria-label="Más" onClick={() => setQty(Math.min(99, qty + 1))}>+</button></div>
        <RetroButton variant="neon" size="lg" disabled={!!groupError} onClick={add}>Agregar · {formatMoney(unit * qty)}</RetroButton>
      </>}>
      <div className="rb-col">
        {product.description && <p className="rb-muted" style={{ margin: 0 }}>{product.description}</p>}
        {product.variants.length > 0 && <div><div className="rb-label">Tamaño / variante</div><div className="rb-row rb-wrap">{product.variants.map((v) => <RetroButton key={v.id} variant={(vId === v.id) ? 'red' : 'white'} onClick={() => setVariantId(v.id)}>{v.name}{v.priceDelta ? ` ${v.priceDelta > 0 ? '+' : ''}${formatMoney(v.priceDelta)}` : ''}</RetroButton>)}</div></div>}
        {product.comboSlots.map((s) => {
          const cur = comboChoices.find((c) => c.slotId === s.id)!; const options = [{ productId: s.defaultProductId, priceDelta: 0 }, ...s.options.filter((o) => o.productId !== s.defaultProductId)];
          return <div key={s.id}><div className="rb-label">{s.name}</div><div className="rb-row rb-wrap">{options.map((o) => { const p = byId.get(o.productId); return <RetroButton key={o.productId} disabled={p && !p.available} variant={cur.productId === o.productId ? 'red' : 'white'} onClick={() => setChoices((c) => ({ ...c, [s.id]: { productId: o.productId, modifierIds: [] } }))}>{p?.name ?? 'Producto'}{o.priceDelta ? ` ${o.priceDelta > 0 ? '+' : ''}${formatMoney(o.priceDelta)}` : ''}</RetroButton>; })}</div></div>;
        })}
        {groups.map((g) => (
          <div key={g.id}><div className="rb-label">{g.type === 'REMOVE' ? '🚫 ' : g.type === 'EXTRA' ? '➕ ' : ''}{g.name}{g.minSelect > 0 ? ' (requerido)' : ''}</div>
            <div className="rb-grid rb-grid-3" style={{ gap: 8 }}>{g.modifiers.map((m) => <RetroCheck key={m.id} checked={mods.includes(m.id)} onChange={() => toggle(g, m.id)} label={<>{g.type === 'REMOVE' ? 'Sin ' : ''}{m.name}{m.priceDelta ? <span className="rb-muted"> ({m.priceDelta > 0 ? '+' : ''}{formatMoney(m.priceDelta)})</span> : null}</>} />)}</div>
            {groupError?.id === g.id && <span className="rb-error-text">Selecciona entre {g.minSelect} y {g.maxSelect}</span>}</div>
        ))}
        <RetroInput label="Notas para cocina" placeholder="Ej. bien cocida, sin sal…" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
      </div>
    </RetroModal>
  );
}
