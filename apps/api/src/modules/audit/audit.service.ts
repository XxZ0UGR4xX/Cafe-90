import { Injectable } from '@nestjs/common';
import { Tx } from '../../database/db.service';
import { ctx } from '../../common/request-context';

export interface AuditEntry {
  action: string;           // p.ej. 'order.cancel'
  entity: string;           // p.ej. 'order'
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  branchId?: string | null;
  /** Para eventos sin sesión (login fallido) */
  userId?: string | null;
  userName?: string | null;
}

const SENSITIVE = new Set(['password', 'password_hash', 'pin', 'pin_hash', 'mfa_secret_enc', 'token', 'token_hash']);
const scrub = (v: unknown): unknown =>
  v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, SENSITIVE.has(k) ? '[REDACTED]' : scrub(x)]))
    : v;

/** Registro de auditoría append-only. Se escribe en la MISMA transacción que el cambio auditado. */
@Injectable()
export class AuditService {
  async record(q: Tx, e: AuditEntry): Promise<void> {
    const c = ctx();
    await q.query(
      `INSERT INTO audit_logs (tenant_id, branch_id, user_id, user_name, ip, user_agent, action, entity, entity_id,
                               old_value, new_value, reason, request_id)
       VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        e.branchId ?? null,
        e.userId ?? c.principal?.userId ?? null,
        e.userName ?? c.principal?.fullName ?? null,
        c.ip ?? null, c.userAgent ?? null,
        e.action, e.entity, e.entityId ?? null,
        e.oldValue === undefined ? null : JSON.stringify(scrub(e.oldValue)),
        e.newValue === undefined ? null : JSON.stringify(scrub(e.newValue)),
        e.reason ?? null, c.requestId ?? null,
      ],
    );
  }
}
