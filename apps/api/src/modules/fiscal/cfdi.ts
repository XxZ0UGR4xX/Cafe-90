/**
 * Construcción de CFDI 4.0 (tipo Ingreso). Funciones puras, en CENTAVOS enteros, sin BD ni red.
 *
 * Reglas aplicadas (Anexo 20 / guía de llenado):
 *  - Por concepto: Importe = base + descuento (antes de descuento e impuestos); Descuento aparte; Base del traslado = Importe − Descuento.
 *  - Traslado por concepto = round(Base × tasa). Los precios con IVA incluido se desglosan buscando la base cuyo total (base + IVA)
 *    más se acerque al monto cobrado, para que el timbre pase la validación de redondeo del SAT.
 *  - SubTotal = Σ Importe; Total = SubTotal − Descuento + Σ traslados. Las propinas NO forman parte del CFDI.
 */
import { PUBLIC_GENERAL_NAME, GENERIC_RFC_NATIONAL, type ReceptorInput, normalizeRfc } from './catalogs';

export interface SourceLine { name: string; qty: number; lineCents: number; taxRate: number; taxIncluded: boolean; satProductKey: string; satUnitKey: string; satUnitName: string }
export interface Concept {
  satProductKey: string; satUnitKey: string; unitName: string; description: string; qty: number;
  unitValue: string; amountCents: number; discountCents: number; baseCents: number; taxRate: number; taxCents: number;
}
export interface Issuer { rfc: string; legalName: string; regimenFiscal: string }
export interface InvoiceDraft {
  version: '4.0'; series: string; folio: string; date: string; formaPago: string; metodoPago: 'PUE';
  currency: 'MXN'; placeOfIssue: string; issuer: Issuer; receptor: ReceptorInput & { legalName: string };
  global?: { periodicity: string; months: string; year: number };
  concepts: Concept[]; subtotalCents: number; discountCents: number;
  transfers: { taxRate: number; baseCents: number; taxCents: number }[];
  taxCents: number; totalCents: number;
}

const f2 = (c: number) => (c / 100).toFixed(2);
const f6 = (r: number) => r.toFixed(6);
export const money2 = f2;

/** Divide un monto bruto (con IVA incluido) en base + IVA, de modo que IVA = round(base × tasa) y base + IVA ≈ bruto. */
export function splitGross(grossCents: number, rate: number): { baseCents: number; taxCents: number } {
  if (rate === 0) return { baseCents: grossCents, taxCents: 0 };
  const b0 = Math.round(grossCents / (1 + rate));
  let best = { baseCents: b0, taxCents: Math.round(b0 * rate) };
  for (const b of [b0 - 1, b0, b0 + 1]) {
    const t = Math.round(b * rate);
    if (Math.abs(b + t - grossCents) < Math.abs(best.baseCents + best.taxCents - grossCents)) best = { baseCents: b, taxCents: t };
  }
  return best;
}

/**
 * Convierte las líneas de una orden (con el descuento YA prorrateado por línea) en conceptos CFDI.
 * `shareCents` es la parte del descuento de esa línea. Como no todo monto con IVA incluido es representable
 * (base + round(base × tasa) salta algunos centavos), se arrastra el error acumulado y cada línea elige la base que lo
 * compensa: el total del CFDI coincide con lo cobrado (a lo más 1¢ de diferencia por paridad) y cada traslado cumple la regla del SAT.
 */
export function toConcepts(lines: (SourceLine & { shareCents: number })[]): Concept[] {
  const out: Concept[] = [];
  let carry = 0; // Σ (total CFDI − cobrado) de las líneas ya convertidas
  for (const l of lines) {
    if (l.lineCents <= 0) continue;
    const eff = Math.max(l.lineCents - l.shareCents, 0);
    let net: { baseCents: number; taxCents: number };
    if (l.taxIncluded && l.taxRate > 0) {
      const b0 = Math.round(eff / (1 + l.taxRate)); let best: { baseCents: number; taxCents: number; dev: number } | null = null;
      for (let b = b0 - 2; b <= b0 + 2; b++) {
        if (b < 0) continue;
        const t = Math.round(b * l.taxRate); const dev = b + t - eff;
        if (!best || Math.abs(carry + dev) < Math.abs(carry + best.dev) || (Math.abs(carry + dev) === Math.abs(carry + best.dev) && Math.abs(dev) < Math.abs(best.dev))) best = { baseCents: b, taxCents: t, dev };
      }
      net = best!; carry += best!.dev;
    } else if (l.taxIncluded) net = { baseCents: eff, taxCents: 0 };
    else net = { baseCents: eff, taxCents: Math.round(eff * l.taxRate) };
    const gross = l.taxIncluded ? splitGross(l.lineCents, l.taxRate) : { baseCents: l.lineCents, taxCents: 0 };
    const discount = Math.max(gross.baseCents - net.baseCents, 0);
    const amount = net.baseCents + discount;
    out.push({
      satProductKey: l.satProductKey, satUnitKey: l.satUnitKey, unitName: l.satUnitName, description: l.name, qty: l.qty,
      unitValue: (amount / 100 / l.qty).toFixed(6), amountCents: amount, discountCents: discount, baseCents: net.baseCents, taxRate: l.taxRate, taxCents: net.taxCents,
    });
  }
  return out;
}

/** Cargo de envío como línea (IVA incluido a la tasa indicada). */
export const deliveryLine = (feeCents: number, rate: number): (SourceLine & { shareCents: number }) | null => feeCents <= 0 ? null : ({
  name: 'Servicio de envío a domicilio', qty: 1, lineCents: feeCents, taxRate: rate, taxIncluded: true, shareCents: 0,
  satProductKey: '78102203', satUnitKey: 'E48', satUnitName: 'Unidad de servicio' });

export function summarize(concepts: Concept[]) {
  const subtotalCents = concepts.reduce((a, c) => a + c.amountCents, 0);
  const discountCents = concepts.reduce((a, c) => a + c.discountCents, 0);
  const by = new Map<number, { taxRate: number; baseCents: number; taxCents: number }>();
  for (const c of concepts) {
    const t = by.get(c.taxRate) ?? { taxRate: c.taxRate, baseCents: 0, taxCents: 0 };
    t.baseCents += c.baseCents; t.taxCents += c.taxCents; by.set(c.taxRate, t);
  }
  const transfers = [...by.values()].sort((a, b) => a.taxRate - b.taxRate);
  const taxCents = transfers.reduce((a, t) => a + t.taxCents, 0);
  return { subtotalCents, discountCents, transfers, taxCents, totalCents: subtotalCents - discountCents + taxCents };
}

/**
 * Factura global: un concepto "Venta" por ticket y tasa de IVA. El IVA se recalcula sobre la base agregada
 * (round(base × tasa)) para cumplir la validación del SAT; puede diferir por centavos del suma de líneas.
 */
export function globalConcepts(orders: { folio: string; concepts: Concept[] }[]): Concept[] {
  const out: Concept[] = [];
  for (const o of orders) {
    const byRate = new Map<number, number>();
    for (const c of o.concepts) byRate.set(c.taxRate, (byRate.get(c.taxRate) ?? 0) + c.baseCents);
    for (const [rate, base] of byRate) {
      if (base <= 0) continue;
      out.push({ satProductKey: '01010101', satUnitKey: 'ACT', unitName: 'Actividad', description: `Venta ${o.folio}`, qty: 1,
        unitValue: (base / 100).toFixed(6), amountCents: base, discountCents: 0, baseCents: base, taxRate: rate, taxCents: Math.round(base * rate) });
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const attrs = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${esc(String(v))}"`).join(' ');

/** XML CFDI 4.0 SIN sello (el PAC sella con el CSD del emisor y timbra). */
export function toXml(d: InvoiceDraft): string {
  const taxCode = '002'; // IVA
  const concepts = d.concepts.map((c) => `    <cfdi:Concepto ${attrs({
    ClaveProdServ: c.satProductKey, Cantidad: String(c.qty), ClaveUnidad: c.satUnitKey, Unidad: c.unitName, Descripcion: c.description,
    ValorUnitario: c.unitValue, Importe: f2(c.amountCents), Descuento: c.discountCents > 0 ? f2(c.discountCents) : undefined, ObjetoImp: '02' })}>
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado ${attrs({ Base: f2(c.baseCents), Impuesto: taxCode, TipoFactor: 'Tasa', TasaOCuota: f6(c.taxRate), Importe: f2(c.taxCents) })}/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>`).join('\n');
  const transfers = d.transfers.map((t) => `      <cfdi:Traslado ${attrs({ Base: f2(t.baseCents), Impuesto: taxCode, TipoFactor: 'Tasa', TasaOCuota: f6(t.taxRate), Importe: f2(t.taxCents) })}/>`).join('\n');
  const root = attrs({
    'xmlns:cfdi': 'http://www.sat.gob.mx/cfd/4', 'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation': 'http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd',
    Version: d.version, Serie: d.series, Folio: d.folio, Fecha: d.date, FormaPago: d.formaPago, SubTotal: f2(d.subtotalCents),
    Descuento: d.discountCents > 0 ? f2(d.discountCents) : undefined, Moneda: d.currency, Total: f2(d.totalCents), TipoDeComprobante: 'I',
    Exportacion: '01', MetodoPago: d.metodoPago, LugarExpedicion: d.placeOfIssue });
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante ${root}>
${d.global ? `  <cfdi:InformacionGlobal ${attrs({ Periodicidad: d.global.periodicity, Meses: d.global.months, 'Año': String(d.global.year) })}/>\n` : ''}  <cfdi:Emisor ${attrs({ Rfc: d.issuer.rfc, Nombre: d.issuer.legalName, RegimenFiscal: d.issuer.regimenFiscal })}/>
  <cfdi:Receptor ${attrs({ Rfc: d.receptor.rfc, Nombre: d.receptor.legalName, DomicilioFiscalReceptor: d.receptor.postalCode, RegimenFiscalReceptor: d.receptor.regimenFiscal, UsoCFDI: d.receptor.cfdiUse })}/>
  <cfdi:Conceptos>
${concepts}
  </cfdi:Conceptos>
  <cfdi:Impuestos ${attrs({ TotalImpuestosTrasladados: f2(d.taxCents) })}>
    <cfdi:Traslados>
${transfers}
    </cfdi:Traslados>
  </cfdi:Impuestos>
</cfdi:Comprobante>`;
}

/** Receptor genérico para factura global (CFDI 4.0: nombre y régimen fijos; CP = lugar de expedición). */
export const publicGeneralReceptor = (postalCode: string): ReceptorInput => ({
  rfc: GENERIC_RFC_NATIONAL, legalName: PUBLIC_GENERAL_NAME, regimenFiscal: '616', postalCode, cfdiUse: 'S01' });

/** Verificaciones de consistencia aritmética antes de enviar al PAC (red de seguridad: nunca timbrar números incoherentes). */
export function assertConsistent(d: InvoiceDraft): string[] {
  const errs: string[] = []; const s = summarize(d.concepts);
  if (s.subtotalCents !== d.subtotalCents) errs.push('SubTotal no coincide con la suma de conceptos');
  if (s.totalCents !== d.totalCents) errs.push('Total no coincide');
  if (d.totalCents <= 0) errs.push('El total debe ser mayor a cero');
  for (const c of d.concepts) {
    if (c.amountCents - c.discountCents !== c.baseCents) errs.push(`Base ≠ Importe − Descuento en «${c.description}»`);
    if (Math.abs(c.taxCents - Math.round(c.baseCents * c.taxRate)) > 0) errs.push(`IVA mal redondeado en «${c.description}»`);
    if (Math.abs(Math.round(Number(c.unitValue) * c.qty * 100) - c.amountCents) > 1) errs.push(`ValorUnitario × Cantidad ≠ Importe en «${c.description}»`);
  }
  return errs;
}
export { normalizeRfc };
