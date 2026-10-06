import type { InvoiceDraft } from '../cfdi';

export interface StampResult {
  uuid: string; stampedAt: string; xml: string;
  satCertificate: string; satSeal: string; providerRef?: string;
}
export interface CancelResult { status: 'CANCELLED' | 'CANCEL_PENDING'; acuse?: string }

/**
 * Contrato con un PAC (Proveedor Autorizado de Certificación). El PAC sella con el CSD del emisor y timbra.
 *  - `stamp` DEBE ser idempotente por `reference` (id interno de la factura): reintentar tras un timeout no puede duplicar el timbre.
 *  - `cancel` puede dejar la factura en CANCEL_PENDING cuando el receptor debe aceptar la cancelación.
 */
export interface FiscalProvider {
  readonly key: string;
  /** true = no tiene validez fiscal (pruebas). La UI lo marca claramente. */
  readonly simulated: boolean;
  stamp(draft: InvoiceDraft, xml: string, reference: string): Promise<StampResult>;
  cancel(a: { uuid: string; issuerRfc: string; motive: string; replacementUuid?: string }): Promise<CancelResult>;
}
