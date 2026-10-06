import { Injectable } from '@nestjs/common';
import { inventoryStatus } from '@retroburger/shared';
import { DbService, Tx } from '../../database/db.service';
import { AppError, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { InventoryEngine } from './inventory.engine';

type Dict = Record<string, any>;

@Injectable()
export class InventoryService {
  constructor(private readonly db: DbService, private readonly engine: InventoryEngine, private readonly audit: AuditService) {}

  private assertBranch(perm: string, branchId: string) {
    if (!ctx().principal!.can(perm, branchId)) throw forbidden({ permission: perm, branchId });
  }

  // ───────── Consulta ─────────
  /** Existencias con estado semáforo. Sin branchId → todas las sucursales del alcance (vista corporativa). */
  async stock(branchId?: string, status?: string) {
    const scope = ctx().principal!.branchScope('inventory.stock.read');
    const cost = ctx().principal!.can('inventory.cost.read');
    return this.db.tx(async (q) => {
      const rows = (await q.query(
        `SELECT inv.branch_id AS "branchId", b.name AS "branchName", i.id AS "ingredientId", i.sku, i.name, i.unit, inv.qty,
                inv.min_qty AS "minQty", inv.max_qty AS "maxQty", inv.needs_review AS "needsReview", ${cost ? 'i.avg_cost' : 'NULL::numeric'} AS "avgCost"
           FROM inventory inv JOIN ingredients i ON i.id = inv.ingredient_id AND i.deleted_at IS NULL
           JOIN branches b ON b.id = inv.branch_id
          WHERE ($1::uuid IS NULL OR inv.branch_id = $1) AND ($2::uuid[] IS NULL OR inv.branch_id = ANY($2::uuid[]))
          ORDER BY b.name, i.name`, [branchId ?? null, scope])).rows;
      const out = rows.map((r) => ({ ...r, status: inventoryStatus(r.qty, r.minQty) }));
      return status ? out.filter((r) => r.status === status) : out;
    });
  }

  kardex(f: { branchId: string; ingredientId?: string; from?: string; to?: string; limit: number }) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT m.id, m.at, m.type, m.qty, m.unit_cost AS "unitCost", m.balance_after AS "balanceAfter", m.reason, m.ref_type AS "refType", m.ref_id AS "refId",
              i.name AS ingredient, i.unit, u.full_name AS "user"
         FROM inventory_movements m JOIN ingredients i ON i.id = m.ingredient_id LEFT JOIN users u ON u.id = m.user_id
        WHERE m.branch_id = $1 AND ($2::uuid IS NULL OR m.ingredient_id = $2) AND ($3::timestamptz IS NULL OR m.at >= $3) AND ($4::timestamptz IS NULL OR m.at <= $4)
        ORDER BY m.at DESC, m.id DESC LIMIT $5`, [f.branchId, f.ingredientId ?? null, f.from ?? null, f.to ?? null, f.limit])).rows);
  }

  expiring(branchId: string, days: number) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT l.id, i.name AS ingredient, i.unit, l.lot_code AS "lotCode", l.expires_on AS "expiresOn", l.qty_remaining AS qty,
              (l.expires_on - current_date) AS "daysLeft"
         FROM inventory_lots l JOIN ingredients i ON i.id = l.ingredient_id
        WHERE l.branch_id = $1 AND l.qty_remaining > 0 AND l.expires_on IS NOT NULL AND l.expires_on <= current_date + $2::int
        ORDER BY l.expires_on`, [branchId, days])).rows);
  }

  // ───────── Movimientos manuales ─────────
  async move(d: Dict) {
    this.assertBranch('inventory.movement.write', d.branchId);
    if (d.type === 'WASTE') this.assertBranch('inventory.waste.write', d.branchId);
    return this.db.tx(async (q) => {
      const res = await this.engine.apply(q, {
        branchId: d.branchId, ingredientId: d.ingredientId, type: d.type, qty: d.qty, unitCost: d.unitCost,
        lotCode: d.lotCode, expiresOn: d.expiresOn, reason: d.reason, refType: 'manual',
      });
      await this.audit.record(q, { action: `inventory.${String(d.type).toLowerCase()}`, entity: 'inventory', entityId: d.ingredientId,
        branchId: d.branchId, newValue: { qty: d.qty, balance: res.balance }, reason: d.reason });
      return res;
    });
  }

  setLevels(d: { branchId: string; ingredientId: string; minQty: number; maxQty: number }) {
    this.assertBranch('inventory.movement.write', d.branchId);
    if (d.maxQty < d.minQty) throw new AppError('VALIDATION_ERROR', 400, { field: 'maxQty' });
    return this.db.tx(async (q) => {
      await q.query(`INSERT INTO inventory (tenant_id, branch_id, ingredient_id, qty, min_qty, max_qty) VALUES (app_tenant_id(),$1,$2,0,$3,$4)
                     ON CONFLICT (branch_id, ingredient_id) DO UPDATE SET min_qty=$3, max_qty=$4`, [d.branchId, d.ingredientId, d.minQty, d.maxQty]);
      await this.audit.record(q, { action: 'inventory.levels', entity: 'inventory', entityId: d.ingredientId, branchId: d.branchId, newValue: d });
      return d;
    });
  }

  // ───────── Inventario físico ─────────
  createCount(d: { branchId: string; notes?: string }) {
    this.assertBranch('inventory.count.write', d.branchId);
    return this.db.tx(async (q) => {
      const id = (await q.query(`INSERT INTO stock_counts (tenant_id, branch_id, notes, created_by) VALUES (app_tenant_id(),$1,$2,$3) RETURNING id`,
        [d.branchId, d.notes ?? null, ctx().principal!.userId])).rows[0].id;
      await q.query(`INSERT INTO stock_count_items (tenant_id, count_id, ingredient_id, system_qty)
                     SELECT app_tenant_id(), $1, ingredient_id, qty FROM inventory WHERE branch_id = $2`, [id, d.branchId]);
      return this.getCount(q, id, true);
    });
  }

  private async getCount(q: Tx, id: string, blind: boolean) {
    const c = (await q.query('SELECT id, branch_id AS "branchId", status, notes, created_at AS "createdAt" FROM stock_counts WHERE id=$1', [id])).rows[0];
    if (!c) throw notFound('count');
    c.items = (await q.query(
      `SELECT ci.ingredient_id AS "ingredientId", i.name, i.unit, ${blind && c.status === 'OPEN' ? 'NULL::numeric' : 'ci.system_qty'} AS "systemQty", ci.counted_qty AS "countedQty"
         FROM stock_count_items ci JOIN ingredients i ON i.id = ci.ingredient_id WHERE ci.count_id = $1 ORDER BY i.name`, [id])).rows; // conteo ciego mientras está abierto
    return c;
  }

  getCountById(id: string) { return this.db.tx((q) => this.getCount(q, id, true)); }

  submitCount(id: string, items: { ingredientId: string; countedQty: number }[]) {
    return this.db.tx(async (q) => {
      const c = (await q.query('SELECT branch_id, status FROM stock_counts WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!c) throw notFound('count');
      this.assertBranch('inventory.count.write', c.branch_id);
      if (c.status !== 'OPEN') throw new AppError('CONFLICT', 409);
      for (const it of items)
        await q.query('UPDATE stock_count_items SET counted_qty = $3 WHERE count_id=$1 AND ingredient_id=$2', [id, it.ingredientId, it.countedQty]);
      return this.getCount(q, id, true);
    });
  }

  /** Aplica diferencias (conteo vs. sistema) como COUNT_ADJ. Requiere permiso de aprobación. */
  applyCount(id: string) {
    return this.db.tx(async (q) => {
      const c = (await q.query('SELECT branch_id, status FROM stock_counts WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!c) throw notFound('count');
      this.assertBranch('inventory.transfer.approve', c.branch_id);
      if (c.status !== 'OPEN') throw new AppError('CONFLICT', 409);
      const items = (await q.query(
        `SELECT ci.ingredient_id, ci.counted_qty, inv.qty AS current_qty FROM stock_count_items ci
           JOIN inventory inv ON inv.branch_id = $2 AND inv.ingredient_id = ci.ingredient_id
          WHERE ci.count_id = $1 AND ci.counted_qty IS NOT NULL ORDER BY ci.ingredient_id`, [id, c.branch_id])).rows;
      let adjusted = 0;
      for (const it of items) {
        const diff = Math.round((it.counted_qty - it.current_qty) * 10000) / 10000;
        if (diff === 0) continue;
        await this.engine.apply(q, { branchId: c.branch_id, ingredientId: it.ingredient_id, type: 'COUNT_ADJ', qty: diff, reason: `Inventario físico ${id.slice(0, 8)}`, refType: 'count', refId: id, allowNegative: true });
        adjusted++;
      }
      await q.query(`UPDATE stock_counts SET status='APPLIED', applied_by=$2, applied_at=now() WHERE id=$1`, [id, ctx().principal!.userId]);
      await q.query(`UPDATE inventory SET needs_review = false WHERE branch_id = $1 AND qty >= 0`, [c.branch_id]);
      await this.audit.record(q, { action: 'inventory.count_applied', entity: 'stock_count', entityId: id, branchId: c.branch_id, newValue: { adjusted } });
      return this.getCount(q, id, false);
    });
  }

  // ───────── Transferencias ─────────
  private async transferById(q: Tx, id: string, lock = false) {
    const t = (await q.query(`SELECT id, number, from_branch_id AS "fromBranchId", to_branch_id AS "toBranchId", status, notes, created_at AS "createdAt"
                               FROM stock_transfers WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
    if (!t) throw notFound('transfer');
    t.items = (await q.query(
      `SELECT ti.id, ti.ingredient_id AS "ingredientId", i.name, i.unit, ti.qty_requested AS "qtyRequested", ti.qty_sent AS "qtySent", ti.qty_received AS "qtyReceived"
         FROM stock_transfer_items ti JOIN ingredients i ON i.id = ti.ingredient_id WHERE ti.transfer_id=$1 ORDER BY i.name`, [id])).rows;
    return t;
  }

  listTransfers(branchId?: string) {
    const scope = ctx().principal!.branchScope('inventory.transfer.read');
    return this.db.tx(async (q) => (await q.query(
      `SELECT id, number, from_branch_id AS "fromBranchId", to_branch_id AS "toBranchId", status, created_at AS "createdAt"
         FROM stock_transfers WHERE ($1::uuid IS NULL OR from_branch_id=$1 OR to_branch_id=$1)
          AND ($2::uuid[] IS NULL OR from_branch_id = ANY($2::uuid[]) OR to_branch_id = ANY($2::uuid[])) ORDER BY created_at DESC LIMIT 200`, [branchId ?? null, scope])).rows);
  }
  getTransfer(id: string) { return this.db.tx((q) => this.transferById(q, id)); }

  createTransfer(d: Dict) {
    if (d.fromBranchId === d.toBranchId) throw new AppError('VALIDATION_ERROR', 400, { field: 'toBranchId' });
    const p = ctx().principal!;   // solicita quien opera el origen o el destino; el origen aprueba y despacha
    if (!p.can('inventory.transfer.write', d.toBranchId) && !p.can('inventory.transfer.write', d.fromBranchId)) throw forbidden({ permission: 'inventory.transfer.write' });
    return this.db.tx(async (q) => {
      const number = (await q.query(`SELECT next_counter('transfer') AS n`)).rows[0].n;
      const id = (await q.query(`INSERT INTO stock_transfers (tenant_id, number, from_branch_id, to_branch_id, notes, requested_by)
                                 VALUES (app_tenant_id(),$1,$2,$3,$4,$5) RETURNING id`, [number, d.fromBranchId, d.toBranchId, d.notes ?? null, ctx().principal!.userId])).rows[0].id;
      for (const it of d.items) await q.query(`INSERT INTO stock_transfer_items (tenant_id, transfer_id, ingredient_id, qty_requested) VALUES (app_tenant_id(),$1,$2,$3)`, [id, it.ingredientId, it.qty]);
      await this.audit.record(q, { action: 'transfer.create', entity: 'stock_transfer', entityId: id, newValue: d });
      return this.transferById(q, id);
    });
  }

  /** Máquina de estados: REQUESTED → APPROVED → IN_TRANSIT → RECEIVED; CANCELLED desde REQUESTED/APPROVED/IN_TRANSIT. */
  transition(id: string, action: 'approve' | 'dispatch' | 'receive' | 'cancel', body?: { items?: { ingredientId: string; qty: number }[] }) {
    return this.db.tx(async (q) => {
      const t = await this.transferById(q, id, true);
      const uid = ctx().principal!.userId;
      const fail = () => { throw new AppError('CONFLICT', 409, { status: t.status, action }, false, '⚠️ Esta acción no es posible en el estado actual de la transferencia.'); };
      if (action === 'approve') {
        this.assertBranch('inventory.transfer.approve', t.fromBranchId);
        if (t.status !== 'REQUESTED') fail();
        await q.query(`UPDATE stock_transfers SET status='APPROVED', approved_by=$2 WHERE id=$1`, [id, uid]);
      } else if (action === 'dispatch') {
        this.assertBranch('inventory.transfer.write', t.fromBranchId);
        if (t.status !== 'APPROVED') fail();
        for (const it of [...t.items].sort((a: Dict, b: Dict) => (a.ingredientId < b.ingredientId ? -1 : 1))) {
          const r = await this.engine.apply(q, { branchId: t.fromBranchId, ingredientId: it.ingredientId, type: 'TRANSFER_OUT', qty: -it.qtyRequested, refType: 'transfer', refId: id, reason: `Transferencia #${t.number}` });
          await q.query('UPDATE stock_transfer_items SET qty_sent = qty_requested, unit_cost = (SELECT avg_cost FROM ingredients WHERE id=$2) WHERE id=$1', [it.id, it.ingredientId]);
          void r;
        }
        await q.query(`UPDATE stock_transfers SET status='IN_TRANSIT', dispatched_at=now() WHERE id=$1`, [id]);
      } else if (action === 'receive') {
        this.assertBranch('inventory.transfer.write', t.toBranchId);
        if (t.status !== 'IN_TRANSIT') fail();
        const got = new Map((body?.items ?? []).map((i) => [i.ingredientId, i.qty]));
        for (const it of t.items) {
          const received = got.get(it.ingredientId) ?? it.qtySent;
          if (received < 0 || received > it.qtySent) throw new AppError('VALIDATION_ERROR', 400, { field: 'qty', ingredient: it.name });
          await q.query('UPDATE stock_transfer_items SET qty_received=$2 WHERE id=$1', [it.id, received]);
          if (received > 0) await this.engine.apply(q, { branchId: t.toBranchId, ingredientId: it.ingredientId, type: 'TRANSFER_IN', qty: received, refType: 'transfer', refId: id, reason: `Transferencia #${t.number}` });
          if (received < it.qtySent)
            await this.audit.record(q, { action: 'transfer.discrepancy', entity: 'stock_transfer', entityId: id, branchId: t.toBranchId, newValue: { ingredient: it.name, sent: it.qtySent, received } });
        }
        await q.query(`UPDATE stock_transfers SET status='RECEIVED', received_by=$2, received_at=now() WHERE id=$1`, [id, uid]);
      } else {
        if (!ctx().principal!.can('inventory.transfer.write', t.fromBranchId) && !ctx().principal!.can('inventory.transfer.write', t.toBranchId)) throw forbidden();
        if (!['REQUESTED', 'APPROVED', 'IN_TRANSIT'].includes(t.status)) fail();
        if (t.status === 'IN_TRANSIT')   // reintegra al origen lo despachado
          for (const it of t.items) await this.engine.apply(q, { branchId: t.fromBranchId, ingredientId: it.ingredientId, type: 'RETURN', qty: it.qtySent, refType: 'transfer', refId: id, reason: `Cancelación transferencia #${t.number}` });
        await q.query(`UPDATE stock_transfers SET status='CANCELLED' WHERE id=$1`, [id]);
      }
      await this.audit.record(q, { action: `transfer.${action}`, entity: 'stock_transfer', entityId: id, oldValue: { status: t.status } });
      return this.transferById(q, id);
    });
  }
}
