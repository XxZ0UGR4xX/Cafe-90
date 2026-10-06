import { Injectable } from '@nestjs/common';
import { DbService } from '../../database/db.service';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';

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
