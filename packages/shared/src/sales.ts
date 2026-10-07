import { z } from 'zod';
import { ORDER_CHANNELS, PAYMENT_METHODS } from './states';

const uuid = z.string().uuid();
const isCents = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const amount = z.number().finite().positive().max(99_999_999).refine(isCents, 'máximo 2 decimales');

export const SupervisorAuthDto = z.object({ userCode: z.string().min(1).max(40), pin: z.string().regex(/^\d{4,6}$/) });

export const OrderItemInputDto = z.object({
  productId: uuid, variantId: uuid.optional(),
  qty: z.number().int().min(1).max(99).default(1),
  notes: z.string().max(200).optional(),
  modifierIds: z.array(uuid).max(30).default([]),
  comboChoices: z.array(z.object({ slotId: uuid, productId: uuid, modifierIds: z.array(uuid).max(20).default([]) })).max(10).default([]),
});
export const OrderCreateDto = z.object({
  clientUuid: uuid.optional(),
  branchId: uuid,
  channel: z.enum(ORDER_CHANNELS).default('DINE_IN'),
  tableId: uuid.optional(),
  customerId: uuid.optional(), customerName: z.string().max(120).optional(),
  guests: z.number().int().min(1).max(50).optional(),
  notes: z.string().max(300).optional(),
  send: z.boolean().default(false),            // true = enviar a cocina de inmediato
  offline: z.boolean().default(false),         // venta originada offline: no se rechaza por stock
  items: z.array(OrderItemInputDto).min(1).max(100),
});
export const OrderPatchDto = z.object({
  notes: z.string().max(300).nullable().optional(), customerId: uuid.nullable().optional(),
  customerName: z.string().max(120).nullable().optional(), guests: z.number().int().min(1).max(50).optional(),
});
export const AddItemsDto = z.object({ items: z.array(OrderItemInputDto).min(1).max(100), send: z.boolean().default(false) });
export const ItemPatchDto = z.object({ qty: z.number().int().min(1).max(99).optional(), notes: z.string().max(200).nullable().optional() });
export const ItemCancelDto = z.object({ reason: z.string().min(3).max(200), supervisor: SupervisorAuthDto.optional() });

export const PaymentInputDto = z.object({
  method: z.enum(PAYMENT_METHODS), amount,
  tip: z.number().finite().min(0).max(9_999_999).refine(isCents, 'máximo 2 decimales').default(0),
  tendered: z.number().finite().positive().max(99_999_999).refine(isCents, 'máximo 2 decimales').optional(),
  reference: z.string().max(80).optional(),
  clientUuid: uuid.optional(),
});
export const PayDto = z.object({ payments: z.array(PaymentInputDto).min(1).max(10) });
export const DiscountDto = z.object({
  kind: z.enum(['PERCENT', 'FIXED']), value: z.number().finite().positive().max(99_999_999).refine(isCents, 'máximo 2 decimales'),
  reason: z.string().min(3).max(200), supervisor: SupervisorAuthDto.optional(),
});
export const CancelDto = z.object({ reason: z.string().min(3).max(200), supervisor: SupervisorAuthDto.optional() });
export const RefundDto = z.object({
  amount: amount.optional(), method: z.enum(PAYMENT_METHODS), reason: z.string().min(3).max(200), supervisor: SupervisorAuthDto.optional(),
  clientUuid: uuid.optional(),   // idempotencia: un doble clic o reintento no devuelve dos veces
});
export const SplitItemsDto = z.object({ itemIds: z.array(uuid).min(1).max(100) });
export const OrderListDto = z.object({
  branchId: uuid, status: z.string().max(200).optional(), paymentStatus: z.string().max(20).optional(),
  tableId: uuid.optional(), mine: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  from: z.string().date().optional(), to: z.string().date().optional(), channel: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
});

// ─────── Mesas ───────
export const TableDto = z.object({
  number: z.number().int().min(1).max(999), capacity: z.number().int().min(1).max(50).default(4),
  shape: z.enum(['SQUARE', 'ROUND', 'BOOTH', 'BAR']).default('SQUARE'),
  x: z.number().int().min(0).max(100).default(0), y: z.number().int().min(0).max(100).default(0),
  w: z.number().int().min(1).max(10).default(1), h: z.number().int().min(1).max(10).default(1), isActive: z.boolean().default(true),
});
export const TableOpenDto = z.object({ guests: z.number().int().min(1).max(50).default(1), customerId: uuid.optional(), customerName: z.string().max(120).optional() });
export const TableMoveDto = z.object({ toTableId: uuid });
export const TableMergeDto = z.object({ tableIds: z.array(uuid).min(1).max(8) });
export const TableTransferDto = z.object({ waiterId: uuid });

// ─────── Cocina ───────
export const StationDto = z.object({ key: z.string().min(2).max(30).regex(/^[A-Z0-9_]+$/), name: z.string().min(1).max(60), color: z.string().max(20).optional(), isActive: z.boolean().default(true) });
export const TicketStatusDto = z.object({ to: z.enum(['NEW', 'PREPARING', 'READY', 'DELIVERED']) });

// ─────── Caja ───────
const denominations = z.record(z.string().regex(/^\d+(\.\d+)?$/), z.number().int().min(0)).optional();
export const ShiftOpenDto = z.object({ branchId: uuid, registerId: uuid.optional(), openingFloat: z.number().min(0).max(9_999_999), denominations });
export const ShiftCloseDto = z.object({ countedCash: z.number().min(0).max(99_999_999), denominations, notes: z.string().max(300).optional(), supervisor: SupervisorAuthDto.optional() });
export const CashMovementDto = z.object({
  shiftId: uuid.optional(), type: z.enum(['EXPENSE', 'WITHDRAWAL', 'DEPOSIT']), amount, reason: z.string().min(3).max(200), supervisor: SupervisorAuthDto.optional(),
});
export const RegisterDto = z.object({ branchId: uuid, name: z.string().min(1).max(60) });

// ─────── CRM ───────
export const CustomerDto = z.object({
  name: z.string().min(1).max(120), phone: z.string().max(30).optional(), email: z.string().email().max(200).optional(),
  birthday: z.string().date().optional(), marketingConsent: z.boolean().default(false), notes: z.string().max(500).optional(),
});
export const CUSTOMER_SEGMENTS = ['NUEVO', 'FRECUENTE', 'VIP', 'INACTIVO'] as const;
