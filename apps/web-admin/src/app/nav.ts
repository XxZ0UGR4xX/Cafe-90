import type { NavEntry } from '@retroburger/ui';

export interface RouteDef { path: string; icon: string; label: string; title: string; perms?: string[]; anyOf?: string[]; corporateOnly?: boolean }
/** Definición única de navegación. El menú se genera desde permisos (nunca por nombre de rol). */
export const ROUTES: RouteDef[] = [
  { path: '/', icon: '🏠', label: 'Dashboard', title: 'Dashboard' },
  { path: '/branches', icon: '🏪', label: 'Sucursales', title: 'Sucursales', anyOf: ['reports.corporate.read'] },
  { path: '/pos', icon: '🍔', label: 'POS', title: 'Punto de venta', perms: ['sales.order.create'] },
  { path: '/tables', icon: '🪑', label: 'Mesas', title: 'Mesas', perms: ['floor.table.read'] },
  { path: '/orders', icon: '🧾', label: 'Pedidos', title: 'Pedidos', perms: ['sales.order.read'] },
  { path: '/kitchen', icon: '👨‍🍳', label: 'Cocina', title: 'Cocina · KDS', perms: ['kitchen.ticket.read'] },
  { path: '/delivery', icon: '🛵', label: 'Delivery', title: 'Pedidos a domicilio', anyOf: ['delivery.order.read', 'delivery.order.own'] },
  { path: '/inventory', icon: '📦', label: 'Inventario', title: 'Inventario', perms: ['inventory.stock.read'] },
  { path: '/purchasing', icon: '🛒', label: 'Compras', title: 'Compras', perms: ['purchasing.order.read'] },
  { path: '/suppliers', icon: '🚚', label: 'Proveedores', title: 'Proveedores', perms: ['purchasing.supplier.read'] },
  { path: '/menu', icon: '📖', label: 'Menú', title: 'Menú y recetas', perms: ['catalog.product.write'] },
  { path: '/customers', icon: '👥', label: 'Clientes', title: 'Clientes · CRM', perms: ['crm.customer.read'] },
  { path: '/staff', icon: '👨‍💼', label: 'Empleados', title: 'Empleados y accesos', anyOf: ['staff.employee.read', 'identity.user.read'] },
  { path: '/reservations', icon: '📅', label: 'Reservaciones', title: 'Reservaciones', perms: ['floor.reservation.read'] },
  { path: '/promotions', icon: '🎟️', label: 'Promociones', title: 'Promociones', perms: ['promotions.promotion.read'] },
  { path: '/loyalty', icon: '⭐', label: 'Fidelización', title: 'Programa de lealtad', perms: ['loyalty.rule.read'] },
  { path: '/reports', icon: '📊', label: 'Reportes', title: 'Centro de reportes', anyOf: ['reports.sales.read', 'reports.profit.read', 'reports.inventory.read'] },
  { path: '/cash', icon: '💰', label: 'Caja', title: 'Caja y cortes', perms: ['cash.shift.operate'] },
  { path: '/audit', icon: '🕵️', label: 'Auditoría', title: 'Bitácora de auditoría', perms: ['audit.log.read'] },
  { path: '/settings', icon: '⚙️', label: 'Configuración', title: 'Configuración', anyOf: ['tenancy.settings.read', 'tenancy.settings.write', 'printing.manage'] },
];
export const allowed = (r: RouteDef, can: (p: string) => boolean) => (r.perms ?? []).every(can) && (!r.anyOf || r.anyOf.some(can));
export function buildNav(can: (p: string) => boolean): NavEntry[] {
  const visible = ROUTES.filter((r) => allowed(r, can));
  const main = visible.filter((r) => r.path !== '/settings').map((r) => ({ to: r.path, icon: r.icon, label: r.label }));
  const settings = visible.filter((r) => r.path === '/settings').map((r) => ({ to: r.path, icon: r.icon, label: r.label }));
  return [...main, ...(settings.length ? (['sep', ...settings] as NavEntry[]) : [])];
}
export const titleOf = (path: string) => ROUTES.find((r) => (r.path === '/' ? path === '/' : path.startsWith(r.path)))?.title ?? 'RETROBURGER';
