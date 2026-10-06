import { Injectable } from '@nestjs/common';
import { DbService, Tx } from '../../database/db.service';
import { ctx } from '../../common/request-context';

export interface NotificationInput {
  type: string; severity?: 'INFO' | 'WARNING' | 'CRITICAL'; title: string; body?: string;
  branchId?: string | null; payload?: unknown; dedupeKey?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService) {}

  /** Inserta una notificación dentro de la transacción actual; `dedupeKey` evita duplicados. */
  async emit(q: Tx, n: NotificationInput): Promise<void> {
    await q.query(
      `INSERT INTO notifications (tenant_id, branch_id, type, severity, title, body, payload, dedupe_key)
       VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [n.branchId ?? null, n.type, n.severity ?? 'INFO', n.title, n.body ?? null,
        n.payload === undefined ? null : JSON.stringify(n.payload), n.dedupeKey ?? null]);
  }

  list(opts: { branchId?: string; unreadOnly: boolean; limit: number }) {
    const p = ctx().principal!;
    const scope = p.branchScope('notifications.read');
    return this.db.tx(async (q) => (await q.query(
      `SELECT n.id, n.branch_id AS "branchId", n.type, n.severity, n.title, n.body, n.payload, n.created_at AS "createdAt",
              (r.user_id IS NOT NULL) AS read
         FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
        WHERE ($2::uuid IS NULL OR n.branch_id = $2)
          AND ($3::uuid[] IS NULL OR n.branch_id IS NULL OR n.branch_id = ANY($3::uuid[]))
          AND (NOT $4 OR r.user_id IS NULL)
        ORDER BY n.created_at DESC LIMIT $5`, [p.userId, opts.branchId ?? null, scope, opts.unreadOnly, opts.limit])).rows);
  }

  markRead(id: string) {
    return this.db.tx(async (q) => {
      await q.query(`INSERT INTO notification_reads (tenant_id, notification_id, user_id) VALUES (app_tenant_id(),$1,$2) ON CONFLICT DO NOTHING`, [id, ctx().principal!.userId]);
    });
  }

  markAllRead() {
    return this.db.tx(async (q) => {
      await q.query(`INSERT INTO notification_reads (tenant_id, notification_id, user_id)
                     SELECT app_tenant_id(), id, $1 FROM notifications ON CONFLICT DO NOTHING`, [ctx().principal!.userId]);
    });
  }
}
