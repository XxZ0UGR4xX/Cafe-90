import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { DbService, Tx } from '../../database/db.service';
import { AppError, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { hashSecret } from '../identity/passwords';
import { randomBytes } from 'node:crypto';
import { Principal } from '../identity/principal';
import { CatalogService } from '../catalog/catalog.service';
import { DeliveryService } from '../delivery/delivery.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PromotionsService } from '../promotions/promotions.service';
import { ReservationsService } from '../reservations/reservations.service';
import { SalesService } from '../sales/sales.service';
import { SettingsService } from '../tenancy/settings.service';
import { DomainEvents } from '../../common/domain-events';

type Dict = Record<string, any>;
const PUBLIC_PERMS = ['sales.order.create', 'sales.order.update', 'sales.order.read', 'sales.order.readAll', 'floor.table.operate', 'catalog.product.read', 'delivery.order.write', 'floor.reservation.write', 'floor.reservation.read', 'fiscal.invoice.issue'];

/**
 * Superficie pública (clientes): menú, pedidos para llevar/domicilio, reservaciones, QR de mesa y puntos.
 * Opera con un usuario de sistema por tenant (sin login) y permisos mínimos; nunca expone costos ni datos de otros clientes.
 */
@Injectable()
export class PublicService {
  constructor(private readonly db: DbService, private readonly sales: SalesService, private readonly catalog: CatalogService, private readonly delivery: DeliveryService,
    private readonly reservations: ReservationsService, private readonly notifications: NotificationsService, private readonly promos: PromotionsService, private readonly settings: SettingsService,
    private readonly events: DomainEvents, @Inject(ENV) _env: Env) {}

  /** Resuelve el tenant por slug y fija el contexto (tenant + principal de sistema) para el resto de la request. */
  async enter(slug: string): Promise<string> {
    const tenantId = (await this.db.system<{ t: string | null }>('SELECT resolve_tenant($1) AS t', [slug])).rows[0]?.t;
    if (!tenantId) throw notFound('restaurant');
    const sys = await this.db.tx(async (q) => {
      const ex = (await q.query(`SELECT id FROM users WHERE is_system AND email = 'system.public@internal.invalid'`)).rows[0];
      if (ex) return ex.id as string;
      return (await q.query(`INSERT INTO users (tenant_id, email, full_name, password_hash, status, is_system) VALUES (app_tenant_id(),'system.public@internal.invalid','Pedidos en línea',$1,'DISABLED',true) RETURNING id`,
        [await hashSecret(randomBytes(32).toString('hex'))])).rows[0].id as string;
    }, tenantId);
    const store = ctx();
    store.tenantId = tenantId;
    store.principal = Principal.system(sys, tenantId, 'Pedidos en línea', PUBLIC_PERMS);
    return tenantId;
  }

  info() {
    return this.db.tx(async (q) => {
      const r = (await q.query('SELECT name, currency, locale, timezone FROM restaurants LIMIT 1')).rows[0];
      const branches = (await q.query(`SELECT id, name, code, address, phone, status, opening_hours AS "openingHours" FROM branches WHERE deleted_at IS NULL ORDER BY name`)).rows;
      const loyalty = (await q.query(`SELECT currency_per_point AS "currencyPerPoint", levels FROM loyalty_programs WHERE is_active`)).rows[0] ?? null;
      const rewards = (await q.query(`SELECT name, points_cost AS "pointsCost" FROM loyalty_rewards WHERE is_active ORDER BY points_cost`)).rows;
      return { restaurant: r, branches, loyalty, rewards };
    });
  }

  async menu(branchId: string) {
    const [menu, promotions] = await Promise.all([this.catalog.menu(branchId), this.promos.listActive(branchId)]);
    return { ...menu, promotions: promotions.filter((p) => p.type !== 'COUPON').map((p) => ({ id: p.id, name: p.name, type: p.type, schedule: p.schedule })) };
  }

  private async customerByPhone(q: Tx, name: string, phone: string, email?: string) {
    const ex = (await q.query('SELECT id FROM customers WHERE phone=$1 AND deleted_at IS NULL', [phone])).rows[0];
    if (ex) return ex.id as string;
    return (await q.query(`INSERT INTO customers (tenant_id, name, phone, email) VALUES (app_tenant_id(),$1,$2,$3) RETURNING id`, [name, phone, email ?? null])).rows[0].id as string;
  }

  /** Pedido en línea: para recoger o a domicilio. Queda PENDIENTE hasta que el restaurante lo confirme. */
  async createOrder(d: Dict) {
    return this.db.tx(async (q) => {
      const customerId = await this.customerByPhone(q, d.customer.name, d.customer.phone, d.customer.email);
      let orderId: string;
      if (d.type === 'DELIVERY') {
        if (!d.address) throw new AppError('VALIDATION_ERROR', 400, { field: 'address' });
        const fee = Number(await this.settings.get('delivery.fee', d.branchId, 30));
        const del = await this.delivery.create({ branchId: d.branchId, customerId, customerName: d.customer.name, phone: d.customer.phone, address: d.address, addressNotes: d.addressNotes,
          fee, paymentMethod: d.paymentMethod ?? 'CASH', notes: d.notes, items: d.items, source: 'PUBLIC' });
        orderId = del.orderId;
      } else {
        const o = await this.sales.create({ branchId: d.branchId, channel: 'TAKEAWAY', customerId, customerName: d.customer.name, notes: d.notes, items: d.items, source: 'PUBLIC' });
        orderId = o.id;
      }
      if (d.couponCode) { await this.promos.setCoupon(q, orderId, d.couponCode, true); await this.sales.recalc(q, orderId); }
      const o = (await q.query('SELECT number, total FROM orders WHERE id=$1', [orderId])).rows[0];
      await this.notifications.emit(q, { type: 'ONLINE_ORDER', severity: 'INFO', branchId: d.branchId, title: `🛵 Nuevo pedido en línea #${o.number}`, body: `${d.customer.name} · ${d.type === 'DELIVERY' ? 'a domicilio' : 'para recoger'} · $${o.total}`, dedupeKey: `online:${orderId}` });
      await this.events.emit(q, { type: 'Notification', branchId: d.branchId, payload: { kind: 'ONLINE_ORDER', orderId } });
      return { orderId, number: o.number, total: o.total, status: 'PENDING' };
    });
  }

  /** Seguimiento del pedido (el id UUID funciona como token no adivinable). */
  async orderStatus(id: string) {
    return this.db.tx(async (q) => {
      const o = (await q.query(`SELECT o.id, o.number, o.status, o.payment_status AS "paymentStatus", o.total, o.channel, d.status AS "deliveryStatus", d.eta_at AS "etaAt",
        (SELECT json_agg(json_build_object('station', ko.station_key, 'status', ko.status)) FROM kitchen_orders ko WHERE ko.order_id = o.id AND ko.status <> 'CANCELLED') AS kitchen
        FROM orders o LEFT JOIN delivery_orders d ON d.order_id = o.id WHERE o.id=$1 AND o.source IN ('PUBLIC','QR')`, [id])).rows[0];
      if (!o) throw notFound('order');
      return o;
    });
  }

  createReservation(d: Dict) { return this.reservations.create({ ...d, customerId: undefined }, 'PUBLIC'); }
  availability(d: Dict) { return this.reservations.availability(d.branchId, d.startsAt, d.partySize, d.durationMin); }

  /** Puntos del cliente: se exige teléfono Y correo registrados (evita consulta con un solo dato adivinable). */
  async loyalty(phone: string, email: string) {
    return this.db.tx(async (q) => {
      const c = (await q.query(`SELECT c.id, c.name FROM customers c WHERE c.phone=$1 AND lower(c.email)=lower($2) AND c.deleted_at IS NULL`, [phone, email])).rows[0];
      if (!c) throw new AppError('NOT_FOUND', 404, undefined, false, '⭐ No encontramos una cuenta con esos datos.');
      const a = (await q.query(`SELECT balance, lifetime_points AS "lifetimePoints", level FROM loyalty_accounts WHERE customer_id=$1`, [c.id])).rows[0] ?? { balance: 0, lifetimePoints: 0, level: 'BRONCE' };
      const rewards = (await q.query(`SELECT name, points_cost AS "pointsCost" FROM loyalty_rewards WHERE is_active ORDER BY points_cost`)).rows;
      return { name: c.name, ...a, rewards };
    });
  }

  // ───────── QR de mesa ─────────
  private async tableByToken(q: Tx, token: string) {
    const t = (await q.query(`SELECT t.id, t.number, t.branch_id AS "branchId", t.status, b.name AS branch FROM tables t JOIN branches b ON b.id = t.branch_id WHERE t.qr_token=$1 AND t.is_active`, [token])).rows[0];
    if (!t) throw notFound('table');
    return t;
  }
  async qrTable(token: string) {
    const t = await this.db.tx((q) => this.tableByToken(q, token));
    return { table: { number: t.number, branch: t.branch, branchId: t.branchId }, menu: await this.menu(t.branchId) };
  }
  async qrOrder(token: string, d: Dict) {
    const t = await this.db.tx((q) => this.tableByToken(q, token));
    return this.db.tx(async (q) => {
      const auto = (await this.settings.get('qr.autoSend', t.branchId, false)) === true;
      const o = await this.sales.create({ branchId: t.branchId, channel: 'QR', tableId: t.id, customerName: d.customerName, notes: d.notes, items: d.items, send: auto, source: 'QR', guests: 1 });
      await this.notifications.emit(q, { type: 'QR_ORDER', severity: 'INFO', branchId: t.branchId, title: `📱 Pedido QR · Mesa ${t.number}`, body: `Orden #${o.number} ${auto ? 'enviada a cocina' : 'por confirmar'}`, dedupeKey: `qr:${o.id}` });
      await this.events.emit(q, { type: 'Notification', branchId: t.branchId, payload: { kind: 'QR_ORDER', orderId: o.id, tableNumber: t.number } });
      return { orderId: o.id, number: o.number, total: o.total, status: o.status, confirmed: auto };
    });
  }
  async qrCall(token: string, kind: 'WAITER' | 'BILL') {
    const t = await this.db.tx((q) => this.tableByToken(q, token));
    return this.db.tx(async (q) => {
      const bucket = Math.floor(Date.now() / 120_000);   // evita spam: 1 aviso cada 2 min por mesa y tipo
      await this.notifications.emit(q, { type: kind === 'WAITER' ? 'CALL_WAITER' : 'REQUEST_BILL', severity: 'WARNING', branchId: t.branchId,
        title: kind === 'WAITER' ? `🙋 Mesa ${t.number} solicita mesero` : `🧾 Mesa ${t.number} pide la cuenta`, dedupeKey: `qr-${kind}:${t.id}:${bucket}` });
      await this.events.emit(q, { type: 'Notification', branchId: t.branchId, payload: { kind, tableNumber: t.number } });
      return { sent: true };
    });
  }
  async qrBill(token: string) {
    const t = await this.db.tx((q) => this.tableByToken(q, token));
    return this.db.tx(async (q) => {
      const orders = (await q.query(`SELECT o.id, o.number, o.status, o.total, o.paid_total AS "paidTotal" FROM orders o JOIN table_sessions s ON s.id = o.table_session_id AND s.status='OPEN' WHERE s.table_id=$1 AND o.status <> 'CANCELLED'`, [t.id])).rows;
      return { table: t.number, orders, total: orders.reduce((a, o) => a + o.total, 0), paid: orders.reduce((a, o) => a + o.paidTotal, 0) };
    });
  }
}
