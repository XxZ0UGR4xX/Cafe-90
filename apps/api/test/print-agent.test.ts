import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, PASSWORD, createUser, login, startApi } from './helpers';
import { Fixture, buildFixture, item } from './fixtures';
import { PrintAgent } from '../../print-agent/src/agent';
import type { AgentApi } from '../../print-agent/src/client';

let api: Api; let f: Fixture; let server: Server; const received: Buffer[] = []; let port = 0;
beforeAll(async () => {
  api = await startApi(); f = await buildFixture(api, 'pa');
  server = createServer((s) => { s.on('data', (d) => received.push(d)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); port = (server.address() as any).port;
  await api.req('POST', '/cash/shifts/open', { token: f.tokens.cajero, body: { branchId: f.branchId, openingFloat: 100 } });
});
afterAll(async () => { server.close(); await f.close(); await api.app.close(); });

/** Adaptador: el agente real hablando con la API real (inyectada), sin HTTP. */
const apiFor = (token: string): AgentApi => ({
  printers: async (b) => (await api.req('GET', `/printers?branchId=${b}`, { token })).body,
  pending: async (p) => { const r = await api.req('GET', `/print/jobs/pending?printerId=${p}`, { token }); if (r.status !== 200) throw new Error(String(r.status)); return r.body; },
  ack: async (id, ok) => { await api.req('POST', `/print/jobs/${id}/ack`, { token, body: { ok } }); },
});
const status = async (id: string) => (await f.sql('SELECT status, attempts FROM print_jobs WHERE id=$1', [id]))[0];

describe('agente de impresión ↔ API', () => {
  it('cuenta de servicio IMPRESION: sólo gestiona la cola; recoge y confirma trabajos reales hacia una impresora TCP', async () => {
    const svc = await createUser(api, f.admin, f.t, 'IMPRESION', [f.branchId], 'agente');
    const tok = await login(api, f.t, svc.email, PASSWORD);
    expect((await api.req('GET', '/auth/me', { token: tok })).body.permissions).toEqual({ 'printing.manage': expect.anything() });
    expect((await api.req('GET', `/orders?branchId=${f.branchId}`, { token: tok })).status).toBe(403);   // no ve ventas

    const pr = (await api.req('POST', '/printers', { token: f.admin, body: { branchId: f.branchId, name: 'Cocina', role: 'KITCHEN', columns: 32, connection: { type: 'network', host: '127.0.0.1', port } } })).body;
    const o = (await api.req('POST', '/orders', { token: f.tokens.mesero, body: { branchId: f.branchId, channel: 'TAKEAWAY', items: [item(f.prod.papas, { notes: 'sin sal ñandú' })], send: true } })).body;
    const agent = new PrintAgent(apiFor(tok), { branchId: f.branchId, pollMs: 10 });
    expect(await agent.tick()).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    const bytes = Buffer.concat(received);
    expect(bytes.subarray(0, 2).toString('hex')).toBe('1b40');                       // ESC @
    expect(bytes.toString('latin1')).toContain('PAPAS');
    expect(bytes.includes(Buffer.from([0x1d, 0x56, 0x42, 0x00]))).toBe(true);        // corte
    const job = (await f.sql(`SELECT id, status FROM print_jobs WHERE printer_id=$1`, [pr.id]))[0];
    expect(job.status).toBe('PRINTED');
    expect(await agent.tick()).toBe(0);                                              // ya confirmado: no reimprime
    expect(o.number).toBeGreaterThan(0);
  });

  it('impresora apagada: el trabajo queda PENDING sin gastar intentos y sale cuando vuelve', async () => {
    const pr = (await api.req('POST', '/printers', { token: f.admin, body: { branchId: f.branchId, name: 'Bar', role: 'BAR', columns: 42, stationKeys: ['BEBIDAS'], connection: { type: 'network', host: '127.0.0.1', port: 1 } } })).body;
    await api.req('POST', '/orders', { token: f.tokens.mesero, body: { branchId: f.branchId, channel: 'TAKEAWAY', items: [item(f.prod.cola)], send: true } });
    const j = (await f.sql(`SELECT id FROM print_jobs WHERE printer_id=$1`, [pr.id]))[0];
    const agent = new PrintAgent(apiFor(f.tokens.gerente), { branchId: f.branchId, pollMs: 10 });
    await agent.tick(5_000_000);
    expect(await status(j.id)).toMatchObject({ status: 'PENDING', attempts: 0 });
    await api.req('PUT', `/printers/${pr.id}`, { token: f.admin, body: { branchId: f.branchId, name: 'Bar', role: 'BAR', columns: 42, stationKeys: ['BEBIDAS'], connection: { type: 'network', host: '127.0.0.1', port } } });
    expect(await agent.tick(5_000_000 + 3000)).toBe(1);
    expect((await status(j.id)).status).toBe('PRINTED');
  });

  it('seguridad: no se leen ni confirman trabajos de otra sucursal; el ack es idempotente; 3 fallos → FAILED', async () => {
    const other = await api.req('POST', '/branches', { token: f.admin, body: { name: 'Otra', code: 'OTRA' } });
    const gerOther = await createUser(api, f.admin, f.t, 'GERENTE', [other.body.id], 'gerotra');
    const tok = await login(api, f.t, gerOther.email, PASSWORD);
    const printers = (await api.req('GET', `/printers?branchId=${f.branchId}`, { token: f.admin })).body;
    expect((await api.req('GET', `/print/jobs/pending?printerId=${printers[0].id}`, { token: tok })).status).toBe(403);
    await api.req('POST', '/orders', { token: f.tokens.mesero, body: { branchId: f.branchId, channel: 'TAKEAWAY', items: [item(f.prod.papas)], send: true } });
    const j = (await f.sql(`SELECT id FROM print_jobs WHERE status='PENDING' ORDER BY created_at DESC LIMIT 1`))[0];
    expect((await api.req('POST', `/print/jobs/${j.id}/ack`, { token: tok, body: { ok: true } })).status).toBe(403);
    for (let i = 0; i < 3; i++) await api.req('POST', `/print/jobs/${j.id}/ack`, { token: f.admin, body: { ok: false } });
    expect((await status(j.id)).status).toBe('FAILED');
    expect((await api.req('POST', `/print/jobs/${j.id}/ack`, { token: f.admin, body: { ok: true } })).body.status).toBe('FAILED');   // no revive
  });
});
