import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartLine } from '@retroburger/ui';

interface Cart { lines: CartLine[]; branchId: string | null; add: (l: CartLine) => void; setQty: (k: string, q: number) => void; clear: () => void; setBranch: (b: string) => void }
export const useCart = create<Cart>()(persist((set) => ({
  lines: [], branchId: null,
  add: (l) => set((s) => ({ lines: [...s.lines, l] })),
  setQty: (k, q) => set((s) => ({ lines: q <= 0 ? s.lines.filter((l) => l.key !== k) : s.lines.map((l) => (l.key === k ? { ...l, qty: q } : l)) })),
  clear: () => set({ lines: [] }),
  setBranch: (b) => set((s) => (s.branchId === b ? s : { branchId: b, lines: [] })),
}), { name: 'rb.public.cart' }));
export const toItems = (lines: CartLine[]) => lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty, notes: l.notes, modifierIds: l.modifierIds, comboChoices: l.comboChoices }));
