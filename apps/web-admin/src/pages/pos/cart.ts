import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartLine } from '../../offline/estimate';

export type Channel = 'DINE_IN' | 'TAKEAWAY';
export interface OfflineOrder { clientUuid: string; label: string; lines: CartLine[]; total: number; channel: Channel; tableId?: string; branchId: string; paid: boolean; createdAt: string }
interface CartState {
  lines: CartLine[]; channel: Channel; tableId: string | null; tableNumber: number | null; orderId: string | null; customer: { id: string; name: string } | null; notes: string;
  offline: OfflineOrder[]; activeOffline: string | null;
  add: (l: CartLine) => void; setQty: (key: string, qty: number) => void; remove: (key: string) => void; clear: () => void; reset: () => void;
  set: (p: Partial<CartState>) => void; addOffline: (o: OfflineOrder) => void; markOfflinePaid: (clientUuid: string) => void; dropOffline: (clientUuid: string) => void;
}
const empty = { lines: [] as CartLine[], tableId: null, tableNumber: null, orderId: null, customer: null, notes: '', activeOffline: null };
/** Carrito del POS por dispositivo; sobrevive a recargas (localStorage). */
export const useCart = create<CartState>()(persist((set) => ({
  ...empty, channel: 'DINE_IN' as Channel, offline: [],
  add: (l) => set((s) => {
    const same = s.lines.find((x) => x.productId === l.productId && x.variantId === l.variantId && !x.notes && !l.notes && JSON.stringify([x.modifierIds, x.comboChoices]) === JSON.stringify([l.modifierIds, l.comboChoices]));
    return same ? { lines: s.lines.map((x) => (x === same ? { ...x, qty: x.qty + l.qty } : x)) } : { lines: [...s.lines, l] };
  }),
  setQty: (key, qty) => set((s) => ({ lines: qty <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, qty } : l)) })),
  remove: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
  clear: () => set({ lines: [] }), reset: () => set({ ...empty }), set: (p) => set(p as Partial<CartState>),
  addOffline: (o) => set((s) => ({ offline: [...s.offline, o] })),
  markOfflinePaid: (cu) => set((s) => ({ offline: s.offline.map((o) => (o.clientUuid === cu ? { ...o, paid: true } : o)) })),
  dropOffline: (cu) => set((s) => ({ offline: s.offline.filter((o) => o.clientUuid !== cu), activeOffline: s.activeOffline === cu ? null : s.activeOffline })),
}), { name: 'rb.cart', partialize: (s) => ({ lines: s.lines, channel: s.channel, tableId: s.tableId, tableNumber: s.tableNumber, orderId: s.orderId, customer: s.customer, notes: s.notes, offline: s.offline, activeOffline: s.activeOffline }) }));
