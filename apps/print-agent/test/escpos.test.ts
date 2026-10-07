import { describe, expect, it } from 'vitest';
import { encodeJob, encodeText, optionsFor } from '../src/escpos';

const hex = (b: Buffer) => b.toString('hex');

describe('ESC/POS', () => {
  it('ASCII pasa tal cual y los saltos de línea son LF', () => {
    expect(hex(encodeText('Hola\nMundo'))).toBe(hex(Buffer.from('Hola\nMundo')));
  });
  it('español → CP858 (á é í ó ú ñ Ñ ¿ ¡ ü € °)', () => {
    expect([...encodeText('áéíóú ñÑ ¿¡ ü € °')]).toEqual([0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0x20, 0xa4, 0xa5, 0x20, 0xa8, 0xad, 0x20, 0x81, 0x20, 0xd5, 0x20, 0xf8]);
    expect([...encodeText('Á É Í Ó Ú')]).toEqual([0xb5, 0x20, 0x90, 0x20, 0xd6, 0x20, 0xe0, 0x20, 0xe9]);
  });
  it('los emoji se descartan, los símbolos tipográficos tienen sustituto ASCII y lo desconocido es "?"', () => {
    expect(encodeText('🍔 Burger 🍟').toString('latin1')).toBe(' Burger ');
    expect(encodeText('•“hola”…').toString('latin1')).toBe('*"hola"...');
    expect(encodeText('大').toString('latin1')).toBe('?');
    expect(encodeText('ő').toString('latin1')).toBe('o');      // acento no soportado → letra base
    expect(encodeText('é').toString('latin1')).toBe(String.fromCharCode(0x82));   // é descompuesta se normaliza
  });
  it('trabajo: reset, página de códigos, texto, avance y corte parcial', () => {
    const b = encodeJob('Total $10.00', { feed: 4 });
    expect(hex(b.subarray(0, 5))).toBe('1b401b7413');
    expect(b.toString('latin1', 5, 18)).toBe('Total $10.00\n');
    expect(hex(b.subarray(b.length - 4))).toBe('1d564200');
    expect(hex(b.subarray(b.length - 7, b.length - 4))).toBe('1b6404');
  });
  it('opciones: doble alto + zumbador (cocina), cajón (caja), sin corte', () => {
    const k = encodeJob('X', { tall: true, beep: true });
    expect(hex(k)).toContain('1d2101'); expect(hex(k)).toContain('1d2100'); expect(hex(k)).toContain('1b420202');
    const c = encodeJob('X', { openDrawer: true, cut: false });
    expect(hex(c)).toContain('1b700019fa'); expect(hex(c)).not.toContain('1d5642');
  });
  it('optionsFor: por tipo de trabajo y configuración de la impresora', () => {
    expect(optionsFor('KITCHEN_TICKET', {})).toMatchObject({ tall: true, beep: false, openDrawer: false, codepage: 19 });
    expect(optionsFor('KITCHEN_TICKET', { beep: true, tallKitchen: false, codepage: 16 })).toMatchObject({ tall: false, beep: true, codepage: 16 });
    expect(optionsFor('RECEIPT', { openDrawer: true })).toMatchObject({ openDrawer: true, tall: false });
    expect(optionsFor('CASH_CLOSE', { openDrawer: true }).openDrawer).toBe(false);
  });
});
