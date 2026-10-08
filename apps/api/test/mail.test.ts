import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startApi } from './helpers';
import { Fixture, buildFixture, item } from './fixtures';
import { MAIL_TRANSPORT, MailService } from '../src/modules/mail/mail.service';
import { LogTransport } from '../src/modules/mail/mail.transport';
import { DbService } from '../src/database/db.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

let api: Api; let f: Fixture; let mail: MailService; let transport: LogTransport; let db: DbService;
beforeAll(async () => {
  api = await startApi(); f = await buildFixture(api, 'mail');
  mail = api.app.get(MailService); transport = api.app.get(MAIL_TRANSPORT) as LogTransport; db = api.app.get(DbService);
  await api.req('POST', '/cash/shifts/open', { token: f.tokens.cajero, body: { branchId: f.branchId, openingFloat: 100 } });
});
afterAll(async () => { await f.close(); await api.app.close(); });
const req = (m: string, url: string, token: string, body?: unknown) => api.req(m, url, { token, body });
/** Ejecuta `fn` como el tenant del fixture, sin transacción ambiente (como el job). */
const asTenant = <T>(fn: () => Promise<T>) => import('../src/common/request-context').then(({ requestContext }) => requestContext.run({ tenantId: f.t.tenantId }, fn));
const outbox = (where = '') => f.sql(`SELECT * FROM email_outbox ${where} ORDER BY created_at`);

describe('correo saliente', () => {
  it('sin SMTP_URL usa el transporte de log; el estado lo informa', async () => {
    expect(transport.kind).toBe('log');
    expect((await req('GET', '/mail/status', f.tokens.gerente)).body).toEqual({ transport: 'log' });
    expect((await req('GET', '/mail/status', f.tokens.mesero)).status).toBe(403);
  });

  it('encola dentro de la transacción: si hace rollback no sale correo; direcciones inválidas se descartan; dedupe', async () => {
    const before = (await outbox()).length;
    await expect(asTenant(() => db.tx(async (q) => { await mail.enqueue(q, { to: 'a@x.test', subject: 'Se revierte', text: 't' }); throw new Error('boom'); }))).rejects.toThrow('boom');
    expect((await outbox()).length).toBe(before);

    await asTenant(() => db.tx(async (q) => {
      expect(await mail.enqueue(q, { to: ['no-es-correo', ' B@X.test ', 'b@x.test'], subject: 'Hola', text: 'texto', dedupeKey: 'k1' })).toBe(true);
      expect(await mail.enqueue(q, { to: 'b@x.test', subject: 'Duplicado', text: 'texto', dedupeKey: 'k1' })).toBe(false);
      expect(await mail.enqueue(q, { to: ['mal'], subject: 'Nadie', text: 't' })).toBe(false);
    }));
    const row = (await outbox(`WHERE dedupe_key='k1'`))[0];
    expect(row.to_addrs).toEqual(['b@x.test']); expect(row.status).toBe('PENDING');
  });

  it('flush envía una vez y marca SENT; segundo flush no repite', async () => {
    transport.sent.length = 0;
    expect(await asTenant(() => mail.flush())).toMatchObject({ sent: 1, failed: 0 });
    expect(transport.sent).toHaveLength(1); expect(transport.sent[0]!.to).toEqual(['b@x.test']); expect(transport.sent[0]!.from).toContain('Amerix Burger');
    expect((await outbox(`WHERE dedupe_key='k1'`))[0]).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(await asTenant(() => mail.flush())).toEqual({ sent: 0, failed: 0 });
  });

  it('fallo del SMTP: reintento con espera, y tras 5 intentos queda FAILED con el error visible', async () => {
    await asTenant(() => db.tx((q) => mail.enqueue(q, { to: 'c@x.test', subject: 'Reintento', text: 't', dedupeKey: 'retry' })));
    transport.failNext = 99;
    expect(await asTenant(() => mail.flush())).toMatchObject({ sent: 0, failed: 1 });
    let r = (await outbox(`WHERE dedupe_key='retry'`))[0];
    expect(r).toMatchObject({ status: 'PENDING', attempts: 1 }); expect(r.last_error).toContain('SMTP simulado');
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(await asTenant(() => mail.flush())).toEqual({ sent: 0, failed: 0 });                  // aún en espera
    for (let i = 0; i < 4; i++) { await f.sql(`UPDATE email_outbox SET next_attempt_at = now() WHERE dedupe_key='retry'`); await asTenant(() => mail.flush()); }
    r = (await outbox(`WHERE dedupe_key='retry'`))[0];
    expect(r).toMatchObject({ status: 'FAILED', attempts: 5 });
    expect((await req('GET', '/mail/outbox?status=FAILED', f.tokens.gerente)).body.some((x: any) => x.subject === 'Reintento')).toBe(true);
    transport.failNext = 0;
  });

  it('un envío colgado (SENDING > 5 min) se reclama y no se pierde', async () => {
    await asTenant(() => db.tx((q) => mail.enqueue(q, { to: 'd@x.test', subject: 'Colgado', text: 't', dedupeKey: 'stuck' })));
    await f.sql(`UPDATE email_outbox SET status='SENDING', claimed_at = now() - interval '10 minutes' WHERE dedupe_key='stuck'`);
    transport.sent.length = 0;
    expect((await asTenant(() => mail.flush())).sent).toBe(1); expect(transport.sent[0]!.subject).toBe('Colgado');
  });

  it('correo de prueba desde Configuración (sólo con permiso de escritura)', async () => {
    transport.sent.length = 0;
    expect((await req('POST', '/mail/test', f.tokens.cajero, { to: 'x@y.test' })).status).toBe(403);
    const r = await req('POST', '/mail/test', f.admin, { to: 'dueno@x.test' });
    expect(r.body).toMatchObject({ sent: 1, transport: 'log' }); expect(transport.sent[0]!.subject).toContain('Prueba de correo');
  });
});

describe('correos de negocio', () => {
  it('la factura timbrada se envía al receptor con el XML adjunto; reenvío manual; sin correo no se encola', async () => {
    await req('PUT', '/fiscal/profile', f.admin, { rfc: 'EKU9003173C9', legalName: 'Escuela Kemper Urgate', regimenFiscal: '601', postalCode: '06600', series: 'A', enabled: true });
    const pay = async () => { const o = (await req('POST', '/orders', f.tokens.mesero, { branchId: f.branchId, channel: 'TAKEAWAY', items: [item(f.prod.burger)], send: true })).body; await req('POST', `/orders/${o.id}/pay`, f.tokens.cajero, { payments: [{ method: 'CASH', amount: o.total }] }); return o; };
    const receptor = { rfc: 'URE180429TM6', legalName: 'Universidad Robotica Española', regimenFiscal: '601', postalCode: '65000', cfdiUse: 'G03' };
    transport.sent.length = 0;

    const o1 = await pay();
    const inv = (await req('POST', '/invoices', f.tokens.cajero, { orderId: o1.id, receptor: { ...receptor, email: 'facturas@uni.test' } })).body;
    await asTenant(() => mail.flush());
    const m = transport.sent.find((x) => x.subject.includes(`A-${inv.folio}`))!;
    expect(m.to).toEqual(['facturas@uni.test']); expect(m.subject).toMatch(/^\[PRUEBA\]/);
    expect(m.attachments![0]).toMatchObject({ contentType: 'application/xml' }); expect(m.attachments![0]!.filename).toMatch(/^CFDI-A-\d+-[0-9A-F]{8}\.xml$/);
    expect(m.attachments![0]!.content).toContain(`UUID="${inv.uuid}"`); expect(m.html).toContain('AMERIX BURGER');

    const n = transport.sent.length;
    expect((await req('POST', `/invoices/${inv.id}/email`, f.tokens.cajero, { to: 'contador@uni.test' })).body).toEqual({ queued: true });
    await asTenant(() => mail.flush()); expect(transport.sent.length).toBe(n + 1); expect(transport.sent.at(-1)!.to).toEqual(['contador@uni.test']);
    expect((await req('POST', `/invoices/${inv.id}/email`, f.tokens.mesero, {})).status).toBe(403);

    const o2 = await pay();
    const inv2 = (await req('POST', '/invoices', f.tokens.cajero, { orderId: o2.id, receptor })).body;      // sin correo
    expect((await outbox(`WHERE dedupe_key = 'invoice:${inv2.id}'`))).toHaveLength(0);
    expect((await req('POST', `/invoices/${inv2.id}/email`, f.tokens.cajero, {})).status).toBe(400);
  });

  it('alertas CRÍTICAS se envían por correo a los destinatarios configurados, una sola vez', async () => {
    const notif = api.app.get(NotificationsService);
    const fire = () => asTenant(() => db.tx((q) => notif.emit(q, { type: 'X', severity: 'CRITICAL', title: 'Caja descuadrada', body: 'Faltan $500', dedupeKey: 'crit-1' })));
    await fire();
    expect((await outbox(`WHERE kind='ALERT'`))).toHaveLength(0);                        // sin destinatarios configurados
    await req('PUT', '/settings', f.admin, { key: 'notifications.emailTo', value: 'dueno@x.test, gerente@x.test' });
    await asTenant(() => db.tx((q) => notif.emit(q, { type: 'X', severity: 'CRITICAL', title: 'Inventario descuadrado', dedupeKey: 'crit-2' })));
    await asTenant(() => db.tx((q) => notif.emit(q, { type: 'X', severity: 'CRITICAL', title: 'Inventario descuadrado', dedupeKey: 'crit-2' })));   // repetida
    await asTenant(() => db.tx((q) => notif.emit(q, { type: 'X', severity: 'WARNING', title: 'Sólo aviso', dedupeKey: 'warn-1' })));                 // no crítica
    const alerts = await outbox(`WHERE kind='ALERT'`);
    expect(alerts).toHaveLength(1); expect(alerts[0].to_addrs).toEqual(['dueno@x.test', 'gerente@x.test']); expect(alerts[0].subject).toContain('Inventario descuadrado');
  });
});
