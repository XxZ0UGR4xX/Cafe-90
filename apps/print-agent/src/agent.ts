import type { AgentApi, PrintJob, PrinterInfo } from './client';
import { encodeJob, optionsFor } from './escpos';
import { PrinterOfflineError, type Transport, transportFor } from './transport';

export interface AgentOptions {
  branchId: string; pollMs: number;
  /** Para pruebas: fábrica de transportes. */
  transport?: (connection: Record<string, unknown>) => Transport | null;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** Espera máxima entre reintentos de una impresora sin conexión. */
  maxBackoffMs?: number;
}

/**
 * Bucle del agente: por cada impresora activa de la sucursal toma sus trabajos pendientes EN ORDEN, los codifica y los envía.
 *  - Éxito → ack(ok). Impresora sin conexión → el trabajo sigue PENDIENTE (no se confirma ni gasta intentos) y la impresora entra en espera exponencial.
 *  - Error no recuperable (p. ej. impresora sin transporte configurado) → ack(fail), que tras 3 intentos queda FAILED.
 *  - Entrega al menos una vez: si el agente se cae entre imprimir y confirmar, el trabajo puede imprimirse de nuevo.
 */
export class PrintAgent {
  private timer?: NodeJS.Timeout; private running = false; private stopped = false;
  private readonly backoff = new Map<string, { until: number; ms: number }>();
  private readonly log: NonNullable<AgentOptions['log']>;
  constructor(private readonly api: AgentApi, private readonly o: AgentOptions) { this.log = o.log ?? (() => undefined); }

  /** Una pasada completa; devuelve cuántos trabajos se imprimieron. Reentrante-seguro. */
  async tick(now = Date.now()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let printed = 0;
    try {
      const printers = (await this.api.printers(this.o.branchId)).filter((p) => p.isActive);
      for (const p of printers) {
        const b = this.backoff.get(p.id);
        if (b && b.until > now) continue;
        printed += await this.drain(p, now);
      }
    } catch (e) { this.log('error', `ciclo fallido: ${(e as Error).message}`); }
    finally { this.running = false; }
    return printed;
  }

  private async drain(p: PrinterInfo, now: number): Promise<number> {
    const jobs = await this.api.pending(p.id);
    if (!jobs.length) { this.backoff.delete(p.id); return 0; }
    const transport = (this.o.transport ?? transportFor)(p.connection);
    let n = 0;
    for (const j of jobs) {
      if (!transport) { await this.api.ack(j.id, false); this.log('error', `impresora «${p.name}» sin conexión configurada (connection.type)`); continue; }
      try {
        await transport.send(encodeJob(j.content, optionsFor(j.kind, p.connection)));
      } catch (e) {
        if (e instanceof PrinterOfflineError) {
          const prev = this.backoff.get(p.id)?.ms ?? 0; const ms = Math.min(prev ? prev * 2 : 2000, this.o.maxBackoffMs ?? 60_000);
          this.backoff.set(p.id, { until: now + ms, ms });
          this.log('warn', `impresora «${p.name}» sin conexión (${(e as Error).message}); reintento en ${ms / 1000}s`);
          return n;   // se conserva el orden: no se salta al siguiente trabajo
        }
        await this.api.ack(j.id, false); this.log('error', `trabajo ${j.id} falló: ${(e as Error).message}`); continue;
      }
      await this.api.ack(j.id, true); n++; this.backoff.delete(p.id);
      this.log('info', `impreso ${j.kind} en «${p.name}»`);
    }
    return n;
  }

  start() {
    const loop = async () => { if (this.stopped) return; await this.tick(); this.timer = setTimeout(loop, this.o.pollMs); };
    void loop();
  }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
}
export type { PrintJob };
