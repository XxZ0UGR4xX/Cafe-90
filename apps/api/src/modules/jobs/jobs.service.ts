import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { DbService } from '../../database/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReconciliationService } from '../inventory/reconciliation.service';
import { MailService } from '../mail/mail.service';
import { requestContext } from '../../common/request-context';
import { MetricsService } from '../metrics/metrics.service';

/** Tareas periódicas por tenant: alertas de reservación, corte pendiente, pedidos retrasados y caducidades. */
@Injectable()
export class JobsService implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger('Jobs');
  constructor(private readonly db: DbService, private readonly notifications: NotificationsService, private readonly recon: ReconciliationService, private readonly mail: MailService, private readonly metrics: MetricsService, @Inject(ENV) private readonly env: Env) {}

  onModuleInit() {
    if (this.env.JOBS_ENABLED === 'true' && this.env.NODE_ENV !== 'test') {
      this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.error(e)), 60_000);
      this.timer.unref();
    }
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }

  async runOnce(): Promise<{ tenants: number; notifications: number }> {
    const tenants = (await this.db.system<{ id: string }>('SELECT list_active_tenants() AS id')).rows.map((r) => r.id);
    let n = 0;
    for (const t of tenants) {
      n += await this.db.tx((q) => this.forTenant(q), t);
      // correo saliente: fuera de transacción (la llamada SMTP no debe retener bloqueos)
      await requestContext.run({ tenantId: t }, () => this.mail.flush()).catch((e) => this.log.error(e));
      // conciliación nocturna (≈ 03:00 hora de México = 09:00 UTC); una vez por día y tenant aunque haya varias instancias
      if (new Date().getUTCHours() === 9) await this.nightly(t).catch((e) => this.log.error(e));
    }
    this.metrics.jobRun.set({ job: 'periodic' }, Date.now() / 1000);
    return { tenants: tenants.length, notifications: n };
  }

  /** Tareas diarias de un tenant. Idempotente: `job_runs` reclama el día con INSERT … ON CONFLICT DO NOTHING. */
  async nightly(tenantId: string, force = false): Promise<{ ran: boolean; findings: number }> {
    return this.db.tx(async (q) => {
      const day = new Date().toISOString().slice(0, 10);
      const claimed = (await q.query(
        `INSERT INTO job_runs (tenant_id, job, run_on) VALUES (app_tenant_id(), 'inventory.reconcile', $1::date)
         ON CONFLICT (tenant_id, job, run_on) DO ${force ? "UPDATE SET started_at = now(), finished_at = NULL" : 'NOTHING'} RETURNING 1`, [day])).rowCount;
      if (!claimed) return { ran: false, findings: 0 };
      const findings = await this.recon.check(q);
      for (const f of findings.filter((x) => x.kind !== 'NEGATIVE_STOCK'))
        await this.notifications.emit(q, { type: 'INVENTORY_INTEGRITY', severity: f.severity, branchId: f.branchId,
          title: `🧮 Inventario descuadrado: ${f.ingredient}`, body: f.detail, payload: f, dedupeKey: `recon:${f.kind}:${f.branchId}:${f.ingredientId}:${day}` });
      await q.query(`UPDATE job_runs SET finished_at = now(), result = $1 WHERE job = 'inventory.reconcile' AND run_on = $2::date`,
        [JSON.stringify({ findings: findings.length, critical: findings.filter((f) => f.severity === 'CRITICAL').length }), day]);
      this.metrics.jobRun.set({ job: 'inventory.reconcile' }, Date.now() / 1000);
      return { ran: true, findings: findings.length };
    }, tenantId);
  }

  private async forTenant(q: import('../../database/db.service').Tx): Promise<number> {
    let n = 0;
    const emit = async (...a: Parameters<NotificationsService['emit']>) => { await this.notifications.emit(...a); n++; };
    for (const r of (await q.query(`SELECT r.id, r.branch_id, r.customer_name, r.party_size, r.starts_at, t.number AS tnum FROM reservations r LEFT JOIN tables t ON t.id = r.table_id
        WHERE r.status IN ('PENDING','CONFIRMED') AND r.starts_at BETWEEN now() AND now() + interval '30 minutes'`)).rows)
      await emit(q, { type: 'RESERVATION_SOON', severity: 'INFO', branchId: r.branch_id, title: `📅 Reservación próxima: ${r.customer_name} (${r.party_size})`, body: r.tnum ? `Mesa ${r.tnum}` : undefined, dedupeKey: `res:${r.id}` });
    for (const s of (await q.query(`SELECT id, branch_id, opened_at FROM cash_shifts WHERE status='OPEN' AND opened_at < now() - interval '14 hours'`)).rows)
      await emit(q, { type: 'SHIFT_PENDING', severity: 'WARNING', branchId: s.branch_id, title: '💰 Corte de caja pendiente', body: 'Hay un turno abierto por más de 14 horas.', dedupeKey: `shift-open:${s.id}:${new Date().toISOString().slice(0, 10)}` });
    for (const k of (await q.query(`SELECT ko.id, ko.branch_id, o.number, ko.station_key FROM kitchen_orders ko JOIN orders o ON o.id = ko.order_id WHERE ko.status IN ('NEW','PREPARING') AND ko.created_at < now() - interval '10 minutes'`)).rows)
      await emit(q, { type: 'ORDER_DELAYED', severity: 'WARNING', branchId: k.branch_id, title: `🍔 Pedido retrasado #${k.number} (${k.station_key})`, dedupeKey: `late:${k.id}` });
    for (const l of (await q.query(`SELECT l.id, l.branch_id, i.name, l.expires_on FROM inventory_lots l JOIN ingredients i ON i.id = l.ingredient_id WHERE l.qty_remaining > 0 AND l.expires_on IS NOT NULL AND l.expires_on <= tenant_today() + 3`)).rows)
      await emit(q, { type: 'EXPIRING', severity: 'WARNING', branchId: l.branch_id, title: `⏳ Por caducar: ${l.name}`, body: `Caduca ${new Date(l.expires_on).toISOString().slice(0, 10)}`, dedupeKey: `exp:${l.id}` });
    return n;
  }
}
