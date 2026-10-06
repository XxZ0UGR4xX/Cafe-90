import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RetroBadge, RetroButton, RetroCard, RetroInput, RetroSelect, RetroTable, formatMoney2, useToast } from '@retroburger/ui';
import { ApiError, TENANT, api } from '../api';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const RFC = /^[A-ZÑ&]{3,4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z0-9]{3}$/;
const REASONS: Record<string, string> = {
  NOT_PAID: 'Este ticket aún no está pagado, así que todavía no se puede facturar.',
  WINDOW_CLOSED: 'Ya pasó el plazo para facturar este ticket. Comunícate con el restaurante.',
  IN_GLOBAL: 'Este ticket ya quedó incluido en la factura global del día y no puede facturarse por separado. Comunícate con el restaurante.',
};
interface Cat { regimenes: { key: string; name: string; types: ('F' | 'M')[] }[]; usos: { key: string; name: string }[] }
const usoOk = (uso: string, reg: string, cat: Cat) => { const r = cat.regimenes.find((x) => x.key === reg); if (!r) return true; if (reg === '616') return uso === 'S01'; if (uso.startsWith('D')) return r.types.includes('F') && !r.types.includes('M'); return true; };

export function InvoicePage() {
  const toast = useToast(); const [sp] = useSearchParams();
  const [codeInput, setCodeInput] = useState(sp.get('c') ?? ''); const [look, setLook] = useState<any>(null); const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [r, setR] = useState({ rfc: '', legalName: '', postalCode: '', regimenFiscal: '', cfdiUse: 'G03', email: '' });
  const cat = useQuery({ queryKey: ['invoice-cat'], queryFn: () => api<Cat>('/invoice/catalogs') });
  const code = codeInput.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : '⚠️ No pudimos completar la operación. Inténtalo nuevamente.');

  const lookup = async (c = code, keepDone = false) => { setBusy(true); if (!keepDone) setDone(null); try { setLook(await api('/invoice/lookup', { method: 'POST', body: { code: c } })); } catch (e) { setLook(null); fail(e); } finally { setBusy(false); } };
  useEffect(() => { if (/^[0-9A-F]{12}$/.test(code) && sp.get('c')) void lookup(code); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const rfc = r.rfc.trim().toUpperCase(); const person = rfc.length === 13 ? 'F' : rfc.length === 12 ? 'M' : null;
  const regs = useMemo(() => (cat.data?.regimenes ?? []).filter((x) => !person || x.types.includes(person)), [cat.data, person]);
  const usos = useMemo(() => (cat.data?.usos ?? []).filter((u) => u.key !== 'CP01' && cat.data && usoOk(u.key, r.regimenFiscal, cat.data)), [cat.data, r.regimenFiscal]);
  const generic = rfc === 'XAXX010101000' || rfc === 'XEXX010101000';
  const valid = RFC.test(rfc) && !generic && r.legalName.trim().length > 1 && /^\d{5}$/.test(r.postalCode) && !!r.regimenFiscal && !!r.cfdiUse;

  const submit = async () => {
    setBusy(true);
    try { setDone(await api('/invoice', { method: 'POST', body: { code, receptor: { ...r, rfc, email: r.email || undefined } } })); await lookup(code, true); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const xmlUrl = `${BASE}/public/${TENANT}/invoice/${code}/xml`;

  return <div className="rb-col" style={{ maxWidth: 720, margin: '0 auto' }}>
    <RetroCard title="🧾 Factura tu consumo" tone="red"><div className="rb-col">
      <p style={{ margin: 0 }}>Captura el <strong>código de facturación</strong> impreso en tu ticket.</p>
      <div className="rb-row rb-wrap"><div className="rb-grow"><RetroInput label="Código del ticket" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoCapitalize="characters" maxLength={16} /></div>
        <RetroButton variant="neon" loading={busy && !look} disabled={code.length !== 12} onClick={() => void lookup()}>Buscar ticket</RetroButton></div>
    </div></RetroCard>

    {look && <RetroCard title={`Ticket #${String(look.number).padStart(4, '0')} · ${look.branch}`} tone="plain"><div className="rb-col">
      <div className="rb-row rb-wrap"><span className="rb-muted">{look.businessDate}</span><strong className="rb-end">{formatMoney2(look.total)}</strong></div>
      <RetroTable rows={look.items} rowKey={(_: any, i: number) => String(i)} columns={[{ key: 'n', header: 'Producto', render: (x: any) => `${x.qty}× ${x.name}` }, { key: 't', header: 'Importe', numeric: true, render: (x: any) => formatMoney2(x.total) }]} />
      {look.invoice && <div className="rb-col"><div className="rb-row rb-wrap"><RetroBadge tone="ok">✅ Ya facturado</RetroBadge><span>Folio {look.invoice.series}-{look.invoice.folio}</span>{look.invoice.simulated && <RetroBadge tone="orange">SIMULADO</RetroBadge>}</div>
        <code style={{ wordBreak: 'break-all' }}>{look.invoice.uuid}</code>
        {look.invoice.kind === 'ORDER' && <a className="rb-btn rb-btn--neon" href={xmlUrl} download>⬇️ Descargar XML</a>}</div>}
      {look.reason && REASONS[look.reason] && <div className="rb-error-text" role="alert">{REASONS[look.reason]}</div>}
    </div></RetroCard>}

    {look?.invoiceable && !done && <RetroCard title="Datos fiscales" tone="plain"><form className="rb-col" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="rb-grid rb-grid-2" style={{ gap: 12 }}>
        <RetroInput label="RFC" value={r.rfc} maxLength={13} autoCapitalize="characters" onChange={(e) => setR({ ...r, rfc: e.target.value.toUpperCase().replace(/\s/g, '') })} error={rfc.length >= 12 && !RFC.test(rfc) ? 'RFC con formato inválido' : generic ? 'Con este RFC no se factura por ticket' : undefined} />
        <RetroInput label="Código postal fiscal" inputMode="numeric" maxLength={5} value={r.postalCode} onChange={(e) => setR({ ...r, postalCode: e.target.value.replace(/\D/g, '') })} />
      </div>
      <RetroInput label="Nombre o razón social" value={r.legalName} onChange={(e) => setR({ ...r, legalName: e.target.value })} hint="Tal como aparece en tu constancia de situación fiscal, sin «S.A. de C.V.»." />
      <RetroSelect label="Régimen fiscal" value={r.regimenFiscal} onChange={(e) => { const regimenFiscal = e.target.value; setR({ ...r, regimenFiscal, cfdiUse: cat.data && usoOk(r.cfdiUse, regimenFiscal, cat.data) ? r.cfdiUse : regimenFiscal === '616' ? 'S01' : 'G03' }); }} options={[{ value: '', label: person ? 'Selecciona…' : 'Primero captura tu RFC' }, ...regs.map((x) => ({ value: x.key, label: `${x.key} · ${x.name}` }))]} />
      <RetroSelect label="Uso del CFDI" value={r.cfdiUse} onChange={(e) => setR({ ...r, cfdiUse: e.target.value })} options={usos.map((u) => ({ value: u.key, label: `${u.key} · ${u.name}` }))} />
      <RetroInput label="Correo (opcional)" type="email" value={r.email} onChange={(e) => setR({ ...r, email: e.target.value })} />
      <RetroButton type="submit" variant="neon" size="lg" block loading={busy} disabled={!valid}>🧾 Generar factura</RetroButton>
      <span className="rb-hint">Tu factura se timbra al instante. La propina no se incluye.</span>
    </form></RetroCard>}

    {done && <RetroCard title="🎉 ¡Factura generada!" tone="plain"><div className="rb-col">
      <div className="rb-row rb-wrap"><strong>Folio {done.series}-{done.folio}</strong><span className="rb-end">{formatMoney2(done.total)}</span></div>
      <code style={{ wordBreak: 'break-all' }}>{done.uuid}</code>
      {done.simulated && <div className="rb-error-text">Factura de PRUEBA: no tiene validez fiscal.</div>}
      <a className="rb-btn rb-btn--neon" href={xmlUrl} download>⬇️ Descargar XML</a></div></RetroCard>}
  </div>;
}
