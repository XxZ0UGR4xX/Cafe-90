import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useToast } from '@retroburger/ui';
import { ApiError, api, get } from './api';
import { useBranch } from './branch';

/** Consulta GET con clave estable y mensajes de error humanos. */
export function useGet<T = any>(key: QueryKey, path: string, query?: Record<string, unknown>, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery<T, ApiError>({ queryKey: [...key, query ?? null], queryFn: () => get<T>(path, query), enabled: opts.enabled ?? true, refetchInterval: opts.refetchInterval });
}
export const useBranchId = () => useBranch((s) => s.branchId);

/** Mutación con toast de error humano e invalidación de claves. */
export function useAct<TVars = void, TRes = any>(fn: (v: TVars) => Promise<TRes>, o: { invalidate?: QueryKey[]; ok?: string; onSuccess?: (r: TRes, v: TVars) => void } = {}) {
  const qc = useQueryClient(); const toast = useToast();
  return useMutation<TRes, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: (r, v) => { o.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k })); if (o.ok) toast.ok(o.ok); o.onSuccess?.(r, v); },
    onError: (e) => toast.error(e.message || '⚠️ No pudimos completar la operación. Inténtalo nuevamente.'),
  });
}
export const fetchJson = api;
