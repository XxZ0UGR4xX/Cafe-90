import { create } from 'zustand';

const KEY = 'rb.branch';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
interface BranchState { branchId: string | null; set: (id: string | null) => void }
/** Sucursal activa (persistida por dispositivo). Cambiarla limpia el estado dependiente vía queryKey. */
export const useBranch = create<BranchState>((set) => ({
  branchId: read(),
  set: (id) => { try { id ? localStorage.setItem(KEY, id) : localStorage.removeItem(KEY); } catch { /* sin storage */ } set({ branchId: id }); },
}));
