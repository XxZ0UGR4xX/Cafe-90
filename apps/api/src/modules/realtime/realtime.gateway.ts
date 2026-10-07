import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { REDIS, type RedisClient } from '../../infra/redis.module';
import type { Server, Socket } from 'socket.io';
import { ENV, type Env } from '../../config/env';
import { DomainEvent, DomainEvents } from '../../common/domain-events';
import { PrincipalRepository } from '../identity/principal.repository';
import { verifyAccess } from '../identity/tokens';

/** Eventos que se retransmiten a los clientes (KDS, mesas, POS). Los clientes refrescan por REST: el payload es mínimo. */
const RELAYED = new Set(['OrderCreated', 'OrderSent', 'OrderStatusChanged', 'OrderCancelled', 'PaymentReceived', 'OrderPaid', 'KitchenChanged',
  'KitchenTicketChanged', 'OrderItemsReady', 'TableChanged', 'Notification', 'DeliveryChanged', 'ReservationChanged']);

export const roomOf = (tenantId: string, branchId: string) => `t:${tenantId}:b:${branchId}`;

/**
 * Gateway Socket.IO. Autenticación por JWT en el handshake (`auth.token`); cada socket se une SÓLO a las salas
 * de las sucursales a las que su rol da acceso (aislamiento por tenant y sucursal).
 */
@Injectable()
@WebSocketGateway({ cors: { origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((o) => o.trim()), credentials: true }, path: '/ws' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayInit, OnModuleInit, OnApplicationShutdown {
  @WebSocketServer() server!: Server;

  constructor(private readonly events: DomainEvents, private readonly principals: PrincipalRepository, @Inject(ENV) private readonly env: Env, @Inject(REDIS) private readonly redis: RedisClient) {}

  /** Con Redis, las salas y emisiones cruzan réplicas: un evento originado en la instancia A llega a los sockets conectados a la B. */
  afterInit(server: Server) {
    if (this.redis) server.adapter(createAdapter(this.redis.duplicate(), this.redis.duplicate()));
  }

  private sweep?: NodeJS.Timeout;
  onApplicationShutdown() { if (this.sweep) clearInterval(this.sweep); }

  onModuleInit() {
    // Revalida las sesiones de los sockets abiertos: logout, usuario deshabilitado, tenant suspendido o cambio de roles los desconecta
    this.sweep = setInterval(() => void this.revalidate().catch(() => undefined), 60_000);
    this.sweep.unref();
    this.events.onCommitted((e: DomainEvent) => {
      if (!RELAYED.has(e.type) || !e.tenantId || !this.server) return;
      const room = e.branchId ? roomOf(e.tenantId, e.branchId) : `t:${e.tenantId}`;
      this.server.to(room).emit(e.type, { ...e.payload, branchId: e.branchId });
    });
  }

  async handleConnection(socket: Socket) {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) ?? '';
      const claims = await verifyAccess(token, this.env.JWT_ACCESS_SECRET);
      const principal = await this.principals.load(claims.sub, claims.tid, claims.sid);
      if (!principal) throw new Error('no principal');
      socket.data.claims = claims;
      await socket.join(`t:${claims.tid}`);
      const branches = await this.branchIds(claims.tid, principal);
      for (const b of branches) await socket.join(roomOf(claims.tid, b));
      socket.emit('ready', { branches });
    } catch {
      socket.emit('error', { code: 'UNAUTHENTICATED' });
      socket.disconnect(true);
    }
  }

  /** Desconecta los sockets cuya sesión ya no es válida. Público para pruebas. */
  async revalidate(): Promise<number> {
    let dropped = 0;
    for (const socket of this.server?.sockets.sockets.values() ?? []) {
      const c = socket.data.claims as { sub: string; tid: string; sid: string } | undefined;
      if (!c) continue;
      if (!(await this.principals.load(c.sub, c.tid, c.sid))) { socket.emit('error', { code: 'UNAUTHENTICATED' }); socket.disconnect(true); dropped++; }
    }
    return dropped;
  }

  private async branchIds(tenantId: string, principal: import('../identity/principal').Principal): Promise<string[]> {
    const scoped = principal.grants.filter((g) => g.branchId).map((g) => g.branchId!);
    if (!principal.isCorporate) return [...new Set(scoped)];
    return this.principals.branchIds(tenantId);
  }
}
