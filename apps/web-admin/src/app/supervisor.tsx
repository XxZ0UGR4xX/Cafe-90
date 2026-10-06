import { type ReactNode, createContext, useCallback, useContext, useRef, useState } from 'react';
import { PinPad, RetroButton, RetroInput, RetroModal } from '@retroburger/ui';
import { ApiError } from './api';

export interface SupervisorCreds { userCode: string; pin: string }
type Ask = () => Promise<SupervisorCreds | null>;
const Ctx = createContext<Ask>(async () => null);

/** Pide autorización de supervisor (código + PIN) cuando la acción lo requiere. */
export function SupervisorProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false); const [code, setCode] = useState(() => { try { return localStorage.getItem('rb.supcode') ?? ''; } catch { return ''; } }); const [pin, setPin] = useState('');
  const resolver = useRef<((c: SupervisorCreds | null) => void) | null>(null);
  const ask = useCallback<Ask>(() => new Promise((res) => { resolver.current = res; setPin(''); setOpen(true); }), []);
  const done = (c: SupervisorCreds | null) => { setOpen(false); resolver.current?.(c); resolver.current = null; if (c) try { localStorage.setItem('rb.supcode', c.userCode); } catch { /* */ } };
  return (
    <Ctx.Provider value={ask}>
      {children}
      <RetroModal open={open} size="sm" title="🛡️ Autorización de gerente" onClose={() => done(null)}
        footer={<RetroButton variant="white" onClick={() => done(null)}>Cancelar</RetroButton>}>
        <div className="rb-col">
          <p style={{ margin: 0 }}>Esta acción requiere la autorización de un gerente. Ingresa su código y PIN.</p>
          <RetroInput label="Código del gerente" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" />
          <PinPad value={pin} onChange={setPin} onSubmit={() => code && done({ userCode: code.trim(), pin })} />
        </div>
      </RetroModal>
    </Ctx.Provider>
  );
}
export const useAskSupervisor = () => useContext(Ctx);

/** Ejecuta `fn`; si el servidor pide supervisor, solicita credenciales y reintenta una vez con ellas. */
export function useWithSupervisor() {
  const ask = useAskSupervisor();
  return useCallback(async <T,>(fn: (sup?: SupervisorCreds) => Promise<T>): Promise<T> => {
    try { return await fn(); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'SUPERVISOR_REQUIRED') {
        const creds = await ask(); if (!creds) throw e;
        return fn(creds);
      }
      throw e;
    }
  }, [ask]);
}
