import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { enqueue, listOps, removeOps } from './store';
import { totalsOf, unitPriceOf, type MenuModifierGroup, type MenuProduct } from '@retroburger/ui';

const burger: MenuProduct = { id: 'b', name: 'Retro Burger', price: 129, kind: 'SIMPLE', variants: [{ id: 'v1', name: 'Doble', priceDelta: 40 }], comboSlots: [], modifierGroupIds: ['g'] };
const groups: MenuModifierGroup[] = [{ id: 'g', name: 'Extras', type: 'EXTRA', minSelect: 0, maxSelect: 3, modifiers: [{ id: 'q', name: 'Queso', priceDelta: 15 }, { id: 't', name: 'Tocino', priceDelta: 25 }] }];

describe('estimación offline', () => {
  it('precio unitario suma variante y extras', () => expect(unitPriceOf(burger, groups, { variantId: 'v1', modifierIds: ['q', 't'], comboChoices: [] })).toBe(129 + 40 + 15 + 25));
  it('totales con descuento limitado al subtotal', () => {
    const lines = [{ key: '1', productId: 'b', name: 'x', qty: 2, modifierIds: [], comboChoices: [], unitPrice: 129, modifierLabels: [] }];
    expect(totalsOf(lines, 58).total).toBe(200); expect(totalsOf(lines, 9999).total).toBe(0);
  });
});

describe('outbox persistente', () => {
  it('conserva el orden de captura y permite eliminar tras sincronizar', async () => {
    const a = await enqueue({ opId: crypto.randomUUID(), type: 'ORDER_CREATE', branchId: 'b1', payload: { n: 1 }, createdAt: '2026-10-06T10:00:00.000Z' });
    const b = await enqueue({ opId: crypto.randomUUID(), type: 'ORDER_PAY', branchId: 'b1', payload: { n: 2 }, createdAt: '2026-10-06T10:00:05.000Z' });
    const ops = await listOps();
    expect(ops.map((o) => o.op.opId)).toEqual([a.opId, b.opId]);
    await removeOps(ops.map((o) => o.key));
    expect(await listOps()).toEqual([]);
  });
});
