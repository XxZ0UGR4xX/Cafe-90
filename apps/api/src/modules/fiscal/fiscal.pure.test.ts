import { describe, expect, it } from 'vitest';
import { computeTotals } from '../sales/pricing';
import {
  isValidRfc, normalizeLegalName, personType, predominantFormaPago, usoCompatible, validateReceptor,
} from './catalogs';
import { type InvoiceDraft, assertConsistent, globalConcepts, splitGross, summarize, toConcepts, toXml } from './cfdi';

describe('catálogos SAT', () => {
  it('valida RFC de persona moral, física y genéricos', () => {
    for (const ok of ['EKU9003173C9', 'URE180429TM6', 'XAXX010101000', 'XEXX010101000', 'GODE561231GR8', 'AAAA800101AB1']) expect(isValidRfc(ok), ok).toBe(true);
    for (const bad of ['', 'ABC', 'EKU900317', 'EKU9013173C9', 'EKU9003323C9', '12345678901', 'EKU9003173C9X']) expect(isValidRfc(bad), bad).toBe(false);
    expect(personType('EKU9003173C9')).toBe('M'); expect(personType('GODE561231GR8')).toBe('F');
  });

  it('quita el régimen societario del nombre (CFDI 4.0) sin mutilar nombres normales', () => {
    expect(normalizeLegalName('Escuela Kemper Urgate')).toBe('ESCUELA KEMPER URGATE');
    expect(normalizeLegalName('Acme Burgers, S.A. de C.V.')).toBe('ACME BURGERS');
    expect(normalizeLegalName('  Foo   Bar S. de R.L. de C.V. ')).toBe('FOO BAR');
    expect(normalizeLegalName('Tacos El Güero SA DE CV')).toBe('TACOS EL GÜERO');
    expect(normalizeLegalName('Mi Casa')).toBe('MI CASA');
    expect(normalizeLegalName('Papelería Sas')).toBe('PAPELERÍA');   // S.A.S. escrito como palabra
    expect(normalizeLegalName('Casa Rural')).toBe('CASA RURAL');
  });

  it('compatibilidad uso CFDI ↔ régimen', () => {
    expect(usoCompatible('G03', '601')).toBe(true);
    expect(usoCompatible('D01', '605')).toBe(true);
    expect(usoCompatible('D01', '601')).toBe(false);   // deducciones personales no aplican a personas morales
    expect(usoCompatible('G03', '616')).toBe(false);   // sin obligaciones: sólo S01
    expect(usoCompatible('S01', '616')).toBe(true);
    expect(usoCompatible('XXX', '601')).toBe(false);
  });

  it('validateReceptor devuelve mensajes claros', () => {
    const ok = { rfc: 'URE180429TM6', legalName: 'UNIVERSIDAD ROBOTICA ESPAÑOLA', regimenFiscal: '601', postalCode: '65000', cfdiUse: 'G03' };
    expect(validateReceptor(ok)).toEqual([]);
    expect(validateReceptor({ ...ok, rfc: 'XAXX010101000' })[0]).toMatch(/global/);
    expect(validateReceptor({ ...ok, regimenFiscal: '605' }).join(' ')).toMatch(/tipo de persona/);
    expect(validateReceptor({ ...ok, postalCode: '123' }).join(' ')).toMatch(/código postal/i);
    expect(validateReceptor({ ...ok, cfdiUse: 'D01' }).join(' ')).toMatch(/compatible/);
  });

  it('forma de pago predominante', () => {
    expect(predominantFormaPago([{ method: 'CASH', amount: 100 }, { method: 'CARD', amount: 300 }])).toBe('04');
    expect(predominantFormaPago([{ method: 'CASH', amount: 100 }, { method: 'TRANSFER', amount: 50 }])).toBe('01');
    expect(predominantFormaPago([])).toBe('99');
  });
});

describe('CFDI: aritmética', () => {
  it('splitGross: IVA = round(base × tasa) y base + IVA ≈ monto cobrado (±1¢) para todo monto', () => {
    for (let g = 1; g <= 60_000; g++) {
      const s = splitGross(g, 0.16);
      expect(s.taxCents, `g=${g}`).toBe(Math.round(s.baseCents * 0.16));
      expect(Math.abs(s.baseCents + s.taxCents - g), `g=${g}`).toBeLessThanOrEqual(1);
    }
    expect(splitGross(11600, 0.16)).toEqual({ baseCents: 10000, taxCents: 1600 });
    expect(splitGross(500, 0)).toEqual({ baseCents: 500, taxCents: 0 });
  });

  // Orden determinista pseudo-aleatoria para pruebas de propiedad
  const rnd = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

  it('para cualquier orden (precios, cantidades, descuentos) el comprobante es consistente y el total difiere ≤ 1¢ de la cuenta (compensación del error de redondeo)', () => {
    const r = rnd(42);
    for (let n = 0; n < 400; n++) {
      const count = 1 + Math.floor(r() * 6);
      const lines = Array.from({ length: count }, (_, i) => {
        const qty = 1 + Math.floor(r() * 4); const unit = Math.round((10 + r() * 300) * 100);
        const included = r() > 0.2; const rate = [0.16, 0.16, 0, 0.08][Math.floor(r() * 4)]!;
        return { id: String(i), qty, lineCents: unit * qty, taxRate: rate, taxIncluded: included };
      });
      const sub = lines.reduce((a, l) => a + l.lineCents, 0);
      const discount = r() > 0.5 ? Math.round(sub * r() * 0.4) : 0;
      const t = computeTotals(lines, discount);
      const concepts = toConcepts(lines.map((l, i) => ({ name: `P${i}`, qty: l.qty, lineCents: l.lineCents, taxRate: l.taxRate, taxIncluded: l.taxIncluded,
        shareCents: l.lineCents - t.lines[i]!.netCents, satProductKey: '90101501', satUnitKey: 'H87', satUnitName: 'Pieza' })));
      const sum = summarize(concepts);
      const draft = { concepts, ...sum } as unknown as InvoiceDraft;
      expect(assertConsistent(draft), JSON.stringify({ lines, discount })).toEqual([]);
      expect(Math.abs(sum.totalCents - t.total), JSON.stringify({ lines, discount, cfdi: sum.totalCents, order: t.total })).toBeLessThanOrEqual(1);
    }
  });

  it('un solo ítem con IVA incluido: caso conocido (2 × $129 = $258 → base 222.41 + IVA 35.59)', () => {
    const t = computeTotals([{ id: 'a', lineCents: 25800, taxRate: 0.16, taxIncluded: true }], 0);
    const c = toConcepts([{ name: 'Retro Burger', qty: 2, lineCents: 25800, taxRate: 0.16, taxIncluded: true, shareCents: 0, satProductKey: '90101501', satUnitKey: 'H87', satUnitName: 'Pieza' }]);
    const s = summarize(c);
    expect(c[0]).toMatchObject({ amountCents: 22241, baseCents: 22241, taxCents: 3559, discountCents: 0, unitValue: '111.205000' });
    expect(s.totalCents).toBe(25800); expect(t.total).toBe(25800);
  });

  it('con descuento: Importe − Descuento = Base y el descuento se reporta por concepto', () => {
    const lines = [{ id: '0', lineCents: 17800, taxRate: 0.16, taxIncluded: true }, { id: '1', lineCents: 4900, taxRate: 0.16, taxIncluded: true }];
    const t = computeTotals(lines, 2270);
    const c = toConcepts(lines.map((l, i) => ({ name: `P${i}`, qty: 1, lineCents: l.lineCents, taxRate: 0.16, taxIncluded: true, shareCents: l.lineCents - t.lines[i]!.netCents, satProductKey: '90101501', satUnitKey: 'H87', satUnitName: 'Pieza' })));
    const s = summarize(c);
    expect(s.discountCents).toBeGreaterThan(1900);
    expect(s.totalCents).toBe(t.total); expect(t.total).toBe(22700 - 2270);
    for (const k of c) expect(k.amountCents - k.discountCents).toBe(k.baseCents);
  });

  it('factura global: un concepto por ticket y tasa, IVA recalculado sobre la base', () => {
    const mk = (g: number) => toConcepts([{ name: 'X', qty: 1, lineCents: g, taxRate: 0.16, taxIncluded: true, shareCents: 0, satProductKey: '90101501', satUnitKey: 'H87', satUnitName: 'Pieza' }]);
    const gc = globalConcepts([{ folio: '#0001', concepts: mk(12900) }, { folio: '#0002', concepts: [...mk(4900), ...toConcepts([{ name: 'Y', qty: 1, lineCents: 1000, taxRate: 0, taxIncluded: true, shareCents: 0, satProductKey: '1', satUnitKey: 'H87', satUnitName: 'Pieza' }])] }]);
    expect(gc).toHaveLength(3);
    expect(gc.every((c) => c.satProductKey === '01010101' && c.satUnitKey === 'ACT')).toBe(true);
    const s = summarize(gc);
    expect(s.totalCents).toBe(12900 + 4900 + 1000);
    expect(assertConsistent({ concepts: gc, ...s } as unknown as InvoiceDraft)).toEqual([]);
    expect(s.transfers.map((t) => t.taxRate)).toEqual([0, 0.16]);
  });

  it('XML: estructura CFDI 4.0, números con 2 decimales y caracteres escapados', () => {
    const c = toConcepts([{ name: 'Hamburguesa "Retro" & Papas <XL>', qty: 2, lineCents: 25800, taxRate: 0.16, taxIncluded: true, shareCents: 0, satProductKey: '90101501', satUnitKey: 'H87', satUnitName: 'Pieza' }]);
    const draft: InvoiceDraft = { version: '4.0', series: 'A', folio: '12', date: '2026-10-06T14:03:11', formaPago: '01', metodoPago: 'PUE', currency: 'MXN', placeOfIssue: '42501',
      issuer: { rfc: 'EKU9003173C9', legalName: 'ESCUELA KEMPER URGATE', regimenFiscal: '601' },
      receptor: { rfc: 'URE180429TM6', legalName: 'UNIVERSIDAD ROBOTICA ESPAÑOLA', regimenFiscal: '601', postalCode: '65000', cfdiUse: 'G03' }, concepts: c, ...summarize(c) };
    const xml = toXml(draft);
    expect(xml).toContain('Version="4.0"'); expect(xml).toContain('SubTotal="222.41"'); expect(xml).toContain('Total="258.00"');
    expect(xml).toContain('TipoDeComprobante="I"'); expect(xml).toContain('Exportacion="01"'); expect(xml).toContain('LugarExpedicion="42501"');
    expect(xml).toContain('TotalImpuestosTrasladados="35.59"'); expect(xml).toContain('TasaOCuota="0.160000"'); expect(xml).toContain('ObjetoImp="02"');
    expect(xml).toContain('Descripcion="Hamburguesa &quot;Retro&quot; &amp; Papas &lt;XL&gt;"');
    expect(xml).not.toContain('Descuento='); expect(xml).not.toContain('InformacionGlobal');
    // etiquetas balanceadas
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)(cfdi:\w+)([^>]*?)(\/?)>/g)) {
      if (m[4] === '/') continue; if (m[1]) expect(stack.pop()).toBe(m[2]); else stack.push(m[2]!);
    }
    expect(stack).toEqual([]);
    const g = toXml({ ...draft, global: { periodicity: '01', months: '10', year: 2026 } });
    expect(g).toContain('<cfdi:InformacionGlobal Periodicidad="01" Meses="10" Año="2026"/>');
  });
});
