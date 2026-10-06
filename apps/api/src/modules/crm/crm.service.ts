import { Injectable } from '@nestjs/common';
import { DbService } from '../../database/db.service';
import { conflict, notFound } from '../../common/errors';
import { AuditService } from '../audit/audit.service';

type Dict = Record<string, any>;

/** Segmentación (reglas por defecto; umbrales configurables en settings en una fase posterior). */
const SEGMENT_SQL = `CASE
  WHEN c.last_visit_at IS NOT NULL AND c.last_visit_at < now() - interval '60 days' THEN 'INACTIVO'
  WHEN c.total_spent >= 5000 OR c.visits >= 15 THEN 'VIP'
  WHEN c.visits >= 4 THEN 'FRECUENTE'
  ELSE 'NUEVO' END`;

const COLS = `c.id, c.name, c.phone, c.email, c.birthday, c.marketing_consent AS "marketingConsent", c.total_spent AS "totalSpent", c.visits,
  c.last_visit_at AS "lastVisitAt", CASE WHEN c.visits > 0 THEN round(c.total_spent / c.visits, 2) ELSE 0 END AS "avgTicket", c.notes, c.created_at AS "createdAt",
  ${SEGMENT_SQL} AS segment`;

@Injectable()
export class CrmService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  list(f: { q?: string; segment?: string; limit: number; offset: number }) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT * FROM (SELECT ${COLS} FROM customers c WHERE c.deleted_at IS NULL
          AND ($1::text IS NULL OR c.name ILIKE '%'||$1||'%' OR c.phone ILIKE '%'||$1||'%' OR c.email ILIKE '%'||$1||'%')) x
        WHERE $2::text IS NULL OR x.segment = $2 ORDER BY x.name LIMIT $3 OFFSET $4`, [f.q ?? null, f.segment ?? null, f.limit, f.offset])).rows);
  }

  async get(id: string) {
    const c = await this.db.tx(async (q) => {
      const row = (await q.query(`SELECT ${COLS} FROM customers c WHERE c.id=$1 AND c.deleted_at IS NULL`, [id])).rows[0];
      if (!row) return null;
      row.addresses = (await q.query('SELECT id, label, line1, references_text AS "references", is_default AS "isDefault" FROM customer_addresses WHERE customer_id=$1', [id])).rows;
      row.recentOrders = (await q.query(`SELECT id, number, total, created_at AS "createdAt", status FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 10`, [id])).rows;
      return row;
    });
    if (!c) throw notFound('customer');
    return c;
  }

  save(id: string | null, d: Dict) {
    return this.db.tx(async (q) => {
      const vals = [d.name, d.phone ?? null, d.email ?? null, d.birthday ?? null, d.marketingConsent, d.notes ?? null];
      const r = id
        ? await q.query(`UPDATE customers SET name=$2, phone=$3, email=$4, birthday=$5, marketing_consent=$6, notes=$7 WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id, ...vals])
        : await q.query(`INSERT INTO customers (tenant_id, name, phone, email, birthday, marketing_consent, notes) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6) RETURNING id`, vals);
      if (!r.rows[0]) throw notFound('customer');
      await this.audit.record(q, { action: id ? 'customer.update' : 'customer.create', entity: 'customer', entityId: r.rows[0].id, newValue: { name: d.name } });
      return r.rows[0].id as string;
    }).catch((e) => { if (e.code === '23505') throw conflict({ field: 'phone|email' }, '⚠️ Ya existe un cliente con ese teléfono o correo.'); throw e; })
      .then((cid) => this.get(cid));
  }

  remove(id: string) {
    return this.db.tx(async (q) => {
      const r = await q.query('UPDATE customers SET deleted_at = now() WHERE id=$1 AND deleted_at IS NULL', [id]);
      if (!r.rowCount) throw notFound('customer');
      await this.audit.record(q, { action: 'customer.delete', entity: 'customer', entityId: id });
    });
  }

  /** Estadísticas del cliente al cobrar / devolver (llamado por eventos de dominio, misma transacción). */
  async recordVisit(q: import('../../database/db.service').Tx, customerId: string, total: number) {
    await q.query(`UPDATE customers SET visits = visits + 1, total_spent = total_spent + $2, last_visit_at = now() WHERE id=$1`, [customerId, total]);
  }
  async reverseVisit(q: import('../../database/db.service').Tx, customerId: string, amount: number, fullVisit: boolean) {
    await q.query(`UPDATE customers SET total_spent = GREATEST(total_spent - $2, 0), visits = GREATEST(visits - $3, 0) WHERE id=$1`, [customerId, amount, fullVisit ? 1 : 0]);
  }
}
