/**
 * Catálogo ÚNICO de permisos (fuente de verdad para API y UI).
 * Formato: `modulo.recurso.accion`. Un test verifica que todo endpoint declare un permiso.
 */
export const PERMISSIONS = [
  // Plataforma
  'tenancy.branch.read', 'tenancy.branch.write',
  'tenancy.settings.read', 'tenancy.settings.write',
  'identity.user.read', 'identity.user.write',
  'identity.role.read', 'identity.role.write',
  'staff.employee.read', 'staff.employee.write', 'staff.salary.read',
  'audit.log.read',
  // Catálogo
  'catalog.product.read', 'catalog.product.write', 'catalog.cost.read',
  'catalog.recipe.read', 'catalog.recipe.write',
  // Inventario / compras
  'inventory.stock.read', 'inventory.movement.write', 'inventory.waste.write',
  'inventory.count.write', 'inventory.transfer.read', 'inventory.transfer.write',
  'inventory.transfer.approve', 'inventory.cost.read',
  'purchasing.supplier.read', 'purchasing.supplier.write',
  'purchasing.order.read', 'purchasing.order.write', 'purchasing.order.approve', 'purchasing.receive.write',
  // Ventas / piso / cocina / caja
  'floor.table.read', 'floor.table.write', 'floor.table.operate',
  'floor.reservation.read', 'floor.reservation.write',
  'sales.order.read', 'sales.order.readAll', 'sales.order.create', 'sales.order.update',
  'sales.order.pay', 'sales.order.cancel', 'sales.order.refund', 'sales.discount.apply', 'sales.discount.override',
  'kitchen.ticket.read', 'kitchen.ticket.update', 'kitchen.metrics.read',
  'cash.shift.operate', 'cash.shift.readAll', 'cash.movement.write', 'cash.shift.approve',
  // CRM / lealtad / promos / delivery
  'crm.customer.read', 'crm.customer.write',
  'loyalty.rule.read', 'loyalty.rule.write', 'loyalty.redeem',
  'promotions.promotion.read', 'promotions.promotion.write',
  'delivery.order.read', 'delivery.order.write', 'delivery.order.own',
  // Reportes
  'reports.sales.read', 'reports.profit.read', 'reports.inventory.read', 'reports.operations.read',
  'reports.corporate.read', 'reports.export',
  // Ajustes operativos
  'printing.manage', 'notifications.read', 'notifications.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = [
  'SUPER_ADMIN', 'ADMIN', 'GERENTE', 'CAJERO', 'MESERO', 'COCINERO', 'ALMACEN', 'REPARTIDOR',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const has = (p: string, ...prefixes: string[]) => prefixes.some((x) => p === x || p.startsWith(x));
const all = [...PERMISSIONS] as Permission[];
const pick = (fn: (p: Permission) => boolean) => all.filter(fn);

const NO_COSTS = (p: Permission) => !/(\.cost\.|salary|profit)/.test(p);

/** Permisos por defecto de cada rol del sistema (matriz §8 de ARCHITECTURE.md). */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  SUPER_ADMIN: all,
  ADMIN: all,
  GERENTE: pick(
    (p) =>
      !has(p, 'identity.role.write', 'tenancy.branch.write', 'reports.corporate') && p !== 'staff.salary.read',
  ),
  CAJERO: [
    'floor.table.read', 'floor.table.operate', 'floor.reservation.read',
    'sales.order.read', 'sales.order.readAll', 'sales.order.create', 'sales.order.update', 'sales.order.pay',
    'sales.discount.apply', 'cash.shift.operate', 'cash.movement.write',
    'crm.customer.read', 'crm.customer.write', 'catalog.product.read', 'delivery.order.read', 'delivery.order.write',
    'loyalty.redeem', 'promotions.promotion.read', 'notifications.read', 'kitchen.ticket.read',
  ],
  MESERO: [
    'floor.table.read', 'floor.table.operate', 'floor.reservation.read', 'floor.reservation.write',
    'sales.order.read', 'sales.order.create', 'sales.order.update', 'kitchen.ticket.read',
    'catalog.product.read', 'crm.customer.read', 'promotions.promotion.read', 'notifications.read',
  ],
  COCINERO: ['kitchen.ticket.read', 'kitchen.ticket.update', 'kitchen.metrics.read', 'catalog.product.read',
    'catalog.recipe.read', 'inventory.stock.read', 'notifications.read'],
  ALMACEN: pick(
    (p) =>
      (has(p, 'inventory.', 'purchasing.') && p !== 'inventory.transfer.approve' && p !== 'purchasing.order.approve') ||
      p === 'catalog.product.read' || p === 'reports.inventory.read' || p === 'notifications.read',
  ),
  REPARTIDOR: ['delivery.order.own', 'notifications.read'],
};

// Garantía de diseño: roles operativos nunca ven costos/utilidad.
for (const r of ['CAJERO', 'MESERO', 'COCINERO', 'REPARTIDOR'] as RoleKey[]) {
  DEFAULT_ROLE_PERMISSIONS[r] = DEFAULT_ROLE_PERMISSIONS[r].filter(NO_COSTS);
}

/** Roles con alcance corporativo (todas las sucursales por defecto). */
export const CORPORATE_ROLES: RoleKey[] = ['SUPER_ADMIN', 'ADMIN'];

/** Roles que requieren 2FA TOTP (documentado; activación en fase de hardening). */
export const MFA_REQUIRED_ROLES: RoleKey[] = ['SUPER_ADMIN', 'ADMIN'];

export const ROLE_LABELS: Record<RoleKey, string> = {
  SUPER_ADMIN: 'Super administrador', ADMIN: 'Administrador', GERENTE: 'Gerente', CAJERO: 'Cajero',
  MESERO: 'Mesero', COCINERO: 'Cocinero', ALMACEN: 'Almacén', REPARTIDOR: 'Repartidor',
};
