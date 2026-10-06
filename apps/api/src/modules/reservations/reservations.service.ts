import { Injectable } from '@nestjs/common';
import { DbService } from '../../database/db.service';
import { AppError, conflict, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { DomainEvents } from '../../common/domain-events';
import { AuditService } from '../audit/audit.service';

type Dict = Record<string, any>;
const COLS = `r.id, r.branch_id AS "branchId", r.customer_id AS "customerId", r.customer_name AS "customerName", r.phone, r.party_size AS "partySize", r.starts_at AS "startsAt",
  r.duration_min AS "durationMin", r.ends_at AS "endsAt", r.table_id AS "tableId", t.number AS "tableNumber", r.notes, r.status, r.source`;
const TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'ARRIVED', 'CANCELLED', 'NO_SHOW'], CONFIRMED: ['ARRIVED', 'CANCELLED', 'NO_SHOW'], ARRIVED: [], CANCELLED: [], NO_SHOW: [],
};

@Injectable()
export class ReservationsService {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly events: DomainEvents) {}

  private assertBranch(perm: string, branchId: string) {
    if (!ctx().principal!.can(perm, branchId)) throw forbidden({ permission: perm, branchId });
  }

  list(f: { branchId: string; from: string; to: string; status?: string }) {
    this.assertBranch('floor.reservation.read', f.branchId);
    return this.db.tx(async (q) => (await q.query(
      `SELECT ${COLS} FROM reservations r LEFT JOIN tables t ON t.id = r.table_id
        WHERE r.branch_id=$1 AND r.starts_at >= $2::date AND r.starts_at < ($3::date + 1) AND ($4::text IS NULL OR r.status = $4) ORDER BY r.starts_at`,
      [f.branchId, f.from, f.to, f.status ?? null])).rows);
  }

  /** Mesas disponibles para un horario y número de personas. */
  availability(branchId: string, startsAt: string, partySize: number, durationMin: number) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT t.id, t.number, t.capacity FROM tables t WHERE t.branch_id=$1 AND t.is_active AND t.capacity >= $3
          AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.table_id = t.id AND r.status IN ('PENDING','CONFIRMED','ARRIVED')
                            AND tstzrange(r.starts_at, r.ends_at) && tstzrange($2::timestamptz, $2::timestamptz + $4 * interval '1 minute'))
        ORDER BY t.capacity, t.number`, [branchId, startsAt, partySize, durationMin])).rows);
  }

  async create(d: Dict, source: 'STAFF' | 'PUBLIC' = 'STAFF') {
    if (source === 'STAFF') this.assertBranch('floor.reservation.write', d.branchId);
    return this.db.tx(async (q) => {
      if (new Date(d.startsAt) < new Date(Date.now() - 5 * 60_000)) throw new AppError('VALIDATION_ERROR', 400, { field: 'startsAt', message: 'La fecha ya pasó' });
      let tableId: string | null = d.tableId ?? null;
      if (tableId) {
        const t = (await q.query('SELECT capacity, branch_id FROM tables WHERE id=$1 AND is_active', [tableId])).rows[0];
        if (!t || t.branch_id !== d.branchId) throw notFound('table');
        if (t.capacity < d.partySize) throw new AppError('VALIDATION_ERROR', 400, { field: 'tableId', message: `La mesa solo tiene capacidad para ${t.capacity}` });
      } else if (source === 'PUBLIC') {   // público: se asigna la mesa disponible más ajustada
        const free = await q.query(
          `SELECT t.id FROM tables t WHERE t.branch_id=$1 AND t.is_active AND t.capacity >= $3 AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.table_id=t.id AND r.status IN ('PENDING','CONFIRMED','ARRIVED')
             AND tstzrange(r.starts_at, r.ends_at) && tstzrange($2::timestamptz, $2::timestamptz + $4 * interval '1 minute')) ORDER BY t.capacity, t.number LIMIT 1`,
          [d.branchId, d.startsAt, d.partySize, d.durationMin ?? 90]);
        if (!free.rows[0]) throw new AppError('CONFLICT', 409, undefined, false, '📅 No hay mesas disponibles en ese horario. Prueba con otra hora.');
        tableId = free.rows[0].id;
      }
      const r = (await q.query(
        `INSERT INTO reservations (tenant_id, branch_id, customer_id, customer_name, phone, party_size, starts_at, duration_min, table_id, notes, status, source, created_by)
         VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [d.branchId, d.customerId ?? null, d.customerName, d.phone ?? null, d.partySize, d.startsAt, d.durationMin ?? 90, tableId, d.notes ?? null,
          source === 'STAFF' ? 'CONFIRMED' : 'PENDING', source, ctx().principal?.userId ?? null])).rows[0];
      await this.audit.record(q, { action: 'reservation.create', entity: 'reservation', entityId: r.id, branchId: d.branchId, newValue: { ...d, source } });
      await this.events.emit(q, { type: 'ReservationChanged', branchId: d.branchId, payload: { reservationId: r.id } });
      return this.byId(q, r.id);
    }).catch((e) => { if (e.code === '23P01') throw conflict({ field: 'tableId' }, '📅 La mesa ya está reservada en ese horario.'); throw e; });
  }

  private async byId(q: import('../../database/db.service').Tx, id: string) {
    const r = (await q.query(`SELECT ${COLS} FROM reservations r LEFT JOIN tables t ON t.id = r.table_id WHERE r.id=$1`, [id])).rows[0];
    if (!r) throw notFound('reservation');
    return r;
  }

  update(id: string, d: Dict) {
    return this.db.tx(async (q) => {
      const cur = (await q.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!cur) throw notFound('reservation');
      this.assertBranch('floor.reservation.write', cur.branch_id);
      if (!['PENDING', 'CONFIRMED'].includes(cur.status)) throw new AppError('CONFLICT', 409);
      await q.query(`UPDATE reservations SET customer_id=COALESCE($2,customer_id), customer_name=COALESCE($3,customer_name), phone=COALESCE($4,phone), party_size=COALESCE($5,party_size),
        starts_at=COALESCE($6,starts_at), duration_min=COALESCE($7,duration_min), table_id=COALESCE($8,table_id), notes=COALESCE($9,notes) WHERE id=$1`,
        [id, d.customerId ?? null, d.customerName ?? null, d.phone ?? null, d.partySize ?? null, d.startsAt ?? null, d.durationMin ?? null, d.tableId ?? null, d.notes ?? null]);
      await this.audit.record(q, { action: 'reservation.update', entity: 'reservation', entityId: id, branchId: cur.branch_id, oldValue: { startsAt: cur.starts_at, tableId: cur.table_id }, newValue: d });
      await this.events.emit(q, { type: 'ReservationChanged', branchId: cur.branch_id, payload: { reservationId: id } });
      return this.byId(q, id);
    }).catch((e) => { if (e.code === '23P01') throw conflict({ field: 'tableId' }, '📅 La mesa ya está reservada en ese horario.'); throw e; });
  }

  setStatus(id: string, to: string) {
    return this.db.tx(async (q) => {
      const cur = (await q.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!cur) throw notFound('reservation');
      this.assertBranch('floor.reservation.write', cur.branch_id);
      if (!TRANSITIONS[cur.status]!.includes(to)) throw new AppError('CONFLICT', 409, { from: cur.status, to });
      let session: string | null = null;
      if (to === 'ARRIVED' && cur.table_id) {   // llegada → abre la mesa automáticamente
        this.assertBranch('floor.table.operate', cur.branch_id);
        const t = (await q.query('SELECT status FROM tables WHERE id=$1 FOR UPDATE', [cur.table_id])).rows[0];
        if (t.status === 'FREE') {
          session = (await q.query(`INSERT INTO table_sessions (tenant_id, branch_id, table_id, guests, waiter_id, customer_id, customer_name) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6) RETURNING id`,
            [cur.branch_id, cur.table_id, cur.party_size, ctx().principal!.userId, cur.customer_id, cur.customer_name])).rows[0].id;
          await q.query(`UPDATE tables SET status='OCCUPIED' WHERE id=$1`, [cur.table_id]);
        }
      }
      await q.query('UPDATE reservations SET status=$2 WHERE id=$1', [id, to]);
      await this.audit.record(q, { action: `reservation.${to.toLowerCase()}`, entity: 'reservation', entityId: id, branchId: cur.branch_id, oldValue: { status: cur.status } });
      await this.events.emit(q, { type: 'ReservationChanged', branchId: cur.branch_id, payload: { reservationId: id, status: to } });
      return { ...(await this.byId(q, id)), sessionId: session };
    });
  }
}
