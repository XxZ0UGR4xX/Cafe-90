import { z } from 'zod';

/** Facturación electrónica México (CFDI 4.0). Validación estructural aquí; reglas SAT en la API (catalogs.ts). */
const rfc = z.string().trim().min(12).max(13).regex(/^[A-Za-zÑñ&]{3,4}\d{6}[A-Za-z0-9]{3}$/, 'RFC inválido');
const postal = z.string().regex(/^\d{5}$/, 'Código postal de 5 dígitos');

export const FiscalProfileDto = z.object({
  rfc, legalName: z.string().trim().min(2).max(250), regimenFiscal: z.string().regex(/^\d{3}$/), postalCode: postal,
  series: z.string().regex(/^[A-Za-z0-9]{1,10}$/).default('A'), enabled: z.boolean().default(true),
});

export const ReceptorDto = z.object({
  rfc, legalName: z.string().trim().min(2).max(250), regimenFiscal: z.string().regex(/^\d{3}$/), postalCode: postal,
  cfdiUse: z.string().regex(/^[A-Z]{1,2}\d{2}$/), email: z.string().email().max(200).optional(),
});
export const CustomerFiscalDto = ReceptorDto;

export const IssueInvoiceDto = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().uuid().optional(),          // usa sus datos fiscales guardados
  receptor: ReceptorDto.optional(),                  // o datos explícitos
  saveToCustomer: z.boolean().default(false),
}).refine((v) => v.customerId || v.receptor, { message: 'Indica el cliente o los datos fiscales' });

export const CancelInvoiceDto = z.object({
  motive: z.enum(['01', '02', '03', '04']),
  replacementUuid: z.string().uuid().optional(),
}).refine((v) => v.motive !== '01' || !!v.replacementUuid, { message: 'El motivo 01 requiere el UUID del comprobante que sustituye', path: ['replacementUuid'] });

export const GlobalInvoiceDto = z.object({ branchId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export const InvoiceListQueryDto = z.object({
  branchId: z.string().uuid().optional(), status: z.enum(['PENDING', 'STAMPED', 'CANCEL_PENDING', 'CANCELLED', 'ERROR']).optional(),
  orderId: z.string().uuid().optional(), q: z.string().max(60).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
});

/** Receptor desde el sitio público (autofactura): el código del ticket identifica la orden. */
export const PublicInvoiceDto = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9]{12}$/), receptor: ReceptorDto });
export const PublicInvoiceLookupDto = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9]{12}$/) });

export type FiscalProfile = z.infer<typeof FiscalProfileDto>;
export type Receptor = z.infer<typeof ReceptorDto>;
