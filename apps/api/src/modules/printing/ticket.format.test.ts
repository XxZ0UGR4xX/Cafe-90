import { describe, expect, it } from 'vitest';
import { center, lr, renderKitchenTicket, renderReceipt, wrap } from './ticket.format';

describe('formato de tickets', () => {
  it('lr alinea izquierda/derecha al ancho exacto', () => expect(lr('Total', '$10.00', 20)).toHaveLength(20));
  it('lr recorta si no cabe', () => expect(lr('Producto larguísimo de prueba', '$10.00', 20).length).toBeLessThanOrEqual(20));
  it('wrap respeta el ancho', () => expect(wrap('una nota bastante larga para una impresora de cocina', 20).every((l) => l.length <= 20)).toBe(true));
  it('center', () => expect(center('AB', 6)).toBe('  AB'));
  it('recibo incluye total y modificadores', () => {
    const t = renderReceipt({ number: 38, createdAt: new Date().toISOString(), channel: 'DINE_IN', tableNumber: 12, subtotal: 248, discountTotal: 0, taxTotal: 34.21, tipTotal: 25, total: 248, payments: [],
      items: [{ id: 'a', qty: 1, name: 'Retro Burger', lineTotal: 129, modifiers: [{ type: 'REMOVE', name: 'Cebolla', priceDelta: 0 }] }], branch: { name: 'CENTRO', restaurant: 'RETROBURGER' } });
    expect(t).toContain('SIN Cebolla'); expect(t).toContain('$273.00'); expect(t).toContain('Orden #0038');
  });
  it('comanda en mayúsculas con modificadores', () => {
    const t = renderKitchenTicket({ stationKey: 'PARRILLA', number: 38, round: 1, tableNumber: 12, createdAt: new Date().toISOString(), items: [{ qty: 2, name: 'Retro Burger', modifiers: ['SIN Cebolla'], notes: 'una bien cocida' }] });
    expect(t).toContain('2 X RETRO BURGER'); expect(t).toContain('SIN Cebolla'); expect(t).toContain('MESA 12');
  });
});
