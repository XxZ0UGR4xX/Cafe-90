import { create } from 'zustand';
import { api, post, refreshSession, setToken } from './api';

export interface Me {
  id: string; email: string; fullName: string; isCorporate: boolean;
  tenant: { id: string; slug: string; name: string; currency: string; locale: string; timezone: string };
  roles: { roleKey: string; branchId: string | null }[]; permissions: Record<string, 'ALL' | string[]>; branchScope: string[] | null;
}
interface SessionState {
  me: Me | null; status: 'loading' | 'anon' | 'ready';
  bootstrap: () => Promise<void>; login: (tenant: string, email: string, password: string) => Promise<void>; pinLogin: (tenant: string, userCode: string, pin: string) => Promise<void>; logout: () => Promise<void>;
  can: (perm: string, branchId?: string | null) => boolean; anyOf: (...perms: string[]) => boolean; reset: () => void;
}
export const useSession = create<SessionState>((set, get) => ({
  me: null, status: 'loading',
  async bootstrap() {
    try { const t = await refreshSession(); if (!t) return set({ me: null, status: 'anon' }); set({ me: await api<Me>('/auth/me'), status: 'ready' }); }
    catch { set({ me: null, status: 'anon' }); }
  },
  async login(tenant, email, password) {
    const r = await api('/auth/login', { method: 'POST', body: { tenant, email, password }, noAuth: true }); setToken(r.accessToken);
    set({ me: await api<Me>('/auth/me'), status: 'ready' });
  },
  async pinLogin(tenant, userCode, pin) {
    const r = await api('/auth/pin-login', { method: 'POST', body: { tenant, userCode, pin }, noAuth: true }); setToken(r.accessToken);
    set({ me: await api<Me>('/auth/me'), status: 'ready' });
  },
  async logout() { try { await api('/auth/logout', { method: 'POST', body: {}, headers: { 'x-requested-with': 'retroburger' } }); } catch { /* ya sin sesión */ } get().reset(); },
  reset() { setToken(null); set({ me: null, status: 'anon' }); },
  can(perm, branchId) {
    const s = get().me?.permissions[perm]; if (!s) return false;
    return s === 'ALL' || !branchId || s.includes(branchId);
  },
  anyOf: (...perms) => perms.some((p) => get().can(p)),
}));
void post;
