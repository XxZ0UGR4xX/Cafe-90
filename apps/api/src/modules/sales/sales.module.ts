import { Global, Module, OnModuleInit } from '@nestjs/common';
import { DomainEvents } from '../../common/domain-events';
import { LineBuilder } from './sales.lines';
import { PaymentsService } from './payments.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Global()
@Module({ controllers: [SalesController], providers: [SalesService, PaymentsService, LineBuilder], exports: [SalesService, PaymentsService] })
export class SalesModule implements OnModuleInit {
  constructor(private readonly events: DomainEvents, private readonly sales: SalesService) {}

  /** Sincroniza el estado de la orden con el avance de la cocina (sin acoplar módulos). */
  onModuleInit() {
    this.events.on('KitchenTicketChanged', async (q, e) => {
      const { orderId } = e.payload as { orderId: string };
      const tickets = (await q.query(`SELECT status FROM kitchen_orders WHERE order_id=$1 AND status <> 'CANCELLED'`, [orderId])).rows.map((r) => r.status as string);
      if (!tickets.length) return;
      const o = await this.sales.lockOrder(q, orderId);
      if (['CANCELLED', 'COMPLETED'].includes(o.status)) return;
      const pendingItems = (await q.query(`SELECT 1 FROM order_items WHERE order_id=$1 AND status='PENDING'`, [orderId])).rowCount;
      let to = o.status;
      if (tickets.every((s) => s === 'DELIVERED')) to = 'DELIVERED';
      else if (tickets.every((s) => s === 'READY' || s === 'DELIVERED')) to = 'READY';
      else if (tickets.some((s) => s !== 'NEW')) to = 'PREPARING';
      else to = 'CONFIRMED';
      if (pendingItems && (to === 'READY' || to === 'DELIVERED')) to = 'PREPARING';   // aún hay productos por enviar
      if (to !== o.status) await this.sales.setStatus(q, o, to, { force: true });
      if (to === 'DELIVERED') {
        await q.query(`UPDATE order_items SET status='DELIVERED' WHERE order_id=$1 AND status IN ('SENT','PREPARING','READY')`, [orderId]);
        await this.sales.maybeComplete(q, orderId);
      }
    });
  }
}
