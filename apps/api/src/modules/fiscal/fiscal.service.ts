import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { DbService, Tx } from '../../database/db.service';
import { AppError, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../tenancy/settings.service';
import { MailService } from '../mail/mail.service';
import { computeTotals } from '../sales/pricing';
import { amountToCents, centsToAmount } from '../sales/pricing';
import {
  EMITTER_REGIMENES, FORMA_PAGO, MOTIVOS_CANCELACION, REGIMENES, USOS_CFDI, isGenericRfc, isValidRfc, normalizeLegalName, normalizeRfc,
  personType, predominantFormaPago, validateReceptor, type ReceptorInput,
} from './catalogs';
import {
  type Concept, type InvoiceDraft, assertConsistent, deliveryLine, globalConcepts, publicGeneralReceptor, summarize, toConcepts, toXml,
} from './cfdi';
import type { FiscalProvider } from './providers/provider';

export const FISCAL_PROVIDER = Symbol('FISCAL_PROVIDER');
type Dict = Record<string, any>;
type Via = 'STAFF' | 'SELF' | 'SYSTEM';

const INVOICE_COLS = `i.id, i.kind, i.status, i.series, i.folio, i.issued_at AS "issuedAt", i.branch_id AS "branchId", b.name AS "branchName",
  i.receptor_rfc AS "receptorRfc", i.receptor_name AS "receptorName", i.subtotal, i.discount, i.tax, i.total, i.uuid_sat AS "uuid", i.stamped_at AS "stampedAt",
  i.forma_pago AS "formaPago", i.simulated, i.provider, i.error_message AS "errorMessage", i.cancel_motive AS "cancelMotive", i.cancelled_at AS "cancelledAt", i.via`;

/** Fecha/hora de expedición del CFDI en la zona horaria del lugar de expedición: 'AAAA-MM-DDTHH:MM:SS'. */
export const cfdiDate = (tz: string, at = new Date()) => at.toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');

@Injectable()
export class FiscalService {
  constructor(
    private readonly db: DbService, private readonly audit: AuditService, private readonly settings: SettingsService, private readonly mail: MailService,
    @Inject(FISCAL_PROVIDER) private readonly provider: FiscalProvider | null, @Inject(ENV) private readonly env: Env,
  ) {}

  private assertBranch(perm: string, branchId: string) {
    if (!ctx().principal!.can(perm, branchId)) throw forbidden({ permission: perm, branchId });
  }

  // ───────────────────────── perfil fiscal ─────────────────────────
  catalogs() {
    return {
      regimenes: Object.entries(REGIMENES).map(([key, [name, types]]) => ({ key, name, types })),
      emitterRegimenes: EMITTER_REGIMENES,
      usos: Object.entries(USOS_CFDI).map(([key, name]) => ({ key, name })),
      formasPago: FORMA_PAGO, motivosCancelacion: MOTIVOS_CANCELACION,
    };
  }

  async profile() {
    const p = await this.db.tx(async (q) => (await q.query(
      `SELECT rfc, legal_name AS "legalName", regimen_fiscal AS "regimenFiscal", postal_code AS "postalCode", series, enabled FROM fiscal_profiles`)).rows[0]);
    return { profile: p ?? null, provider: this.provider ? { key: this.provider.key, simulated: this.provider.simulated } : null };
  }

  async saveProfile(d: { rfc: string; legalName: string; regimenFiscal: string; postalCode: string; series: string; enabled: boolean }) {
    const rfc = normalizeRfc(d.rfc);
    if (!isValidRfc(rfc) || isGenericRfc(rfc)) throw new AppError('INVOICE_INVALID_DATA', 400, { errors: ['El RFC del emisor no es válido.'] }, false, '🧾 El RFC del emisor no es válido.');
    const reg = REGIMENES[d.regimenFiscal];
    if (!reg || !reg[1].includes(personType(rfc))) throw new AppError('INVOICE_INVALID_DATA', 400, undefined, false, '🧾 El régimen fiscal no corresponde al tipo de persona del RFC.');
    await this.db.tx(async (q) => {
      const old = (await q.query('SELECT rfc, legal_name, regimen_fiscal FROM fiscal_profiles')).rows[0];
      await q.query(
        `INSERT INTO fiscal_profiles (tenant_id, rfc, legal_name, regimen_fiscal, postal_code, series, enabled) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id) DO UPDATE SET rfc=$1, legal_name=$2, regimen_fiscal=$3, postal_code=$4, series=$5, enabled=$6, updated_at=now()`,
        [rfc, normalizeLegalName(d.legalName), d.regimenFiscal, d.postalCode, d.series.toUpperCase(), d.enabled]);
      await this.audit.record(q, { action: 'fiscal.profile.update', entity: 'fiscal_profile', oldValue: old, newValue: { rfc, regimenFiscal: d.regimenFiscal, enabled: d.enabled } });
    });
    return this.profile();
  }

  // ───────────────────────── datos fiscales del cliente ─────────────────────────
  async customerFiscal(customerId: string) {
    return this.db.tx(async (q) => (await q.query(
      `SELECT rfc, legal_name AS "legalName", regimen_fiscal AS "regimenFiscal", postal_code AS "postalCode", cfdi_use AS "cfdiUse", email
         FROM customer_fiscal_data WHERE customer_id=$1`, [customerId])).rows[0] ?? null);
  }

  async saveCustomerFiscal(customerId: string, r: ReceptorInput & { email?: string }) {
    const input = this.normalizeReceptor(r); this.assertReceptor(input);
    await this.db.tx(async (q) => {
      if (!(await q.query('SELECT 1 FROM customers WHERE id=$1 AND deleted_at IS NULL', [customerId])).rowCount) throw notFound('customer');
      await q.query(
        `INSERT INTO customer_fiscal_data (tenant_id, customer_id, rfc, legal_name, regimen_fiscal, postal_code, cfdi_use, email) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (customer_id) DO UPDATE SET rfc=$2, legal_name=$3, regimen_fiscal=$4, postal_code=$5, cfdi_use=$6, email=$7, updated_at=now()`,
        [customerId, input.rfc, input.legalName, input.regimenFiscal, input.postalCode, input.cfdiUse, r.email ?? null]);
      await this.audit.record(q, { action: 'customer.fiscal_update', entity: 'customer', entityId: customerId, newValue: { rfc: input.rfc } });
    });
    return this.customerFiscal(customerId);
  }

  private normalizeReceptor(r: ReceptorInput): ReceptorInput {
    return { ...r, rfc: normalizeRfc(r.rfc), legalName: normalizeLegalName(r.legalName), cfdiUse: r.cfdiUse.toUpperCase() };
  }
  private assertReceptor(r: ReceptorInput) {
    const errors = validateReceptor(r);
    if (errors.length) throw new AppError('INVOICE_INVALID_DATA', 400, { errors }, false, `🧾 ${errors.join(' ')}`);
  }

  // ───────────────────────── armado del comprobante ─────────────────────────
  private async requireConfigured(q: Tx) {
    const p = (await q.query(`SELECT rfc, legal_name, regimen_fiscal, postal_code, series, enabled FROM fiscal_profiles`)).rows[0];
    if (!p || !p.enabled || !this.provider) throw new AppError('FISCAL_NOT_CONFIGURED', 409);
    return p as { rfc: string; legal_name: string; regimen_fiscal: string; postal_code: string; series: string };
  }

  private async orderConcepts(q: Tx, o: Dict): Promise<{ concepts: Concept[]; formaPago: string }> {
    const lines = (await q.query(
      `SELECT oi.name, oi.qty, oi.line_total, oi.tax_rate, oi.tax_included, p.sat_product_key, p.sat_unit_key, p.sat_unit_name
         FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id=$1 AND oi.status <> 'CANCELLED' ORDER BY oi.created_at, oi.id`, [o.id])).rows;
    const priced = lines.map((l, i) => ({ id: String(i), lineCents: amountToCents(l.line_total), taxRate: l.tax_rate, taxIncluded: l.tax_included }));
    const t = computeTotals(priced, amountToCents(o.discount_total));
    const src = lines.map((l, i) => ({
      name: l.name, qty: l.qty, lineCents: priced[i]!.lineCents, taxRate: l.tax_rate, taxIncluded: l.tax_included, shareCents: priced[i]!.lineCents - t.lines[i]!.netCents,
      satProductKey: l.sat_product_key, satUnitKey: l.sat_unit_key, satUnitName: l.sat_unit_name }));
    const fee = amountToCents(o.delivery_fee ?? 0);
    if (fee > 0) {
      const rate = (await q.query('SELECT rate FROM taxes WHERE is_default LIMIT 1')).rows[0]?.rate ?? 0.16;
      const d = deliveryLine(fee, rate); if (d) src.push(d);
    }
    const concepts = toConcepts(src);
    const pays = (await q.query(`SELECT method, amount FROM payments WHERE order_id=$1 AND status='PAID'`, [o.id])).rows;
    return { concepts, formaPago: predominantFormaPago(pays) };
  }

  private async orderForUpdate(q: Tx, orderId: string): Promise<Dict> {
    const o = (await q.query(
      `SELECT o.*, b.timezone AS tz, b.postal_code AS branch_cp, b.name AS branch_name,
              ((now() AT TIME ZONE b.timezone)::date - o.business_date)::int AS age_days
         FROM orders o JOIN branches b ON b.id = o.branch_id WHERE o.id=$1 FOR UPDATE OF o`, [orderId])).rows[0];
    if (!o) throw notFound('order');
    return o;
  }

  private async assertInvoiceable(q: Tx, o: Dict, via: Via) {
    if (o.payment_status !== 'PAID' || o.status === 'CANCELLED') throw new AppError('ORDER_NOT_INVOICEABLE', 409);
    const active = (await q.query(`SELECT i.status, i.kind FROM invoice_orders io JOIN invoices i ON i.id = io.invoice_id WHERE io.order_id=$1 AND io.active`, [o.id])).rows[0];
    if (active) throw new AppError('INVOICE_EXISTS', 409, { kind: active.kind, status: active.status });
    const days = Number(await this.settings.get('fiscal.invoiceWindowDays', o.branch_id, 31));
    if (via === 'SELF' && o.age_days > days) throw new AppError('INVOICE_WINDOW_CLOSED', 409, { windowDays: days });
    if (via !== 'SELF' && String(o.business_date).slice(0, 4) !== String(new Date().getFullYear())) throw new AppError('INVOICE_WINDOW_CLOSED', 409);
  }

  private async persist(q: Tx, o: { branchId: string; kind: 'ORDER' | 'GLOBAL'; draft: InvoiceDraft; orderIds: string[]; customerId?: string | null; email?: string | null; via: Via }): Promise<string> {
    const d = o.draft; const c = ctx();
    const folio = (await q.query('SELECT next_counter($1) AS n', [`invoice:${d.series}`])).rows[0].n as number;
    d.folio = String(folio);
    const id = (await q.query(
      `INSERT INTO invoices (tenant_id, branch_id, kind, status, series, folio, issued_at, issuer_rfc, issuer_name, issuer_regimen, place_of_issue,
         receptor_rfc, receptor_name, receptor_regimen, receptor_postal_code, cfdi_use, forma_pago, metodo_pago, subtotal, discount, tax, total, global_info, draft,
         provider, simulated, customer_id, receptor_email, created_by, via)
       VALUES (app_tenant_id(),$1,$2,'PENDING',$3,$4,now(),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PUE',$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id`,
      [o.branchId, o.kind, d.series, folio, d.issuer.rfc, d.issuer.legalName, d.issuer.regimenFiscal, d.placeOfIssue,
        d.receptor.rfc, d.receptor.legalName, d.receptor.regimenFiscal, d.receptor.postalCode, d.receptor.cfdiUse, d.formaPago,
        centsToAmount(d.subtotalCents), centsToAmount(d.discountCents), centsToAmount(d.taxCents), centsToAmount(d.totalCents),
        d.global ? JSON.stringify(d.global) : null, JSON.stringify(d), this.provider!.key, this.provider!.simulated, o.customerId ?? null, o.email ?? null,
        c.principal?.userId ?? null, o.via])).rows[0].id as string;
    let pos = 0;
    for (const k of d.concepts)
      await q.query(
        `INSERT INTO invoice_items (tenant_id, invoice_id, position, sat_product_key, sat_unit_key, unit_name, description, qty, unit_value, amount, discount, base, tax_rate, tax)
         VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, ++pos, k.satProductKey, k.satUnitKey, k.unitName, k.description, k.qty, k.unitValue, centsToAmount(k.amountCents), centsToAmount(k.discountCents), centsToAmount(k.baseCents), k.taxRate, centsToAmount(k.taxCents)]);
    for (const oid of o.orderIds) await q.query('INSERT INTO invoice_orders (tenant_id, invoice_id, order_id) VALUES (app_tenant_id(),$1,$2)', [id, oid]);
    return id;
  }

  /** Envía al PAC (FUERA de transacción) y registra el resultado. El `reference` hace idempotente el reintento. */
  private async stampAndStore(invoiceId: string, draft: InvoiceDraft) {
    const provider = this.provider!;
    const xml = toXml(draft);
    try {
      const r = await provider.stamp(draft, xml, invoiceId);
      await this.db.tx(async (q) => {
        await q.query(`UPDATE invoices SET status='STAMPED', uuid_sat=$2, stamped_at=$3::timestamptz, xml=$4, sat_seal=$5, error_message=NULL WHERE id=$1`,
          [invoiceId, r.uuid, r.stampedAt, r.xml, r.satSeal]);
        const inv = (await q.query('SELECT branch_id, series, folio, total FROM invoices WHERE id=$1', [invoiceId])).rows[0];
        await this.audit.record(q, { action: 'invoice.stamp', entity: 'invoice', entityId: invoiceId, branchId: inv.branch_id,
          newValue: { uuid: r.uuid, folio: `${inv.series}-${inv.folio}`, total: inv.total, simulated: provider.simulated } });
        await this.queueInvoiceEmail(q, invoiceId);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 500) : 'Error desconocido';
      await this.db.independent(async (q) => {
        await q.query(`UPDATE invoices SET status='ERROR', error_message=$2 WHERE id=$1 AND status='PENDING'`, [invoiceId, msg]);
        await q.query('UPDATE invoice_orders SET active=false WHERE invoice_id=$1', [invoiceId]);
      });
      throw new AppError('FISCAL_PROVIDER_ERROR', 502, { reason: msg }, true);
    }
    return this.get(invoiceId, true);
  }

  /** Encola el correo con el XML al receptor (si dejó correo). Idempotente por factura. */
  private async queueInvoiceEmail(q: Tx, invoiceId: string, to?: string) {
    const i = (await q.query(`SELECT i.series, i.folio, i.uuid_sat, i.xml, i.total, i.simulated, i.kind, i.receptor_name, i.receptor_email, r.name AS restaurant
        FROM invoices i JOIN restaurants r ON r.id = i.tenant_id WHERE i.id=$1`, [invoiceId])).rows[0];
    const dest = to ?? i?.receptor_email;
    if (!i?.xml || !dest) return false;
    const folio = `${i.series}-${i.folio}`;
    const lines = [`Hola ${i.receptor_name}, adjuntamos tu factura ${folio} por $${Number(i.total).toFixed(2)}.`, `Folio fiscal (UUID): ${i.uuid_sat}`,
      ...(i.simulated ? ['⚠️ Factura de PRUEBA: no tiene validez fiscal.'] : []), `Gracias por tu visita a ${i.restaurant}.`];
    return this.mail.enqueue(q, { to: dest, kind: 'INVOICE', subject: `${i.simulated ? '[PRUEBA] ' : ''}Tu factura ${folio} · ${i.restaurant}`, text: lines.join('\n'),
      html: MailService.html(`Factura ${folio}`, lines), attachments: [{ filename: `CFDI-${folio}-${String(i.uuid_sat).slice(0, 8)}.xml`, contentType: 'application/xml', content: i.xml }],
      dedupeKey: to ? undefined : `invoice:${invoiceId}` });
  }

  /** Reenvía el XML (a otro correo si hace falta). */
  async emailInvoice(id: string, to?: string) {
    const scope = ctx().principal!.branchScope('fiscal.invoice.issue');
    return this.db.tx(async (q) => {
      const i = (await q.query(`SELECT id, branch_id, status, receptor_email FROM invoices WHERE id=$1 AND ($2::uuid[] IS NULL OR branch_id = ANY($2::uuid[]))`, [id, scope])).rows[0];
      if (!i) throw notFound('invoice');
      if (!['STAMPED', 'CANCEL_PENDING'].includes(i.status)) throw new AppError('CONFLICT', 409, undefined, false, '🧾 Sólo se envían facturas timbradas.');
      const dest = to ?? i.receptor_email;
      if (!dest) throw new AppError('VALIDATION_ERROR', 400, { field: 'to' }, false, '🧾 Indica a qué correo enviar la factura.');
      const queued = await this.queueInvoiceEmail(q, id, dest);
      if (!queued) throw new AppError('VALIDATION_ERROR', 400, { field: 'to' }, false, '🧾 El correo no es válido.');
      await this.audit.record(q, { action: 'invoice.email', entity: 'invoice', entityId: id, branchId: i.branch_id, newValue: { to: dest } });
      return { queued: true };
    });
  }

  // ───────────────────────── emisión por orden ─────────────────────────
  async issueForOrder(d: { orderId: string; customerId?: string; receptor?: ReceptorInput & { email?: string }; saveToCustomer?: boolean }, via: Via = 'STAFF') {
    const { invoiceId, draft } = await this.db.tx(async (q) => {
      const o = await this.orderForUpdate(q, d.orderId);
      this.assertBranch('fiscal.invoice.issue', o.branch_id);
      const prof = await this.requireConfigured(q);
      await this.assertInvoiceable(q, o, via);

      let r: (ReceptorInput & { email?: string }) | undefined = d.receptor;
      let customerId = d.customerId ?? o.customer_id ?? null;
      if (!r && d.customerId) {
        const cf = (await q.query(`SELECT rfc, legal_name AS "legalName", regimen_fiscal AS "regimenFiscal", postal_code AS "postalCode", cfdi_use AS "cfdiUse", email FROM customer_fiscal_data WHERE customer_id=$1`, [d.customerId])).rows[0];
        if (!cf) throw new AppError('INVOICE_INVALID_DATA', 400, undefined, false, '🧾 Este cliente no tiene datos fiscales guardados.');
        r = cf;
      }
      const receptor = this.normalizeReceptor(r!); this.assertReceptor(receptor);
      if (d.saveToCustomer && customerId && d.receptor)
        await q.query(
          `INSERT INTO customer_fiscal_data (tenant_id, customer_id, rfc, legal_name, regimen_fiscal, postal_code, cfdi_use, email) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (customer_id) DO UPDATE SET rfc=$2, legal_name=$3, regimen_fiscal=$4, postal_code=$5, cfdi_use=$6, email=$7, updated_at=now()`,
          [customerId, receptor.rfc, receptor.legalName, receptor.regimenFiscal, receptor.postalCode, receptor.cfdiUse, d.receptor.email ?? null]);

      const { concepts, formaPago } = await this.orderConcepts(q, o);
      const sum = summarize(concepts);
      if (Math.abs(sum.totalCents - amountToCents(o.total)) > 1)
        throw new AppError('INVOICE_INVALID_DATA', 409, { cfdiTotal: centsToAmount(sum.totalCents), orderTotal: o.total }, false, '🧾 El total del comprobante no coincide con la cuenta. Revisa los impuestos de los productos.');
      const draft: InvoiceDraft = {
        version: '4.0', series: prof.series, folio: '0', date: cfdiDate(o.tz), formaPago, metodoPago: 'PUE', currency: 'MXN',
        placeOfIssue: o.branch_cp ?? prof.postal_code, issuer: { rfc: prof.rfc, legalName: prof.legal_name, regimenFiscal: prof.regimen_fiscal },
        receptor, concepts, ...sum };
      const problems = assertConsistent(draft);
      if (problems.length) throw new AppError('INVOICE_INVALID_DATA', 409, { problems }, false, `🧾 ${problems[0]}`);
      const invoiceId = await this.persist(q, { branchId: o.branch_id, kind: 'ORDER', draft, orderIds: [o.id], customerId, email: d.receptor?.email ?? null, via });
      await this.audit.record(q, { action: 'invoice.create', entity: 'invoice', entityId: invoiceId, branchId: o.branch_id, newValue: { order: o.number, receptor: receptor.rfc, total: centsToAmount(sum.totalCents), via } });
      return { invoiceId, draft };
    });
    return this.stampAndStore(invoiceId, draft);
  }

  /** Reintenta un comprobante que quedó en ERROR o PENDING (timeout del PAC). */
  async retry(invoiceId: string) {
    const draft = await this.db.tx(async (q) => {
      const i = (await q.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [invoiceId])).rows[0];
      if (!i) throw notFound('invoice');
      this.assertBranch('fiscal.invoice.issue', i.branch_id);
      if (!['ERROR', 'PENDING'].includes(i.status)) throw new AppError('CONFLICT', 409, undefined, false, '🧾 Este comprobante ya fue procesado.');
      await this.requireConfigured(q);
      try { await q.query('UPDATE invoice_orders SET active=true WHERE invoice_id=$1', [invoiceId]); }
      catch (e: any) { if (e.code === '23505') throw new AppError('INVOICE_EXISTS', 409); throw e; }
      await q.query(`UPDATE invoices SET status='PENDING', error_message=NULL WHERE id=$1`, [invoiceId]);
      return i.draft as InvoiceDraft;
    });
    return this.stampAndStore(invoiceId, draft);
  }

  // ───────────────────────── factura global ─────────────────────────
  /** Factura global del día (cerrado) para el público en general: tickets pagados que nadie facturó. */
  async issueGlobal(d: { branchId: string; date: string }) {
    this.assertBranch('fiscal.invoice.issue', d.branchId);
    const { invoiceId, draft } = await this.db.tx(async (q) => {
      const prof = await this.requireConfigured(q);
      const b = (await q.query(`SELECT id, timezone, postal_code, ((now() AT TIME ZONE timezone) - business_day_cutoff::interval)::date AS bdate FROM branches WHERE id=$1 AND deleted_at IS NULL`, [d.branchId])).rows[0];
      if (!b) throw notFound('branch');
      if (d.date >= b.bdate) throw new AppError('ORDER_NOT_INVOICEABLE', 409, undefined, false, '🧾 La factura global sólo puede emitirse de días ya cerrados.');
      const orders = (await q.query(
        `SELECT o.* FROM orders o WHERE o.branch_id=$1 AND o.business_date=$2 AND o.payment_status='PAID' AND o.status <> 'CANCELLED'
            AND NOT EXISTS (SELECT 1 FROM invoice_orders io WHERE io.order_id=o.id AND io.active) ORDER BY o.number FOR UPDATE OF o`, [d.branchId, d.date])).rows;
      if (!orders.length) throw new AppError('ORDER_NOT_INVOICEABLE', 409, undefined, false, '🧾 No hay tickets pendientes de facturar en esa fecha.');
      const parts: { folio: string; concepts: Concept[] }[] = []; const pays: { method: string; amount: number }[] = [];
      for (const o of orders) {
        const r = await this.orderConcepts(q, o);
        parts.push({ folio: `#${String(o.number).padStart(4, '0')}`, concepts: r.concepts });
        pays.push(...(await q.query(`SELECT method, amount FROM payments WHERE order_id=$1 AND status='PAID'`, [o.id])).rows);
      }
      const concepts = globalConcepts(parts); const sum = summarize(concepts);
      const [y, m] = d.date.split('-').map(Number) as [number, number];
      const cp = b.postal_code ?? prof.postal_code;
      const draft: InvoiceDraft = {
        version: '4.0', series: prof.series, folio: '0', date: cfdiDate(b.timezone), formaPago: predominantFormaPago(pays), metodoPago: 'PUE', currency: 'MXN', placeOfIssue: cp,
        issuer: { rfc: prof.rfc, legalName: prof.legal_name, regimenFiscal: prof.regimen_fiscal }, receptor: publicGeneralReceptor(cp),
        global: { periodicity: '01', months: String(m).padStart(2, '0'), year: y }, concepts, ...sum };
      const problems = assertConsistent(draft);
      if (problems.length) throw new AppError('INVOICE_INVALID_DATA', 409, { problems }, false, `🧾 ${problems[0]}`);
      const invoiceId = await this.persist(q, { branchId: d.branchId, kind: 'GLOBAL', draft, orderIds: orders.map((o) => o.id), via: 'STAFF' });
      await this.audit.record(q, { action: 'invoice.global_create', entity: 'invoice', entityId: invoiceId, branchId: d.branchId, newValue: { date: d.date, orders: orders.length, total: centsToAmount(sum.totalCents) } });
      return { invoiceId, draft };
    });
    return this.stampAndStore(invoiceId, draft);
  }

  // ───────────────────────── cancelación ─────────────────────────
  async cancel(invoiceId: string, d: { motive: string; replacementUuid?: string }) {
    const inv = await this.db.tx(async (q) => {
      const i = (await q.query('SELECT id, branch_id, status, uuid_sat, issuer_rfc FROM invoices WHERE id=$1', [invoiceId])).rows[0];
      if (!i) throw notFound('invoice');
      this.assertBranch('fiscal.invoice.cancel', i.branch_id);
      if (i.status !== 'STAMPED') throw new AppError('CONFLICT', 409, undefined, false, '🧾 Sólo se pueden cancelar facturas timbradas y vigentes.');
      await this.requireConfigured(q);
      return i;
    });
    let res;
    try { res = await this.provider!.cancel({ uuid: inv.uuid_sat, issuerRfc: inv.issuer_rfc, motive: d.motive, replacementUuid: d.replacementUuid }); }
    catch (e) { throw new AppError('FISCAL_PROVIDER_ERROR', 502, { reason: e instanceof Error ? e.message : String(e) }, true); }
    await this.db.tx(async (q) => {
      const done = res.status === 'CANCELLED';
      const r = await q.query(
        `UPDATE invoices SET status=$2, cancel_motive=$3, cancel_replacement_uuid=$4, cancel_acuse=$5, cancelled_at=CASE WHEN $6 THEN now() ELSE NULL END, cancelled_by=$7
          WHERE id=$1 AND status='STAMPED'`, [invoiceId, res.status, d.motive, d.replacementUuid ?? null, res.acuse ?? null, done, ctx().principal!.userId]);
      if (!r.rowCount) throw new AppError('CONFLICT', 409);
      if (done) await q.query('UPDATE invoice_orders SET active=false WHERE invoice_id=$1', [invoiceId]);
      await this.audit.record(q, { action: 'invoice.cancel', entity: 'invoice', entityId: invoiceId, branchId: inv.branch_id, reason: MOTIVOS_CANCELACION[d.motive], newValue: { motive: d.motive, status: res.status } });
    });
    return this.get(invoiceId, true);
  }

  // ───────────────────────── consulta ─────────────────────────
  list(f: { branchId?: string; status?: string; q?: string; from?: string; to?: string; orderId?: string; limit: number; offset: number }) {
    const scope = ctx().principal!.branchScope('fiscal.invoice.read');
    return this.db.tx(async (q) => (await q.query(
      `SELECT ${INVOICE_COLS},
              (SELECT COALESCE(json_agg(json_build_object('id', o.id, 'number', o.number) ORDER BY o.number), '[]') FROM invoice_orders io JOIN orders o ON o.id = io.order_id WHERE io.invoice_id = i.id) AS orders
         FROM invoices i JOIN branches b ON b.id = i.branch_id
        WHERE ($1::uuid[] IS NULL OR i.branch_id = ANY($1::uuid[])) AND ($2::uuid IS NULL OR i.branch_id = $2) AND ($3::text IS NULL OR i.status = $3)
          AND ($4::text IS NULL OR i.receptor_rfc ILIKE '%'||$4||'%' OR i.receptor_name ILIKE '%'||$4||'%' OR i.uuid_sat ILIKE '%'||$4||'%' OR (i.series||'-'||i.folio) ILIKE '%'||$4||'%')
          AND ($5::date IS NULL OR i.issued_at >= $5::date) AND ($6::date IS NULL OR i.issued_at < $6::date + 1)
          AND ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM invoice_orders io WHERE io.invoice_id = i.id AND io.order_id = $7))
        ORDER BY i.issued_at DESC, i.folio DESC LIMIT $8 OFFSET $9`,
      [scope, f.branchId ?? null, f.status ?? null, f.q ?? null, f.from ?? null, f.to ?? null, f.orderId ?? null, f.limit, f.offset])).rows);
  }

  async get(id: string, trusted = false) {
    const scope = trusted ? null : ctx().principal!.branchScope('fiscal.invoice.read');
    const inv = await this.db.tx(async (q) => {
      const i = (await q.query(`SELECT ${INVOICE_COLS}, i.issuer_rfc AS "issuerRfc", i.issuer_name AS "issuerName", i.issuer_regimen AS "issuerRegimen", i.place_of_issue AS "placeOfIssue",
          i.receptor_regimen AS "receptorRegimen", i.receptor_postal_code AS "receptorPostalCode", i.cfdi_use AS "cfdiUse", i.metodo_pago AS "metodoPago", i.global_info AS "globalInfo",
          i.receptor_email AS "receptorEmail"
          FROM invoices i JOIN branches b ON b.id = i.branch_id WHERE i.id=$1 AND ($2::uuid[] IS NULL OR i.branch_id = ANY($2::uuid[]))`, [id, scope])).rows[0];
      if (!i) return null;
      i.items = (await q.query(`SELECT position, sat_product_key AS "satProductKey", sat_unit_key AS "satUnitKey", unit_name AS "unitName", description, qty, unit_value AS "unitValue", amount, discount, base, tax_rate AS "taxRate", tax FROM invoice_items WHERE invoice_id=$1 ORDER BY position`, [id])).rows;
      i.orders = (await q.query(`SELECT o.id, o.number, io.active FROM invoice_orders io JOIN orders o ON o.id = io.order_id WHERE io.invoice_id=$1 ORDER BY o.number`, [id])).rows;
      return i;
    });
    if (!inv) throw notFound('invoice');
    return inv;
  }

  async xml(id: string) {
    const scope = ctx().principal!.branchScope('fiscal.invoice.read');
    const r = await this.db.tx(async (q) => (await q.query(
      `SELECT xml, series, folio, uuid_sat FROM invoices WHERE id=$1 AND xml IS NOT NULL AND ($2::uuid[] IS NULL OR branch_id = ANY($2::uuid[]))`, [id, scope])).rows[0]);
    if (!r) throw notFound('invoice');
    return { xml: r.xml as string, filename: `CFDI-${r.series}-${r.folio}-${String(r.uuid_sat).slice(0, 8)}.xml` };
  }

  // ───────────────────────── autofactura (sitio público) ─────────────────────────
  private async orderByCode(q: Tx, code: string): Promise<Dict> {
    const o = (await q.query(
      `SELECT o.id, o.number, o.business_date, o.total, o.payment_status, o.status, o.branch_id, b.name AS branch_name,
              ((now() AT TIME ZONE b.timezone)::date - o.business_date)::int AS age_days
         FROM orders o JOIN branches b ON b.id = o.branch_id WHERE o.invoice_code = $1`, [code.toUpperCase()])).rows[0];
    if (!o) throw notFound('ticket');
    return o;
  }

  async lookupByCode(code: string) {
    return this.db.tx(async (q) => {
      const o = await this.orderByCode(q, code);
      const items = (await q.query(`SELECT name, qty, line_total AS total FROM order_items WHERE order_id=$1 AND status <> 'CANCELLED' AND line_total > 0 ORDER BY created_at, id`, [o.id])).rows;
      const inv = (await q.query(
        `SELECT i.id, i.kind, i.status, i.series, i.folio, i.uuid_sat AS uuid, i.receptor_rfc AS "receptorRfc", i.simulated FROM invoice_orders io JOIN invoices i ON i.id = io.invoice_id WHERE io.order_id=$1 AND io.active`, [o.id])).rows[0] ?? null;
      const days = Number(await this.settings.get('fiscal.invoiceWindowDays', o.branch_id, 31));
      let reason: string | null = null;
      if (o.payment_status !== 'PAID' || o.status === 'CANCELLED') reason = 'NOT_PAID';
      else if (inv) reason = inv.kind === 'GLOBAL' ? 'IN_GLOBAL' : 'ALREADY_INVOICED';
      else if (o.age_days > days) reason = 'WINDOW_CLOSED';
      return { number: o.number, businessDate: o.business_date, total: o.total, branch: o.branch_name, items, invoice: inv, invoiceable: reason === null, reason, windowDays: days };
    });
  }

  async issueByCode(code: string, receptor: ReceptorInput & { email?: string }) {
    const orderId = (await this.db.tx((q) => this.orderByCode(q, code))).id as string;
    return this.issueForOrder({ orderId, receptor }, 'SELF').then((i) => ({ id: i.id, uuid: i.uuid, series: i.series, folio: i.folio, total: i.total, simulated: i.simulated }));
  }

  async xmlByCode(code: string) {
    const r = await this.db.tx(async (q) => {
      const o = await this.orderByCode(q, code);
      return (await q.query(
        `SELECT i.xml, i.series, i.folio, i.uuid_sat FROM invoice_orders io JOIN invoices i ON i.id = io.invoice_id
          WHERE io.order_id=$1 AND io.active AND i.kind='ORDER' AND i.xml IS NOT NULL`, [o.id])).rows[0];
    });
    if (!r) throw notFound('invoice');
    return { xml: r.xml as string, filename: `CFDI-${r.series}-${r.folio}-${String(r.uuid_sat).slice(0, 8)}.xml` };
  }

  /** Para la protección al cancelar/devolver: ¿la orden tiene factura vigente? */
  async hasActiveInvoice(q: Tx, orderId: string): Promise<boolean> {
    return (await q.query('SELECT 1 FROM invoice_orders WHERE order_id=$1 AND active', [orderId])).rowCount! > 0;
  }
}
