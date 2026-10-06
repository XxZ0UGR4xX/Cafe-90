import { z } from 'zod';

const uuid = z.string().uuid();
const qty = z.number().positive().max(1_000_000);
const money = z.number().min(0).max(99_999_999);

export const STATION_KEYS = ['PARRILLA', 'FREIDORA', 'BEBIDAS', 'POSTRES', 'PREPARACION'] as const;
export const UNITS = ['g', 'kg', 'ml', 'l', 'pza'] as const;

export const CategoryDto = z.object({
  name: z.string().min(1).max(80), icon: z.string().max(10).optional(), color: z.string().max(20).optional(),
  sortOrder: z.number().int().default(0), isActive: z.boolean().default(true),
});
export const TaxDto = z.object({
  name: z.string().min(1).max(60), rate: z.number().min(0).max(1), includedInPrice: z.boolean().default(true), isDefault: z.boolean().default(false),
});
export const IngredientDto = z.object({
  sku: z.string().min(1).max(40), name: z.string().min(1).max(120), unit: z.enum(UNITS),
  perishable: z.boolean().default(false), avgCost: money.default(0),
  defaultMin: z.number().min(0).default(0), defaultMax: z.number().min(0).default(0),
});
export const ModifierGroupDto = z.object({
  name: z.string().min(1).max(80), type: z.enum(['EXTRA', 'REMOVE', 'CHOICE']),
  minSelect: z.number().int().min(0).default(0), maxSelect: z.number().int().min(0).default(99),
  modifiers: z.array(z.object({
    name: z.string().min(1).max(80), priceDelta: z.number().min(-99999).max(99999).default(0),
    ingredientId: uuid.nullable().optional(), qtyDelta: z.number().default(0), isActive: z.boolean().default(true),
  })).max(60),
}).refine((g) => g.maxSelect >= g.minSelect, { message: 'maxSelect debe ser >= minSelect' });

export const RecipeItemDto = z.object({ ingredientId: uuid, qty, wastePct: z.number().min(0).max(0.99).default(0) });
export const ProductDto = z.object({
  categoryId: uuid.nullable().optional(),
  kind: z.enum(['SIMPLE', 'COMBO']).default('SIMPLE'),
  sku: z.string().min(1).max(40), barcode: z.string().max(40).nullable().optional(),
  name: z.string().min(1).max(120), description: z.string().max(500).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  price: money, taxId: uuid.nullable().optional(),
  isAvailable: z.boolean().default(true), isInventoriable: z.boolean().default(true),
  prepTimeSec: z.number().int().min(0).max(7200).default(300),
  stationKey: z.string().max(30).nullable().optional(),
  sortOrder: z.number().int().default(0),
  /** Claves SAT para facturación (c_ClaveProdServ de 8 dígitos, c_ClaveUnidad y su nombre). */
  satProductKey: z.string().regex(/^\d{8}$/).optional(), satUnitKey: z.string().regex(/^[A-Z0-9]{2,3}$/).optional(), satUnitName: z.string().min(1).max(40).optional(),
  variants: z.array(z.object({ name: z.string().min(1).max(60), sku: z.string().max(40).optional(),
    priceDelta: z.number().default(0), qtyFactor: z.number().positive().max(10).default(1) })).max(10).default([]),
  modifierGroupIds: z.array(uuid).max(20).default([]),
  comboSlots: z.array(z.object({
    name: z.string().min(1).max(60), defaultProductId: uuid,
    options: z.array(z.object({ productId: uuid, priceDelta: z.number().default(0) })).max(30).default([]),
  })).max(10).default([]),
  recipe: z.array(RecipeItemDto).max(60).optional(),
});
export const BranchProductDto = z.object({ price: money.nullable().optional(), isAvailable: z.boolean().nullable().optional() });

// ─────── Inventario ───────
export const MovementDto = z.object({
  branchId: uuid, ingredientId: uuid,
  type: z.enum(['PURCHASE_IN', 'ADJUSTMENT', 'WASTE', 'RETURN']),
  qty: z.number().refine((n) => n !== 0, 'qty no puede ser 0'),
  unitCost: money.optional(), reason: z.string().max(200).optional(),
  lotCode: z.string().max(40).optional(), expiresOn: z.string().date().optional(),
}).superRefine((m, c) => {
  if (m.type === 'WASTE' && m.qty > 0) c.addIssue({ code: 'custom', message: 'La merma debe ser negativa', path: ['qty'] });
  if (m.type === 'WASTE' && !m.reason) c.addIssue({ code: 'custom', message: 'La merma requiere motivo', path: ['reason'] });
  if (m.type === 'ADJUSTMENT' && !m.reason) c.addIssue({ code: 'custom', message: 'El ajuste requiere motivo', path: ['reason'] });
});
export const StockLevelDto = z.object({ branchId: uuid, ingredientId: uuid, minQty: z.number().min(0), maxQty: z.number().min(0) });
export const TransferDto = z.object({
  fromBranchId: uuid, toBranchId: uuid, notes: z.string().max(300).optional(),
  items: z.array(z.object({ ingredientId: uuid, qty })).min(1).max(100),
});
export const CountDto = z.object({ branchId: uuid, notes: z.string().max(300).optional() });
export const CountSubmitDto = z.object({ items: z.array(z.object({ ingredientId: uuid, countedQty: z.number().min(0) })).min(1) });

// ─────── Compras ───────
export const SupplierDto = z.object({
  name: z.string().min(1).max(120), contactName: z.string().max(120).optional(), phone: z.string().max(30).optional(),
  email: z.string().email().optional(), taxId: z.string().max(30).optional(), address: z.string().max(300).optional(),
  leadTimeDays: z.number().int().min(0).default(2), paymentTermsDays: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  products: z.array(z.object({ ingredientId: uuid, price: money })).default([]),
});
export const PurchaseOrderDto = z.object({
  branchId: uuid, supplierId: uuid, expectedOn: z.string().date().optional(), notes: z.string().max(300).optional(),
  items: z.array(z.object({ ingredientId: uuid, qty, unitPrice: money })).min(1).max(100),
});
export const ReceiveDto = z.object({
  notes: z.string().max(300).optional(),
  items: z.array(z.object({ ingredientId: uuid, qty, unitCost: money.optional(),
    lotCode: z.string().max(40).optional(), expiresOn: z.string().date().optional() })).min(1),
});
export const InvoiceDto = z.object({
  supplierId: uuid, purchaseOrderId: uuid.optional(), invoiceNumber: z.string().min(1).max(60),
  total: money, issuedOn: z.string().date().optional(), dueOn: z.string().date().optional(),
});
export const QuoteDto = z.object({
  branchId: uuid, supplierId: uuid, validUntil: z.string().date().optional(), notes: z.string().max(300).optional(),
  items: z.array(z.object({ ingredientId: uuid, qty, unitPrice: money })).min(1).max(100),
});
