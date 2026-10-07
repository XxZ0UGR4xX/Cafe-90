import { Injectable } from '@nestjs/common';
import { DbService } from '../../database/db.service';
import { ctx } from '../../common/request-context';
import { AppError, forbidden } from '../../common/errors';
import { AuditService } from '../audit/audit.service';

const num = (max: number) => (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const bool = (v: unknown) => typeof v === 'boolean';
/** Claves escribibles y su validación. Cualquier otra clave se rechaza (la configuración gobierna controles de seguridad). */
const WRITABLE: Record<string, { valid: (v: unknown) => boolean; globalOnly?: boolean }> = {
  'sales.discountThresholdPct': { valid: num(100) },
  'cash.tolerance': { valid: num(100_000) },
  'cash.expenseLimit': { valid: num(10_000_000) },
  'purchasing.approvalThreshold': { valid: num(100_000_000) },
  'inventory.allowNegativeSales': { valid: bool },
  'qr.autoSend': { valid: bool },
  'delivery.fee': { valid: num(100_000) },
  'kitchen.slaWarnMin': { valid: num(1_000) },
  'kitchen.slaLateMin': { valid: num(1_000) },
  'fiscal.invoiceWindowDays': { valid: num(366) },
  'notifications.emailTo': { valid: (v) => typeof v === 'string' && v.length <= 500 && v.split(/[,;\s]+/).filter(Boolean).every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)), globalOnly: true },
};

/** Configuración clave→valor por tenant, con override por sucursal. Cada cambio queda auditado y versionado. */
@Injectable()
export class SettingsService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  /** Resuelve valores efectivos: override de sucursal sobre valor global. */
  async effective(branchId?: string): Promise<Record<string, unknown>> {
    return this.db.tx(async (q) => {
      const { rows } = await q.query(
        `SELECT key, value, branch_id FROM settings WHERE branch_id IS NULL OR branch_id = $1 ORDER BY branch_id NULLS FIRST`,
        [branchId ?? null]);
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    });
  }

  async get(key: string, branchId?: string, fallback: unknown = null) {
    return (await this.effective(branchId))[key] ?? fallback;
  }

  async set(key: string, value: unknown, branchId?: string | null) {
    const rule = WRITABLE[key];
    if (!rule || !rule.valid(value)) throw new AppError('VALIDATION_ERROR', 400, { field: key }, false, '⚠️ Configuración desconocida o con un valor inválido.');
    const p = ctx().principal!;
    if (branchId) { if (rule.globalOnly || !p.can('tenancy.settings.write', branchId)) throw forbidden({ permission: 'tenancy.settings.write' }); }
    else if (p.branchScope('tenancy.settings.write') !== null) throw forbidden({ reason: 'configuración global: requiere alcance corporativo' });
    return this.db.tx(async (q) => {
      const old = (await q.query(
        `SELECT value FROM settings WHERE key = $1 AND branch_id IS NOT DISTINCT FROM $2`, [key, branchId ?? null])).rows[0];
      await q.query(
        `INSERT INTO settings (tenant_id, branch_id, key, value, updated_by) VALUES (app_tenant_id(), $1,$2,$3,$4)
         ON CONFLICT (tenant_id, key, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'))
         DO UPDATE SET value = EXCLUDED.value, version = settings.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [branchId ?? null, key, JSON.stringify(value), ctx().principal?.userId ?? null]);
      await this.audit.record(q, { action: 'settings.update', entity: 'setting', entityId: key, branchId: branchId ?? null,
        oldValue: old?.value, newValue: value });
      return { key, value, branchId: branchId ?? null };
    });
  }
}
