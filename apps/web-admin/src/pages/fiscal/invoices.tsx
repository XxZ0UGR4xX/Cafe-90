import { useState } from 'react';
import { RetroBadge, RetroButton, RetroCard, RetroInput, RetroModal, RetroSelect, RetroTable, RetroTabs, type Tone, formatMoney2 } from '@retroburger/ui';
import { post } from '../../app/api';
import { useAct, useBranchId, useGet } from '../../app/hooks';
import { useSession } from '../../app/auth';
import { Async, FormModal, fmtDate, today } from '../common';
import { EMPTY_RECEPTOR, ReceptorForm, type ReceptorValue, downloadFile, receptorComplete, useFiscalCatalogs } from './receptor';

export const INVOICE_STATUS: Record<string, [Tone, string]> = {
  STAMPED: ['ok', '✅ Vigente'], PENDING: ['warn', '⏳ Timbrando'], ERROR: ['danger', '⚠️ Error'], CANCELLED: ['neutral', '🚫 Cancelada'], CANCEL_PENDING: ['warn', '⏳ Cancelación pendiente'],
};
export const StatusPill = ({ s }: { s: string }) => { const [tone, label] = INVOICE_STATUS[s] ?? ['neutral', s]; return <RetroBadge tone={tone}>{label}</RetroBadge>; };
export const folioOf = (i: { series: string; folio: number }) => `${i.series}-${i.folio}`;
const SIM = <RetroBadge tone="orange">SIMULADO · sin validez fiscal</RetroBadge>;

/** Facturar una orden pagada: usa los datos fiscales del cliente si existen, o captura los del receptor. */
export function InvoiceOrderDialog({ order, onClose, onDone }: { order: { id: string; number: number; total: number; customerId?: string | null; customerName?: string | null }; onClose: () => void; onDone: (invoiceId: string) => void }) {
  const [r, setR] = useState<ReceptorValue>(EMPTY_RECEPTOR); const [save, setSave] = useState(true);
  const saved = useGet<any>(['customer-fiscal', order.customerId], `/customers/${order.customerId}/fiscal`, undefined, { enabled: !!order.customerId });
  const useSaved = !!saved.data && r.rfc === '';
  const issue = useAct(() => post('/invoices', useSaved ? { orderId: order.id, customerId: order.customerId } : { orderId: order.id, receptor: { ...r, email: r.email || undefined }, customerId: order.customerId ?? undefined, saveToCustomer: !!order.customerId && save }),
    { invalidate: [['orders'], ['invoices']], ok: '🧾 Factura timbrada', onSuccess: (inv) => onDone(inv.id) });
  return <FormModal open onClose={onClose} size="lg" title={`Facturar orden #${String(order.number).padStart(4, '0')} · ${formatMoney2(order.total)}`} submitLabel="🧾 Timbrar factura" busy={issue.isPending} disabled={!useSaved && !receptorComplete(r)} onSubmit={() => issue.mutate()}>
    {useSaved ? <RetroCard tone="plain" title="Datos fiscales guardados del cliente">
      <div><strong>{saved.data.legalName}</strong> · {saved.data.rfc}</div><div className="rb-hint">Régimen {saved.data.regimenFiscal} · CP {saved.data.postalCode} · Uso {saved.data.cfdiUse}</div>
      <RetroButton size="sm" variant="white" onClick={() => setR({ ...saved.data, email: saved.data.email ?? '' })}>Usar otros datos</RetroButton></RetroCard>
      : <><ReceptorForm value={r} onChange={setR} />
        {order.customerId && <label className="rb-row"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Guardar estos datos en el cliente{order.customerName ? ` (${order.customerName})` : ''}</label>}</>}
    <span className="rb-hint">La propina no se incluye en la factura. Los datos se validan contra el catálogo del SAT antes de timbrar.</span>
  </FormModal>;
}

export function InvoiceDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useGet<any>(['invoices', 'one', id], `/invoices/${id}`); const { can } = useSession(); const cat = useFiscalCatalogs();
  const [cancel, setCancel] = useState<{ motive: string; replacementUuid: string } | null>(null); const [mailTo, setMailTo] = useState<string | null>(null);
  const sendMail = useAct(() => post(`/invoices/${id}/email`, { to: mailTo || undefined }), { ok: '✉️ Factura en cola de envío', onSuccess: () => setMailTo(null) });
  const i = q.data;
  const doCancel = useAct(() => post(`/invoices/${id}/cancel`, { motive: cancel!.motive, replacementUuid: cancel!.replacementUuid || undefined }), { invalidate: [['invoices'], ['orders']], ok: 'Cancelación registrada', onSuccess: () => setCancel(null) });
  const retry = useAct(() => post(`/invoices/${id}/retry`), { invalidate: [['invoices']], ok: '🧾 Factura timbrada' });
  const xml = useAct(() => downloadFile(`/invoices/${id}/xml`, `CFDI-${id}.xml`).then(() => undefined));
  return <RetroModal open onClose={onClose} size="lg" title={i ? `Factura ${folioOf(i)}` : 'Factura'} footer={i && <>
    {i.xml !== null && i.uuid && <RetroButton variant="white" loading={xml.isPending} onClick={() => xml.mutate()}>⬇️ XML</RetroButton>}
    {i.uuid && <RetroButton variant="white" onClick={() => window.print()}>🖨️ Imprimir</RetroButton>}
    {i.xml !== null && i.uuid && can('fiscal.invoice.issue', i.branchId) && <RetroButton variant="white" onClick={() => setMailTo(i.receptorEmail ?? '')}>✉️ Enviar</RetroButton>}
    {['ERROR', 'PENDING'].includes(i.status) && can('fiscal.invoice.issue', i.branchId) && <RetroButton variant="mustard" loading={retry.isPending} onClick={() => retry.mutate()}>↻ Reintentar timbrado</RetroButton>}
    {i.status === 'STAMPED' && can('fiscal.invoice.cancel', i.branchId) && <RetroButton variant="ink" onClick={() => setCancel({ motive: '02', replacementUuid: '' })}>Cancelar factura</RetroButton>}</>}>
    <Async q={q}>{i && <div className="rb-col rb-print-area">
      <div className="rb-row rb-wrap"><StatusPill s={i.status} />{i.simulated && SIM}<RetroBadge tone="info">{i.kind === 'GLOBAL' ? 'Factura global' : 'Por ticket'}</RetroBadge><span className="rb-muted">{fmtDate(i.issuedAt)} · {i.branchName}</span></div>
      {i.errorMessage && <div className="rb-error-text">{i.errorMessage}</div>}
      <div className="rb-grid rb-grid-2">
        <RetroCard tone="plain" title="Emisor"><strong>{i.issuerName}</strong><div>{i.issuerRfc} · Régimen {i.issuerRegimen}</div><div className="rb-hint">Lugar de expedición CP {i.placeOfIssue}</div></RetroCard>
        <RetroCard tone="plain" title="Receptor"><strong>{i.receptorName}</strong><div>{i.receptorRfc} · Régimen {i.receptorRegimen}</div><div className="rb-hint">CP {i.receptorPostalCode} · Uso {i.cfdiUse} · Pago {i.formaPago} {cat.data?.formasPago[i.formaPago] ?? ''}</div></RetroCard>
      </div>
      {i.uuid && <div><div className="rb-label">Folio fiscal (UUID)</div><code style={{ wordBreak: 'break-all' }}>{i.uuid}</code></div>}
      {i.globalInfo && <div className="rb-hint">Factura global · periodicidad {i.globalInfo.periodicity} · mes {i.globalInfo.months}/{i.globalInfo.year} · tickets: {i.orders.map((o: any) => `#${o.number}`).join(', ')}</div>}
      <RetroTable rows={i.items} columns={[{ key: 'd', header: 'Concepto', render: (x: any) => <><strong>{x.qty}× {x.description}</strong><div className="rb-hint">{x.satProductKey} · {x.satUnitKey}</div></> }, { key: 'a', header: 'Importe', numeric: true, render: (x: any) => formatMoney2(x.amount) }, { key: 'ds', header: 'Desc.', numeric: true, render: (x: any) => (x.discount ? formatMoney2(x.discount) : '—') }, { key: 't', header: `IVA`, numeric: true, render: (x: any) => `${formatMoney2(x.tax)} (${Math.round(x.taxRate * 100)}%)` }]} />
      <div className="rb-row" style={{ justifyContent: 'flex-end', gap: 24 }}><div>Subtotal<br /><strong className="rb-mono">{formatMoney2(i.subtotal)}</strong></div>{i.discount > 0 && <div>Descuento<br /><strong className="rb-mono">−{formatMoney2(i.discount)}</strong></div>}<div>IVA<br /><strong className="rb-mono">{formatMoney2(i.tax)}</strong></div><div>TOTAL<br /><strong className="rb-display" style={{ fontSize: '1.4rem' }}>{formatMoney2(i.total)}</strong></div></div>
      {i.cancelMotive && <div className="rb-error-text">Cancelación · motivo {i.cancelMotive} {cat.data?.motivosCancelacion[i.cancelMotive] ?? ''}</div>}
    </div>}</Async>
    <FormModal open={mailTo !== null} onClose={() => setMailTo(null)} size="sm" title="Enviar factura por correo" submitLabel="Enviar XML" busy={sendMail.isPending} disabled={!mailTo?.includes('@')} onSubmit={() => sendMail.mutate()}><RetroInput label="Correo del destinatario" type="email" value={mailTo ?? ''} onChange={(e) => setMailTo(e.target.value)} autoFocus /><span className="rb-hint">Se envía el XML adjunto.</span></FormModal>
    <FormModal open={!!cancel} onClose={() => setCancel(null)} size="sm" title="Cancelar factura" submitLabel="Cancelar ante el SAT" busy={doCancel.isPending} disabled={!cancel || (cancel.motive === '01' && !/^[0-9a-f-]{36}$/i.test(cancel.replacementUuid))} onSubmit={() => doCancel.mutate()}>{cancel && <>
      <RetroSelect label="Motivo de cancelación" value={cancel.motive} onChange={(e) => setCancel({ ...cancel, motive: e.target.value })} options={Object.entries(cat.data?.motivosCancelacion ?? {}).map(([k, v]) => ({ value: k, label: `${k} · ${v}` }))} />
      {cancel.motive === '01' && <RetroInput label="UUID del comprobante que sustituye" value={cancel.replacementUuid} onChange={(e) => setCancel({ ...cancel, replacementUuid: e.target.value.trim() })} />}
      <span className="rb-hint">Tras cancelar, la cuenta queda libre para facturarse de nuevo o para devolverse. Puede requerir aceptación del receptor.</span></>}</FormModal>
  </RetroModal>;
}

export default function Invoices() {
  const { can } = useSession(); const branchId = useBranchId();
  const [tab, setTab] = useState<'all' | 'STAMPED' | 'CANCELLED' | 'ERROR'>('all'); const [search, setSearch] = useState(''); const [sel, setSel] = useState<string | null>(null);
  const [global, setGlobal] = useState<{ date: string } | null>(null);
  const q = useGet<any[]>(['invoices'], '/invoices', { status: tab === 'all' ? undefined : tab, q: search || undefined, limit: 100 });
  const prof = useGet<any>(['fiscal', 'profile'], '/fiscal/profile', undefined, { enabled: can('fiscal.profile.read') });
  // el último día CERRADO es el anterior al día operativo del servidor (el corte es a las 04:00, no a medianoche)
  const businessDate = useSession((s) => s.me?.tenant.businessDate) ?? today();
  const yesterday = new Date(Date.parse(`${businessDate}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const runGlobal = useAct(() => post('/invoices/global', { branchId, date: global!.date }), { invalidate: [['invoices']], ok: '🧾 Factura global timbrada', onSuccess: (inv) => { setGlobal(null); setSel(inv.id); } });
  return <>
    {prof.data && (!prof.data.profile?.enabled || !prof.data.provider) && <RetroCard tone="red" title="🧾 Facturación sin configurar"><p style={{ margin: 0 }}>Falta el perfil fiscal del restaurante (RFC, razón social, régimen y código postal) o está deshabilitado. Configúralo en <strong>Configuración → Facturación</strong>.</p></RetroCard>}
    {prof.data?.provider?.simulated && <RetroCard tone="plain" title="Proveedor de timbrado simulado"><span>Las facturas se generan con un timbre falso y <strong>no tienen validez fiscal</strong>. Sirve para probar el flujo; en producción se conecta un PAC real.</span></RetroCard>}
    <div className="rb-row rb-wrap">
      <RetroTabs value={tab} onChange={setTab} tabs={[{ key: 'all', label: 'Todas' }, { key: 'STAMPED', label: '✅ Vigentes' }, { key: 'CANCELLED', label: '🚫 Canceladas' }, { key: 'ERROR', label: '⚠️ Con error' }]} />
      <span className="rb-end rb-row"><RetroInput aria-label="Buscar" placeholder="RFC, nombre, folio o UUID" value={search} onChange={(e) => setSearch(e.target.value)} />
        {can('fiscal.invoice.issue') && branchId && <RetroButton variant="mustard" onClick={() => setGlobal({ date: yesterday })}>🌐 Factura global</RetroButton>}</span>
    </div>
    <Async q={q}><RetroTable rows={q.data ?? []} onRowClick={(r) => setSel(r.id)} empty="Aún no hay facturas. Se emiten desde el detalle de un pedido pagado o con la factura global."
      columns={[{ key: 'f', header: 'Folio', render: (r) => <strong>{folioOf(r)}</strong> }, { key: 'd', header: 'Fecha', render: (r) => fmtDate(r.issuedAt) }, { key: 'k', header: 'Tipo', render: (r) => (r.kind === 'GLOBAL' ? '🌐 Global' : `🧾 Ticket ${r.orders?.map((o: any) => `#${o.number}`).join(', ') ?? ''}`) },
        { key: 'r', header: 'Receptor', render: (r) => <>{r.receptorName}<div className="rb-hint">{r.receptorRfc}</div></> }, { key: 'b', header: 'Sucursal', render: (r) => r.branchName }, { key: 's', header: 'Estado', render: (r) => <><StatusPill s={r.status} />{r.simulated && <div className="rb-hint">simulada</div>}</> }, { key: 't', header: 'Total', numeric: true, render: (r) => formatMoney2(r.total) }]} /></Async>
    {sel && <InvoiceDetail id={sel} onClose={() => setSel(null)} />}
    <FormModal open={!!global} onClose={() => setGlobal(null)} size="sm" title="🌐 Factura global (público en general)" submitLabel="Timbrar global" busy={runGlobal.isPending} onSubmit={() => runGlobal.mutate()}>{global && <>
      <RetroInput label="Día (cerrado) a facturar" type="date" max={yesterday} value={global.date} onChange={(e) => setGlobal({ date: e.target.value || today() })} />
      <span className="rb-hint">Agrupa los tickets pagados de la sucursal activa que nadie facturó ese día. Se emite a PÚBLICO EN GENERAL (XAXX010101000). Los tickets incluidos ya no podrán autofacturarse.</span></>}</FormModal>
  </>;
}
