/** Estados globales (§56). Las transiciones válidas se validan en dominio y en BD. */
export const ORDER_STATUSES = [
  'DRAFT', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'COMPLETED', 'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'PARTIAL', 'REFUNDED', 'FAILED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const INVENTORY_STATUSES = ['AVAILABLE', 'LOW', 'CRITICAL', 'OUT_OF_STOCK'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'QR'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ORDER_CHANNELS = ['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'QR'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const KITCHEN_STATUSES = ['NEW', 'PREPARING', 'READY', 'DELIVERED'] as const;
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];

export const TABLE_STATUSES = ['FREE', 'OCCUPIED', 'RESERVED', 'CLEANING'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

/** Transiciones permitidas de una orden. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['PENDING', 'CONFIRMED', 'CANCELLED'],
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'READY', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERED', 'COMPLETED', 'CANCELLED'],
  DELIVERED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const KITCHEN_TRANSITIONS: Record<KitchenStatus, KitchenStatus[]> = {
  NEW: ['PREPARING', 'READY'],
  PREPARING: ['READY', 'NEW'],
  READY: ['DELIVERED', 'PREPARING'],
  DELIVERED: [],
};

export function canTransition<S extends string>(map: Record<S, S[]>, from: S, to: S): boolean {
  return map[from]?.includes(to) ?? false;
}

/** Estado derivado de inventario a partir de cantidad y mínimo (§14). */
export function inventoryStatus(qty: number, min: number): InventoryStatus {
  if (qty <= 0) return 'OUT_OF_STOCK';
  if (qty <= min * 0.5) return 'CRITICAL';
  if (qty <= min) return 'LOW';
  return 'AVAILABLE';
}
