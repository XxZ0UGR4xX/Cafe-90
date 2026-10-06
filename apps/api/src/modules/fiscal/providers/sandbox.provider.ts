import { createHash, randomUUID } from 'node:crypto';
import type { InvoiceDraft } from '../cfdi';
import type { CancelResult, FiscalProvider, StampResult } from './provider';

/**
 * Proveedor SIMULADO: no contacta al SAT ni a ningún PAC. Genera un UUID y un timbre falsos para desarrollar y probar el flujo completo.
 * Los comprobantes llevan una marca explícita y NO tienen validez fiscal. Es idempotente por `reference`.
 */
export class SandboxProvider implements FiscalProvider {
  readonly key = 'SANDBOX';
  readonly simulated = true;
  private readonly seen = new Map<string, StampResult>();

  async stamp(draft: InvoiceDraft, xml: string, reference: string): Promise<StampResult> {
    const prev = this.seen.get(reference); if (prev) return prev;
    const uuid = randomUUID().toUpperCase();
    const stampedAt = draft.date;
    const seal = createHash('sha256').update(`${uuid}|${xml}`).digest('base64');
    const complement = `  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${uuid}" FechaTimbrado="${stampedAt}" RfcProvCertif="SIM010101AAA" SelloCFD="${seal}" NoCertificadoSAT="00000000000000000000" SelloSAT="${seal}"/>
  </cfdi:Complemento>
`;
    const stamped = '<!-- SIMULADO: este comprobante NO tiene validez fiscal -->\n' + xml.replace('</cfdi:Comprobante>', `${complement}</cfdi:Comprobante>`)
      .replace('<cfdi:Comprobante ', '<cfdi:Comprobante NoCertificado="00000000000000000000" Certificado="SIMULADO" Sello="SIMULADO" ');
    const r: StampResult = { uuid, stampedAt, xml: stamped, satCertificate: '00000000000000000000', satSeal: seal, providerRef: `sandbox:${reference}` };
    this.seen.set(reference, r);
    return r;
  }

  async cancel(a: { motive: string; replacementUuid?: string }): Promise<CancelResult> {
    if (a.motive === '01' && !a.replacementUuid) throw new Error('El motivo 01 requiere el UUID del comprobante que sustituye');
    return { status: 'CANCELLED', acuse: `<Acuse simulado="true" motivo="${a.motive}"/>` };
  }
}
