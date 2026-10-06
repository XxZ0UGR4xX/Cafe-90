import { Injectable } from '@nestjs/common';
import { KITCHEN_TRANSITIONS, canTransition, type KitchenStatus } from '@retroburger/shared';
import { DbService, Tx } from '../../database/db.service';
import { AppError, conflict, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { DomainEvents } from '../../common/domain-events';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../tenancy/settings.service';

type Dict = Record<string, any>;
export const DEFAULT_STATIONS = [
  { key: 'PARRILLA', name: 'Parrilla', color: '#D62828' }, { key: 'FREIDORA', name: 'Freidora', color: '#F6B800' },
  { key: 'BEBIDAS', name: 'Bebidas', color: '#1E6BFF' }, { key: 'POSTRES', name: 'Postres', color: '#F77F00' },
  { key: 'PREPARACION', name: 'Preparación', color: '#39FF14' },
];

@Injectable()
export class KitchenService {
  constructor(private readonly db: DbService, private readonly events: DomainEvents, private readonly audit: AuditService, private readonly settings: SettingsService) {}

  /** Registra los handlers de eventos (llamado desde el módulo). */
  register() {
    this.events.on('BranchCreated', async (q, e) => { await this.seedStations(q, e.payload.branchId); });
    this.events.on('OrderSent', async (q, e) => { await this.createTickets(q, e.payload); });
  }

  async seedStations(q: Tx, branchId: string) {
    for (const s of DEFAULT_STATIONS)
      await q.query(`INSERT INTO kitchen_stations (tenant_id, branch_id, key, name, color) VALUES (app_tenant_id(),$1,$2,$3,$4) ON CONFLICT (branch_id, key) DO NOTHING`, [branchId, s.key, s.name, s.color]);
  }

  /** Ruteo producto→estación: un ticket por estación y "ronda" de envío. */
  private async createTickets(q: Tx, p: { orderId: string; itemIds: string[]; branchId?: string }) {
    const order = (await q.query('SELECT id, branch_id FROM orders WHERE id=$1', [p.orderId])).rows[0];
    const items = (await q.query(
      `SELECT oi.id, oi.name, oi.qty, oi.notes, oi.station_key, oi.slot_name,
              COALESCE((SELECT array_agg(CASE WHEN m.type = 'REMOVE' THEN 'SIN ' || m.name WHEN m.type = 'EXTRA' THEN '+ ' || m.name ELSE m.name END ORDER BY m.name) FROM order_item_modifiers m WHERE m.order_item_id = oi.id), '{}') AS mods
         FROM order_items oi WHERE oi.id = ANY($1::uuid[]) ORDER BY oi.created_at, oi.id`, [p.itemIds])).rows;
    const round = ((await q.query('SELECT COALESCE(max(round),0)+1 AS r FROM kitchen_orders WHERE order_id=$1', [p.orderId])).rows[0].r) as number;
    const byStation = new Map<string, Dict[]>();
    for (const it of items) byStation.set(it.station_key, [...(byStation.get(it.station_key) ?? []), it]);
    for (const [key, list] of byStation) {
      const st = (await q.query('SELECT id FROM kitchen_stations WHERE branch_id=$1 AND key=$2 AND is_active', [order.branch_id, key])).rows[0];
      const ko = (await q.query(`INSERT INTO kitchen_orders (tenant_id, branch_id, order_id, station_id, station_key, round) VALUES (app_tenant_id(),$1,$2,$3,$4,$5) RETURNING id`,
        [order.branch_id, p.orderId, st?.id ?? null, key, round])).rows[0];
      for (const it of list)
        await q.query(`INSERT INTO kitchen_order_items (tenant_id, kitchen_order_id, order_item_id, name, qty, modifiers, notes) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6)`,
          [ko.id, it.id, it.slot_name ? `${it.name} (${it.slot_name})` : it.name, it.qty, it.mods, it.notes]);
      await this.events.emit(q, { type: 'KitchenChanged', branchId: order.branch_id, payload: { ticketId: ko.id, orderId: p.orderId, new: true, station: key } });
    }
  }

  // ───────── Estaciones ─────────
  stations(branchId: string) {
    return this.db.tx(async (q) => (await q.query(`SELECT id, key, name, color, is_active AS "isActive" FROM kitchen_stations WHERE branch_id=$1 ORDER BY name`, [branchId])).rows);
  }
  saveStation(branchId: string, d: Dict) {
    if (!ctx().principal!.can('printing.manage', branchId) && !ctx().principal!.can('tenancy.settings.write', branchId)) throw forbidden();
    return this.db.tx(async (q) => {
      const r = (await q.query(`INSERT INTO kitchen_stations (tenant_id, branch_id, key, name, color, is_active) VALUES (app_tenant_id(),$1,$2,$3,$4,$5)
        ON CONFLICT (branch_id, key) DO UPDATE SET name=EXCLUDED.name, color=EXCLUDED.color, is_active=EXCLUDED.is_active RETURNING id, key, name, color, is_active AS "isActive"`,
        [branchId, d.key, d.name, d.color ?? null, d.isActive])).rows[0];
      await this.audit.record(q, { action: 'kitchen_station.save', entity: 'kitchen_station', entityId: r.id, branchId, newValue: r });
      return r;
    });
  }

  // ───────── Tickets ─────────
  async tickets(f: { branchId: string; station?: string; status?: string }) {
    const warn = Number(await this.settings.get('kitchen.slaWarnMin', f.branchId, 5)) * 60;
    const late = Number(await this.settings.get('kitchen.slaLateMin', f.branchId, 10)) * 60;
    return this.db.tx(async (q) => {
      const rows = (await q.query(
        `SELECT ko.id, ko.order_id AS "orderId", o.number, o.channel, t.number AS "tableNumber", ko.station_key AS "stationKey", ko.round, ko.status,
                ko.created_at AS "createdAt", ko.started_at AS "startedAt", ko.ready_at AS "readyAt", w.full_name AS "waiterName", o.customer_name AS "customerName",
                EXTRACT(EPOCH FROM (now() - ko.created_at))::int AS "elapsedSeconds", o.notes AS "orderNotes",
                (SELECT json_agg(json_build_object('id', i.id, 'name', i.name, 'qty', i.qty, 'modifiers', i.modifiers, 'notes', i.notes) ORDER BY i.name) FROM kitchen_order_items i WHERE i.kitchen_order_id = ko.id) AS items
           FROM kitchen_orders ko JOIN orders o ON o.id = ko.order_id LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN users w ON w.id = o.waiter_id
          WHERE ko.branch_id = $1 AND ($2::text IS NULL OR ko.station_key = $2)
            AND (CASE WHEN $3::text IS NOT NULL THEN ko.status = $3 ELSE (ko.status IN ('NEW','PREPARING','READY') OR (ko.status = 'DELIVERED' AND ko.delivered_at > now() - interval '15 minutes')) END)
          ORDER BY ko.created_at`, [f.branchId, f.station ?? null, f.status ?? null])).rows;
      return rows.map((r) => ({ ...r, sla: r.status === 'DELIVERED' ? 'ok' : r.elapsedSeconds >= late ? 'late' : r.elapsedSeconds >= warn ? 'warn' : 'ok' }));
    });
  }

  async setStatus(id: string, to: KitchenStatus) {
    return this.db.tx(async (q) => {
      const k = (await q.query('SELECT * FROM kitchen_orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!k) throw notFound('ticket');
      if (!ctx().principal!.can('kitchen.ticket.update', k.branch_id)) throw forbidden({ permission: 'kitchen.ticket.update' });
      if (k.status === to) return k;
      if (!canTransition(KITCHEN_TRANSITIONS, k.status as KitchenStatus, to)) throw new AppError('ORDER_INVALID_TRANSITION', 409, { from: k.status, to });
      const uid = ctx().principal!.userId;
      await q.query(
        `UPDATE kitchen_orders SET status=$2, bumped_by=$3,
                started_at = CASE WHEN $2 IN ('PREPARING') THEN COALESCE(started_at, now()) WHEN $2 = 'NEW' THEN NULL ELSE started_at END,
                ready_at = CASE WHEN $2 IN ('READY','DELIVERED') THEN COALESCE(ready_at, now()) WHEN $2 IN ('NEW','PREPARING') THEN NULL ELSE ready_at END,
                delivered_at = CASE WHEN $2 = 'DELIVERED' THEN now() ELSE NULL END WHERE id=$1`, [id, to, uid]);
      const itemStatus = to === 'NEW' ? 'SENT' : to;   // NEW|PREPARING|READY|DELIVERED
      await q.query(`UPDATE order_items SET status=$2 WHERE id IN (SELECT order_item_id FROM kitchen_order_items WHERE kitchen_order_id=$1) AND status <> 'CANCELLED'`, [id, itemStatus]);
      await this.events.emit(q, { type: 'KitchenTicketChanged', branchId: k.branch_id, payload: { ticketId: id, orderId: k.order_id, status: to, station: k.station_key } });
      if (to === 'READY') {
        const o = (await q.query('SELECT number, table_id, waiter_id FROM orders WHERE id=$1', [k.order_id])).rows[0];
        await this.events.emit(q, { type: 'OrderItemsReady', branchId: k.branch_id, payload: { orderId: k.order_id, number: o.number, station: k.station_key, waiterId: o.waiter_id } });
      }
      return (await q.query('SELECT id, status, started_at AS "startedAt", ready_at AS "readyAt", delivered_at AS "deliveredAt" FROM kitchen_orders WHERE id=$1', [id])).rows[0];
    });
  }

  /** Dashboard de cocina: pendientes, tiempo promedio, más antiguo, retrasados, en preparación y rendimiento por estación. */
  async metrics(branchId: string) {
    const late = Number(await this.settings.get('kitchen.slaLateMin', branchId, 10)) * 60;
    return this.db.tx(async (q) => {
      const active = (await q.query(
        `SELECT count(*)::int AS pending, COALESCE(max(EXTRACT(EPOCH FROM (now()-created_at))),0)::int AS oldest,
                count(*) FILTER (WHERE EXTRACT(EPOCH FROM (now()-created_at)) >= $2)::int AS delayed
           FROM kitchen_orders WHERE branch_id=$1 AND status IN ('NEW','PREPARING')`, [branchId, late])).rows[0];
      const avg = (await q.query(
        `SELECT COALESCE(avg(EXTRACT(EPOCH FROM (ready_at - created_at))),0)::int AS avg FROM kitchen_orders WHERE branch_id=$1 AND ready_at IS NOT NULL AND created_at > now() - interval '24 hours'`, [branchId])).rows[0];
      const inPrep = (await q.query(
        `SELECT i.name, sum(i.qty)::int AS qty FROM kitchen_order_items i JOIN kitchen_orders ko ON ko.id = i.kitchen_order_id
          WHERE ko.branch_id=$1 AND ko.status='PREPARING' GROUP BY i.name ORDER BY qty DESC`, [branchId])).rows;
      const perStation = (await q.query(
        `SELECT station_key AS station, count(*) FILTER (WHERE status IN ('NEW','PREPARING'))::int AS pending,
                count(*) FILTER (WHERE ready_at IS NOT NULL AND created_at > now() - interval '24 hours')::int AS completed,
                COALESCE(avg(EXTRACT(EPOCH FROM (ready_at - created_at))) FILTER (WHERE ready_at IS NOT NULL AND created_at > now() - interval '24 hours'),0)::int AS "avgSeconds"
           FROM kitchen_orders WHERE branch_id=$1 AND status <> 'CANCELLED' GROUP BY station_key ORDER BY station_key`, [branchId])).rows;
      return { pending: active.pending, oldestSeconds: active.oldest, delayed: active.delayed, avgSeconds: avg.avg, inPreparation: inPrep, perStation };
    });
  }
}
