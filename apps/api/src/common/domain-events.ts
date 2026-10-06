import { EventEmitter } from 'node:events';
import { Global, Injectable, Module } from '@nestjs/common';
import { Tx } from '../database/db.service';
import { ctx } from './request-context';

export interface DomainEvent<T = any> { type: string; tenantId?: string; branchId?: string | null; payload: T }
type Handler = (q: Tx, e: DomainEvent) => Promise<void>;

/**
 * Bus de eventos de dominio.
 *  - `emit` escribe en `domain_outbox` (transaccional) y ejecuta handlers síncronos EN LA MISMA transacción
 *    (lealtad, estadísticas de cliente, etc. → consistencia fuerte).
 *  - Los suscriptores `onCommitted` (WebSocket, notificaciones push) reciben el evento SOLO tras el COMMIT.
 */
@Injectable()
export class DomainEvents {
  private handlers = new Map<string, Handler[]>();
  private readonly committed = new EventEmitter();

  on(type: string, h: Handler) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), h]); }
  onCommitted(listener: (e: DomainEvent) => void) { this.committed.on('event', listener); }

  async emit(q: Tx, e: DomainEvent): Promise<void> {
    const c = ctx();
    await q.query(`INSERT INTO domain_outbox (tenant_id, branch_id, type, payload) VALUES (app_tenant_id(), $1, $2, $3)`,
      [e.branchId ?? null, e.type, JSON.stringify(e.payload)]);
    for (const h of this.handlers.get(e.type) ?? []) await h(q, e);
    const full = { ...e, tenantId: c.tenantId };
    c.afterCommit?.push(() => this.committed.emit('event', full));
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class EventsModule {}
