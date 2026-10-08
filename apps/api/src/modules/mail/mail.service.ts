import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { DbService, Tx } from '../../database/db.service';
import { ctx } from '../../common/request-context';
import type { MailTransport } from './mail.transport';
import { MetricsService } from '../metrics/metrics.service';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
export interface OutgoingMail {
  to: string | string[]; subject: string; text: string; html?: string; kind?: string; dedupeKey?: string;
  attachments?: { filename: string; contentType: string; content: string }[];
}
const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [1, 5, 15, 60, 180];   // minutos tras cada fallo
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Correo saliente con cola durable: `enqueue` escribe en la MISMA transacción del negocio (si ésta hace rollback, no sale correo)
 * y `flush` envía fuera de transacción con reintentos y espera creciente. Varias instancias pueden correr `flush` a la vez
 * (reclamo con FOR UPDATE SKIP LOCKED + estado SENDING; un envío colgado se reclama a los 5 min).
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  constructor(private readonly db: DbService, @Inject(MAIL_TRANSPORT) readonly transport: MailTransport, @Inject(ENV) private readonly env: Env, private readonly metrics: MetricsService) {}

  /** Direcciones inválidas se descartan; sin destinatarios válidos no se encola nada. Devuelve true si se encoló. */
  async enqueue(q: Tx, m: OutgoingMail): Promise<boolean> {
    const to = [...new Set((Array.isArray(m.to) ? m.to : [m.to]).map((x) => x.trim().toLowerCase()).filter((x) => EMAIL.test(x)))].slice(0, 20);
    if (!to.length) return false;
    const r = await q.query(
      `INSERT INTO email_outbox (tenant_id, to_addrs, subject, body_text, body_html, attachments, kind, dedupe_key)
       VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [to, m.subject.slice(0, 200), m.text, m.html ?? null, JSON.stringify(m.attachments ?? []), m.kind ?? 'GENERIC', m.dedupeKey ?? null]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Plantilla mínima con la identidad retro (HTML simple y compatible con clientes de correo). */
  static html(title: string, lines: string[]): string {
    return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border:3px solid #111;border-radius:8px;overflow:hidden">
<div style="background:#d62828;color:#fff;padding:14px 18px;font-size:20px;font-weight:bold">🍔 AMERIX BURGER</div>
<div style="padding:18px"><h2 style="margin:0 0 12px">${esc(title)}</h2>${lines.map((l) => `<p style="margin:8px 0">${esc(l)}</p>`).join('')}</div>
<div style="background:#f6b800;height:6px"></div></div>`;
  }

  /** Envía lo pendiente del tenant actual (hasta `limit`). Devuelve cuántos se enviaron. */
  async flush(limit = 20): Promise<{ sent: number; failed: number }> {
    const claimed = await this.db.tx(async (q) => (await q.query(
      `UPDATE email_outbox SET status='SENDING', claimed_at=now()
        WHERE id IN (SELECT id FROM email_outbox
                      WHERE (status='PENDING' AND next_attempt_at <= now()) OR (status='SENDING' AND claimed_at < now() - interval '5 minutes')
                      ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id, to_addrs, subject, body_text, body_html, attachments, attempts`, [limit])).rows);
    let sent = 0, failed = 0;
    for (const e of claimed) {
      try {
        await this.transport.send({ from: this.env.MAIL_FROM, to: e.to_addrs, subject: e.subject, text: e.body_text, html: e.body_html ?? undefined, attachments: e.attachments });
        await this.db.tx((q) => q.query(`UPDATE email_outbox SET status='SENT', sent_at=now(), attempts=attempts+1, last_error=NULL WHERE id=$1`, [e.id]));
        sent++; this.metrics.mailSent.inc();
      } catch (err) {
        failed++; this.metrics.mailFailed.inc(); const n = e.attempts + 1; const dead = n >= MAX_ATTEMPTS;
        this.log.warn(`correo ${e.id} falló (${n}/${MAX_ATTEMPTS}): ${(err as Error).message}`);
        await this.db.tx((q) => q.query(
          `UPDATE email_outbox SET status=$2, attempts=$3, last_error=$4, next_attempt_at = now() + ($5 || ' minutes')::interval WHERE id=$1`,
          [e.id, dead ? 'FAILED' : 'PENDING', n, (err as Error).message.slice(0, 300), String(BACKOFF_MIN[Math.min(n - 1, BACKOFF_MIN.length - 1)])]));
      }
    }
    return { sent, failed };
  }

  outbox(status?: string, limit = 50) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT id, to_addrs AS "to", subject, kind, status, attempts, last_error AS "lastError", created_at AS "createdAt", sent_at AS "sentAt"
         FROM email_outbox WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2`, [status ?? null, limit])).rows);
  }

  /** Correo de prueba inmediato (para verificar la configuración SMTP). */
  async sendTest(to: string) {
    await this.db.tx((q) => this.enqueue(q, { to, subject: '✅ Prueba de correo · Amerix Burger', kind: 'TEST', text: 'Si lees esto, el correo saliente funciona.',
      html: MailService.html('Prueba de correo', ['Si lees esto, el correo saliente de Amerix Burger funciona.', `Enviado por ${ctx().principal?.fullName ?? 'el sistema'}.`]) }));
    return { ...(await this.flush()), transport: this.transport.kind };
  }
}
