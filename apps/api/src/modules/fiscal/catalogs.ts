/**
 * Catálogos y validadores SAT para CFDI 4.0 (subconjunto relevante para restaurantes).
 * El PAC hace la validación final contra los catálogos completos; aquí se atrapan los errores comunes ANTES de timbrar.
 */
export const GENERIC_RFC_NATIONAL = 'XAXX010101000';
export const GENERIC_RFC_FOREIGN = 'XEXX010101000';
export const PUBLIC_GENERAL_NAME = 'PUBLICO EN GENERAL';

const RFC_RE = /^[A-ZÑ&]{3,4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z0-9]{3}$/;
export const normalizeRfc = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');
export const isValidRfc = (rfc: string) => RFC_RE.test(normalizeRfc(rfc));
export const isGenericRfc = (rfc: string) => [GENERIC_RFC_NATIONAL, GENERIC_RFC_FOREIGN].includes(normalizeRfc(rfc));
/** 13 caracteres = persona física; 12 = persona moral. */
export const personType = (rfc: string): 'F' | 'M' => (normalizeRfc(rfc).length === 13 ? 'F' : 'M');
export const isValidPostalCode = (cp: string) => /^\d{5}$/.test(cp);

/** c_RegimenFiscal: clave → [descripción, tipos de persona permitidos]. */
export const REGIMENES: Record<string, [string, ('F' | 'M')[]]> = {
  '601': ['General de Ley Personas Morales', ['M']],
  '603': ['Personas Morales con Fines no Lucrativos', ['M']],
  '605': ['Sueldos y Salarios e Ingresos Asimilados a Salarios', ['F']],
  '606': ['Arrendamiento', ['F']],
  '607': ['Régimen de Enajenación o Adquisición de Bienes', ['F']],
  '608': ['Demás ingresos', ['F']],
  '609': ['Consolidación', ['M']],
  '610': ['Residentes en el Extranjero sin Establecimiento Permanente en México', ['F', 'M']],
  '611': ['Ingresos por Dividendos (socios y accionistas)', ['F']],
  '612': ['Personas Físicas con Actividades Empresariales y Profesionales', ['F']],
  '614': ['Ingresos por intereses', ['F']],
  '615': ['Régimen de los ingresos por obtención de premios', ['F']],
  '616': ['Sin obligaciones fiscales', ['F']],
  '620': ['Sociedades Cooperativas de Producción que optan por diferir sus ingresos', ['M']],
  '621': ['Incorporación Fiscal', ['F']],
  '622': ['Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras', ['F', 'M']],
  '623': ['Opcional para Grupos de Sociedades', ['M']],
  '624': ['Coordinados', ['M']],
  '625': ['Actividades Empresariales con ingresos a través de Plataformas Tecnológicas', ['F']],
  '626': ['Régimen Simplificado de Confianza', ['F', 'M']],
};
/** Regímenes con los que un restaurante puede EMITIR (actividad empresarial). */
export const EMITTER_REGIMENES = ['601', '603', '612', '621', '622', '624', '625', '626'];

/** c_UsoCFDI (4.0). `D*` (deducciones personales) sólo aplica a personas físicas. */
export const USOS_CFDI: Record<string, string> = {
  G01: 'Adquisición de mercancías', G02: 'Devoluciones, descuentos o bonificaciones', G03: 'Gastos en general',
  I01: 'Construcciones', I02: 'Mobiliario y equipo de oficina por inversiones', I03: 'Equipo de transporte',
  I04: 'Equipo de cómputo y accesorios', I05: 'Dados, troqueles, moldes, matrices y herramental',
  I06: 'Comunicaciones telefónicas', I07: 'Comunicaciones satelitales', I08: 'Otra maquinaria y equipo',
  D01: 'Honorarios médicos, dentales y gastos hospitalarios', D02: 'Gastos médicos por incapacidad o discapacidad',
  D03: 'Gastos funerales', D04: 'Donativos', D05: 'Intereses reales por créditos hipotecarios',
  D06: 'Aportaciones voluntarias al SAR', D07: 'Primas por seguros de gastos médicos', D08: 'Gastos de transportación escolar obligatoria',
  D09: 'Depósitos en cuentas para el ahorro, planes de pensiones', D10: 'Pagos por servicios educativos (colegiaturas)',
  S01: 'Sin efectos fiscales', CP01: 'Pagos',
};

/** ¿Es compatible el uso de CFDI con el régimen del receptor? (regla práctica del Anexo 20; el PAC valida el catálogo completo) */
export function usoCompatible(uso: string, regimen: string): boolean {
  if (!USOS_CFDI[uso] || !REGIMENES[regimen]) return false;
  if (uso === 'CP01') return true;
  if (regimen === '616') return uso === 'S01';
  if (uso === 'S01') return true;
  const onlyF = uso.startsWith('D');
  if (onlyF) return REGIMENES[regimen]![1].includes('F') && !REGIMENES[regimen]![1].includes('M');
  return true;
}

/** c_FormaPago */
export const FORMA_PAGO: Record<string, string> = { '01': 'Efectivo', '03': 'Transferencia electrónica de fondos', '04': 'Tarjeta de crédito', '28': 'Tarjeta de débito', '31': 'Intermediario pagos', '99': 'Por definir' };
export const METHOD_TO_FORMA_PAGO: Record<string, string> = { CASH: '01', CARD: '04', TRANSFER: '03', QR: '31' };

/** Forma de pago predominante (por monto) de los pagos de una orden o conjunto de órdenes. */
export function predominantFormaPago(payments: { method: string; amount: number }[]): string {
  const by = new Map<string, number>();
  for (const p of payments) by.set(p.method, (by.get(p.method) ?? 0) + p.amount);
  const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? (METHOD_TO_FORMA_PAGO[top[0]] ?? '99') : '99';
}

/** c_MotivoCancelacion */
export const MOTIVOS_CANCELACION: Record<string, string> = {
  '01': 'Comprobante emitido con errores con relación', '02': 'Comprobante emitido con errores sin relación',
  '03': 'No se llevó a cabo la operación', '04': 'Operación nominativa relacionada en una factura global',
};

/**
 * CFDI 4.0 exige el nombre/razón social del receptor TAL COMO aparece en su constancia de situación fiscal,
 * SIN el régimen societario (S.A. de C.V., S. de R.L. de C.V., etc.) y en mayúsculas.
 */
const SOCIETY_SUFFIX = /[\s,]+(S\.?\s?A\.?\s?P\.?\s?I\.?\s?(DE\s+)?(C\.?\s?V\.?)?|S\.?\s?A\.?\s?B\.?\s?(DE\s+)?C\.?\s?V\.?|S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?\s?(DE\s+)?C\.?\s?V\.?|S\.?\s?(DE\s+)?R\.?\s?L\.?\s?(DE\s+)?(C\.?\s?V\.?|M\.?\s?I\.?)?|S\.?\s?(EN\s+)?C\.?(\s?(POR\s+)?A\.?)?|S\.?\s?A\.?|A\.?\s?C\.?|S\.?\s?C\.?)\.?\s*$/i;
export function normalizeLegalName(name: string): string {
  let n = name.trim().replace(/\s+/g, ' ').toUpperCase();
  for (let i = 0; i < 2; i++) n = n.replace(SOCIETY_SUFFIX, '').trim();
  return n.replace(/[,.]+$/, '').trim();
}

export interface ReceptorInput { rfc: string; legalName: string; regimenFiscal: string; postalCode: string; cfdiUse: string }
/** Devuelve la lista de problemas (vacía si es válido). Mensajes pensados para mostrarse al usuario. */
export function validateReceptor(r: ReceptorInput): string[] {
  const errs: string[] = []; const rfc = normalizeRfc(r.rfc);
  if (!isValidRfc(rfc)) errs.push('El RFC no tiene un formato válido.');
  if (isGenericRfc(rfc)) errs.push('Para facturar a un RFC genérico se usa la factura global.');
  if (!r.legalName.trim()) errs.push('Falta el nombre o razón social (tal como aparece en la constancia fiscal).');
  if (!REGIMENES[r.regimenFiscal]) errs.push('El régimen fiscal no es válido.');
  else if (isValidRfc(rfc) && !REGIMENES[r.regimenFiscal]![1].includes(personType(rfc))) errs.push('El régimen fiscal no corresponde al tipo de persona del RFC.');
  if (!isValidPostalCode(r.postalCode)) errs.push('El código postal fiscal debe tener 5 dígitos.');
  if (!USOS_CFDI[r.cfdiUse]) errs.push('El uso de CFDI no es válido.');
  else if (REGIMENES[r.regimenFiscal] && !usoCompatible(r.cfdiUse, r.regimenFiscal)) errs.push('El uso de CFDI no es compatible con el régimen fiscal del receptor.');
  return errs;
}
