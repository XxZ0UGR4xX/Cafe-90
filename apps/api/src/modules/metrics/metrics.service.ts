import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { DbService } from '../../database/db.service';

/**
 * Métricas técnicas para Prometheus (formato texto). Sólo agregados: sin etiquetas con datos de clientes ni de tenants.
 * Las rutas se etiquetan con la PLANTILLA (`/orders/:id`), nunca con la URL real (cardinalidad acotada y sin identificadores).
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly http: Histogram<'method' | 'route' | 'status'>;
  readonly mailSent: Counter; readonly mailFailed: Counter;
  readonly invoices: Counter<'result'>;
  readonly jobRun: Gauge<'job'>;
  readonly loginFailures: Counter;

  constructor(db: DbService) {
    this.registry.setDefaultLabels({ app: 'retroburger-api' });
    collectDefaultMetrics({ register: this.registry, prefix: 'rb_' });
    this.http = new Histogram({ name: 'rb_http_request_duration_seconds', help: 'Duración de las peticiones HTTP', labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], registers: [this.registry] });
    this.mailSent = new Counter({ name: 'rb_mail_sent_total', help: 'Correos enviados', registers: [this.registry] });
    this.mailFailed = new Counter({ name: 'rb_mail_failed_total', help: 'Intentos de envío de correo fallidos', registers: [this.registry] });
    this.invoices = new Counter({ name: 'rb_invoices_total', help: 'Facturas procesadas por resultado', labelNames: ['result'], registers: [this.registry] });
    this.loginFailures = new Counter({ name: 'rb_login_failures_total', help: 'Inicios de sesión fallidos', registers: [this.registry] });
    this.jobRun = new Gauge({ name: 'rb_job_last_run_timestamp_seconds', help: 'Última ejecución de cada tarea periódica', labelNames: ['job'], registers: [this.registry] });
    new Gauge({ name: 'rb_db_pool_connections', help: 'Conexiones del pool de PostgreSQL por estado', labelNames: ['state'], registers: [this.registry],
      collect() { this.set({ state: 'total' }, db.pool.totalCount); this.set({ state: 'idle' }, db.pool.idleCount); this.set({ state: 'waiting' }, db.pool.waitingCount); } });
  }

  observeRequest(method: string, route: string | undefined, status: number, seconds: number) {
    this.http.observe({ method, route: route ?? 'no_route', status: String(status) }, seconds);
  }
  render() { return this.registry.metrics(); }
}
