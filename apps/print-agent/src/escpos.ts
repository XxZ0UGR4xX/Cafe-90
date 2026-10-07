/**
 * Codificador ESC/POS (impresoras térmicas Epson y compatibles). Funciones puras → Buffer.
 * El texto llega en UTF-8 desde la API; las impresoras hablan páginas de códigos de 8 bits, así que se convierte a CP858
 * (Latin-1 + €, la página estándar para español) y se descarta lo no imprimible (emoji, etc.).
 */
const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

/** Unicode → byte CP858 (sólo los caracteres no-ASCII que usa el español y símbolos habituales en tickets). */
const CP858: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d,
  'Ä': 0x8e, 'Å': 0x8f, 'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97, 'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, 'ø': 0x9b,
  '£': 0x9c, 'Ø': 0x9d, '×': 0x9e, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '¿': 0xa8, '®': 0xa9, '¬': 0xaa,
  '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf, 'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, '©': 0xb8, '¢': 0xbd, '¥': 0xbe, 'ã': 0xc6, 'Ã': 0xc7, '¤': 0xcf,
  'Ê': 0xd2, 'Ë': 0xd3, 'È': 0xd4, '€': 0xd5, 'Í': 0xd6, 'Î': 0xd7, 'Ï': 0xd8, '¦': 0xdd, 'Ì': 0xde, 'Ó': 0xe0, 'ß': 0xe1, 'Ô': 0xe2, 'Ò': 0xe3, 'õ': 0xe4,
  'Õ': 0xe5, 'µ': 0xe6, 'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb, 'ý': 0xec, 'Ý': 0xed, '´': 0xef, '±': 0xf1, '¾': 0xf3, '§': 0xf5, '÷': 0xf6, '°': 0xf8, '¨': 0xf9,
  '·': 0xfa, '¹': 0xfb, '³': 0xfc, '²': 0xfd,
};
/** Sustitutos ASCII para símbolos frecuentes que la página no tiene. */
const ASCII_FALLBACK: Record<string, string> = { '•': '*', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '→': '>', '←': '<', '✓': 'v', '✔': 'v', '×': 'x', ' ': ' ', '\t': '  ' };

const isEmojiLike = (cp: number) => (cp >= 0x1f000 && cp <= 0x1ffff) || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d || (cp >= 0x2b00 && cp <= 0x2bff);

export function encodeText(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\n') { out.push(LF); continue; }
    if (ch === '\r') continue;
    if (cp >= 0x20 && cp < 0x7f) { out.push(cp); continue; }
    if (CP858[ch] !== undefined) { out.push(CP858[ch]!); continue; }
    if (isEmojiLike(cp)) continue;
    const fb = ASCII_FALLBACK[ch];
    if (fb !== undefined) { for (const c of fb) out.push(c.charCodeAt(0)); continue; }
    // acento no soportado → letra base (p. ej. ő → o)
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (base !== ch && base.length && base.charCodeAt(0) < 0x7f) { for (const c of base) out.push(c.charCodeAt(0)); continue; }
    if (cp > 0x20 && !/\p{M}/u.test(ch)) out.push(0x3f);   // '?'
  }
  return Buffer.from(out);
}

export interface EncodeOptions {
  /** Número de la página CP858 en la impresora (Epson = 19). Algunas compatibles usan otro; configurable por impresora. */
  codepage?: number;
  /** Líneas en blanco antes del corte. */
  feed?: number;
  cut?: boolean;
  /** Abre el cajón de dinero (pulso en pin 2). */
  openDrawer?: boolean;
  /** Zumbador al imprimir (comandas de cocina). */
  beep?: boolean;
  /** Doble alto: comandas legibles a distancia. */
  tall?: boolean;
}

export function encodeJob(text: string, o: EncodeOptions = {}): Buffer {
  const parts: Buffer[] = [Buffer.from([ESC, 0x40]), Buffer.from([ESC, 0x74, o.codepage ?? 19])];   // ESC @ (reset) · ESC t n (página de códigos)
  if (o.tall) parts.push(Buffer.from([GS, 0x21, 0x01]));                                              // GS ! 1 (doble alto)
  parts.push(encodeText(text.endsWith('\n') ? text : text + '\n'));
  if (o.tall) parts.push(Buffer.from([GS, 0x21, 0x00]));
  parts.push(Buffer.from([ESC, 0x64, Math.min(Math.max(o.feed ?? 3, 0), 10)]));                      // ESC d n (avanzar n líneas)
  if (o.beep) parts.push(Buffer.from([ESC, 0x42, 0x02, 0x02]));                                       // ESC B n t (zumbador)
  if (o.openDrawer) parts.push(Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]));                           // ESC p 0 t1 t2 (cajón)
  if (o.cut !== false) parts.push(Buffer.from([GS, 0x56, 0x42, 0x00]));                               // GS V 66 0 (corte parcial)
  return Buffer.concat(parts);
}

/** Opciones por tipo de trabajo y conexión de la impresora (los booleanos de `connection` mandan). */
export function optionsFor(kind: string, connection: Record<string, unknown>): EncodeOptions {
  const flag = (k: string, d: boolean) => (typeof connection[k] === 'boolean' ? (connection[k] as boolean) : d);
  return {
    codepage: typeof connection.codepage === 'number' ? connection.codepage : 19,
    cut: flag('cut', true),
    tall: kind === 'KITCHEN_TICKET' && flag('tallKitchen', true),
    beep: kind === 'KITCHEN_TICKET' && flag('beep', false),
    openDrawer: kind === 'RECEIPT' && flag('openDrawer', false),
    feed: typeof connection.feed === 'number' ? connection.feed : 3,
  };
}
