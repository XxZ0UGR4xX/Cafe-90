import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, canTransition, ORDER_TRANSITIONS, inventoryStatus, splitCents, toCents,
} from './index';

describe('permisos por rol', () => {
  it('mesero no ve costos ni utilidad ni puede cancelar', () => {
    const p = DEFAULT_ROLE_PERMISSIONS.MESERO;
    expect(p).toContain('sales.order.create');
    expect(p).not.toContain('catalog.cost.read');
    expect(p).not.toContain('reports.profit.read');
    expect(p).not.toContain('sales.order.cancel');
  });
  it('gerente tiene inventario, caja, reportes y cancelaciones', () => {
    const p = DEFAULT_ROLE_PERMISSIONS.GERENTE;
    for (const k of ['inventory.stock.read', 'cash.shift.operate', 'reports.sales.read', 'sales.order.cancel'])
      expect(p).toContain(k);
    expect(p).not.toContain('identity.role.write');
  });
  it('super admin lo tiene todo', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN.length).toBe(PERMISSIONS.length);
  });
  it('todos los permisos de roles existen en el catálogo y no hay duplicados', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const list of Object.values(DEFAULT_ROLE_PERMISSIONS))
      for (const p of list) expect(PERMISSIONS).toContain(p);
  });
});

describe('estados y dinero', () => {
  it('transiciones de orden', () => {
    expect(canTransition(ORDER_TRANSITIONS, 'DRAFT', 'CONFIRMED')).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, 'COMPLETED', 'CANCELLED')).toBe(false);
  });
  it('estado de inventario', () => {
    expect(inventoryStatus(0, 10)).toBe('OUT_OF_STOCK');
    expect(inventoryStatus(4, 10)).toBe('CRITICAL');
    expect(inventoryStatus(9, 10)).toBe('LOW');
    expect(inventoryStatus(30, 10)).toBe('AVAILABLE');
  });
  it('dividir cuenta no pierde centavos', () => {
    const parts = splitCents(toCents(100), 3);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
  });
});
