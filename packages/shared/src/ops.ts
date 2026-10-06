import { z } from 'zod';
import { OrderItemInputDto, PaymentInputDto } from './sales';

const uuid = z.string().uuid();
const money = z.number().min(0).max(99_999_999);

// ─────── Reservaciones ───────
export const RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'ARRIVED', 'CANCELLED', 'NO_SHOW'] as const;
export const ReservationDto = z.object({
  branchId: uuid, customerId: uuid.optional(), customerName: z.string().min(1).max(120), phone: z.string().max(30).optional(),
  partySize: z.number().int().min(1).max(50), startsAt: z.string().datetime(), durationMin: z.number().int().min(15).max(480).default(90),
  tableId: uuid.optional(), notes: z.string().max(300).optional(),
});
export const ReservationPatchDto = ReservationDto.partial().omit({ branchId: true });

// ─────── Lealtad ───────
export const LoyaltyProgramDto = z.object({
  isActive: z.boolean().default(true), currencyPerPoint: z.number().positive().max(100000).default(10),
  levels: z.array(z.object({ name: z.string().min(1).max(20), min: z.number().int().min(0) })).min(1).max(10).default([{ name: 'BRONCE', min: 0 }, { name: 'PLATA', min: 500 }, { name: 'ORO', min: 1500 }]),
  expiryDays: z.number().int().min(1).max(3650).nullable().optional(),
});
export const RewardDto = z.object({ name: z.string().min(1).max(80), pointsCost: z.number().int().min(1), productId: uuid.nullable().optional(), isActive: z.boolean().default(true) });
export const RedeemDto = z.object({ customerId: uuid, rewardId: uuid, orderId: uuid });
export const PointsAdjustDto = z.object({ customerId: uuid, points: z.number().int().refine((n) => n !== 0), reason: z.string().min(3).max(200) });

// ─────── Promociones ───────
export const PROMOTION_TYPES = ['BOGO', 'PERCENT', 'FIXED', 'HAPPY_HOUR', 'FREE_PRODUCT', 'COUPON', 'BIRTHDAY', 'DOUBLE_POINTS'] as const;
export const PromotionDto = z.object({
  name: z.string().min(1).max(100), type: z.enum(PROMOTION_TYPES),
  config: z.object({
    percent: z.number().min(0).max(100).optional(), amount: z.number().min(0).optional(), minSubtotal: z.number().min(0).optional(),
    productIds: z.array(uuid).optional(), categoryIds: z.array(uuid).optional(), freeProductId: uuid.optional(),
    multiplier: z.number().min(1).max(10).optional(), discountKind: z.enum(['PERCENT', 'FIXED']).optional(),
  }).default({}),
  code: z.string().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/).nullable().optional(),
  schedule: z.object({ days: z.array(z.number().int().min(0).max(6)).optional(), from: z.string().regex(/^\d{2}:\d{2}$/).optional(), to: z.string().regex(/^\d{2}:\d{2}$/).optional() }).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional(),
  branchIds: z.array(uuid).nullable().optional(), priority: z.number().int().default(0), stackable: z.boolean().default(false),
  maxRedemptions: z.number().int().min(1).nullable().optional(), isActive: z.boolean().default(true),
});
export const ApplyCouponDto = z.object({ code: z.string().min(3).max(30) });

// ─────── Delivery ───────
export const DELIVERY_STATUSES = ['RECEIVED', 'CONFIRMED', 'PREPARING', 'READY', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED'] as const;
export const DeliveryCreateDto = z.object({
  branchId: uuid, customerId: uuid.optional(), customerName: z.string().min(1).max(120), phone: z.string().min(5).max(30),
  address: z.string().min(5).max(300), addressNotes: z.string().max(200).optional(), fee: money.default(0),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'QR', 'PAID']).default('CASH'), notes: z.string().max(300).optional(),
  items: z.array(OrderItemInputDto).min(1).max(100), clientUuid: uuid.optional(),
});
export const DeliveryStatusDto = z.object({ to: z.enum(DELIVERY_STATUSES), reason: z.string().max(200).optional() });
export const DeliveryAssignDto = z.object({ driverId: uuid });

// ─────── Impresión ───────
export const PrinterDto = z.object({
  branchId: uuid, name: z.string().min(1).max(60), role: z.enum(['KITCHEN', 'CASH', 'BAR']),
  connection: z.record(z.unknown()).default({}), columns: z.number().int().min(24).max(80).default(42),
  stationKeys: z.array(z.string().max(30)).default([]), isActive: z.boolean().default(true),
});

// ─────── Sincronización offline ───────
export const SYNC_OP_TYPES = ['ORDER_CREATE', 'ORDER_PAY', 'ORDER_CANCEL', 'ORDER_ADD_ITEMS'] as const;
export const SyncOpDto = z.object({
  opId: uuid, type: z.enum(SYNC_OP_TYPES), createdAt: z.string().datetime(),
  payload: z.record(z.unknown()),
});
export const SyncPushDto = z.object({ deviceId: z.string().min(1).max(80), branchId: uuid, operations: z.array(SyncOpDto).min(1).max(200) });
export const SyncResolveDto = z.object({ note: z.string().min(3).max(300) });
export { OrderItemInputDto, PaymentInputDto };

// ─────── Empleados ───────
export const EmployeeDto = z.object({
  branchId: uuid.nullable().optional(), userId: uuid.nullable().optional(), fullName: z.string().min(2).max(120), phone: z.string().max(30).optional(),
  email: z.string().email().optional(), position: z.string().min(2).max(60), salary: money.nullable().optional(),
  hiredAt: z.string().date().optional(), status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

// ─────── Reportes ───────
export const REPORT_TYPES = ['sales', 'products', 'inventory', 'purchases', 'profit', 'costs', 'employees', 'customers', 'promotions', 'waste', 'cash', 'tips', 'delivery', 'reservations'] as const;
export const ReportQueryDto = z.object({
  branchId: uuid.optional(), from: z.string().date(), to: z.string().date(),
  employeeId: uuid.optional(), categoryId: uuid.optional(), productId: uuid.optional(), method: z.enum(['CASH', 'CARD', 'TRANSFER', 'QR']).optional(),
  groupBy: z.enum(['day', 'hour', 'branch']).default('day'),
});
export const DashboardQueryDto = z.object({
  branchId: uuid.optional(), range: z.enum(['today', 'yesterday', 'last7', 'month', 'prevMonth', 'custom']).default('today'),
  from: z.string().date().optional(), to: z.string().date().optional(),
}).refine((d) => d.range !== 'custom' || (!!d.from && !!d.to && d.from <= d.to), { message: 'El rango personalizado requiere from y to válidos', path: ['from'] });
