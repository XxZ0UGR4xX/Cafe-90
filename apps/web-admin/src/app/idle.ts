import { create } from 'zustand';

const KEY = 'rb.arcade';
interface ArcadeCfg { enabled: boolean; minutes: number }
const read = (): ArcadeCfg => { try { return { enabled: true, minutes: 5, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { enabled: true, minutes: 5 }; } };
interface ArcadeStore extends ArcadeCfg { save: (c: Partial<ArcadeCfg>) => void; /** páginas que bloquean el protector (POS con carrito, KDS) */ blockers: number; block: () => () => void }
export const useArcade = create<ArcadeStore>((set, get) => ({
  ...read(), blockers: 0,
  save: (c) => { const n = { enabled: get().enabled, minutes: get().minutes, ...c }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* */ } set(n); },
  block: () => { set((s) => ({ blockers: s.blockers + 1 })); return () => set((s) => ({ blockers: Math.max(0, s.blockers - 1) })); },
}));
