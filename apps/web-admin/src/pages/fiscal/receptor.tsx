import { useMemo } from 'react';
import { RetroInput, RetroSelect } from '@retroburger/ui';
import { apiBase, getToken } from '../../app/api';
import { useGet } from '../../app/hooks';
import { Row } from '../common';

export interface ReceptorValue { rfc: string; legalName: string; regimenFiscal: string; postalCode: string; cfdiUse: string; email?: string }
export const EMPTY_RECEPTOR: ReceptorValue = { rfc: '', legalName: '', regimenFiscal: '', postalCode: '', cfdiUse: 'G03', email: '' };

export interface FiscalCatalogs {
  regimenes: { key: string; name: string; types: ('F' | 'M')[] }[]; emitterRegimenes: string[];
  usos: { key: string; name: string }[]; formasPago: Record<string, string>; motivosCancelacion: Record<string, string>;
}
export const useFiscalCatalogs = () => useGet<FiscalCatalogs>(['fiscal', 'catalogs'], '/fiscal/catalogs');

export const GENERIC = ['XAXX010101000', 'XEXX010101000'];
export const rfcLooksValid = (v: string) => /^[A-ZÑ&]{3,4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z0-9]{3}$/.test(v.trim().toUpperCase());
export const personOf = (rfc: string): 'F' | 'M' | null => { const n = rfc.trim().length; return n === 13 ? 'F' : n === 12 ? 'M' : null; };

/** Uso de CFDI compatible con el régimen (mismo criterio que la API; el PAC valida el catálogo completo). */
export const usoOk = (uso: string, regimen: string, regs: FiscalCatalogs['regimenes']) => {
  const r = regs.find((x) => x.key === regimen); if (!r) return true;
  if (regimen === '616') return uso === 'S01';
  if (uso.startsWith('D')) return r.types.includes('F') && !r.types.includes('M');
  return true;
};

/** Datos del receptor (cliente que pide la factura). Filtra régimen y uso según el RFC capturado. */
export function ReceptorForm({ value, onChange, disabled }: { value: ReceptorValue; onChange: (v: ReceptorValue) => void; disabled?: boolean }) {
  const cat = useFiscalCatalogs();
  const rfc = value.rfc.trim().toUpperCase(); const person = personOf(rfc);
  const regs = useMemo(() => (cat.data?.regimenes ?? []).filter((r) => !person || r.types.includes(person)), [cat.data, person]);
  const usos = useMemo(() => (cat.data?.usos ?? []).filter((u) => u.key !== 'CP01' && usoOk(u.key, value.regimenFiscal, cat.data?.regimenes ?? [])), [cat.data, value.regimenFiscal]);
  const set = (p: Partial<ReceptorValue>) => onChange({ ...value, ...p });
  const bad = rfc.length >= 12 && !rfcLooksValid(rfc);
  return <div className="rb-col">
    <Row>
      <RetroInput label="RFC" value={value.rfc} disabled={disabled} maxLength={13} autoCapitalize="characters" onChange={(e) => set({ rfc: e.target.value.toUpperCase().replace(/\s/g, '') })} error={bad ? 'RFC con formato inválido' : GENERIC.includes(rfc) ? 'Para el público en general se usa la factura global' : undefined} />
      <RetroInput label="Código postal fiscal" value={value.postalCode} disabled={disabled} inputMode="numeric" maxLength={5} onChange={(e) => set({ postalCode: e.target.value.replace(/\D/g, '') })} />
    </Row>
    <RetroInput label="Nombre o razón social (como en la constancia fiscal)" value={value.legalName} disabled={disabled} onChange={(e) => set({ legalName: e.target.value })} />
    <span className="rb-hint" style={{ marginTop: -8 }}>Se escribe sin «S.A. de C.V.» ni otro régimen societario: el SAT lo exige así en CFDI 4.0.</span>
    <RetroSelect label="Régimen fiscal" value={value.regimenFiscal} disabled={disabled} onChange={(e) => { const regimenFiscal = e.target.value; set({ regimenFiscal, cfdiUse: usoOk(value.cfdiUse, regimenFiscal, cat.data?.regimenes ?? []) ? value.cfdiUse : regimenFiscal === '616' ? 'S01' : 'G03' }); }}
      options={[{ value: '', label: person ? 'Selecciona…' : 'Primero captura el RFC' }, ...regs.map((r) => ({ value: r.key, label: `${r.key} · ${r.name}` }))]} />
    <Row>
      <RetroSelect label="Uso del CFDI" value={value.cfdiUse} disabled={disabled} onChange={(e) => set({ cfdiUse: e.target.value })} options={usos.map((u) => ({ value: u.key, label: `${u.key} · ${u.name}` }))} />
      <RetroInput label="Correo (opcional)" type="email" value={value.email ?? ''} disabled={disabled} onChange={(e) => set({ email: e.target.value })} />
    </Row>
  </div>;
}
export const receptorComplete = (v: ReceptorValue) => rfcLooksValid(v.rfc) && !GENERIC.includes(v.rfc.trim().toUpperCase()) && v.legalName.trim().length > 1 && !!v.regimenFiscal && /^\d{5}$/.test(v.postalCode) && !!v.cfdiUse;

/** Descarga un archivo protegido (Bearer) y lo entrega al navegador. */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await fetch(`${apiBase}${path}`, { credentials: 'include', headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {} });
  if (!res.ok) throw new Error('No pudimos descargar el archivo.');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
