import { createServer } from 'node:net';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrintAgent } from '../src/agent';
import type { AgentApi, PrintJob, PrinterInfo } from '../src/client';
import { fileTransport, networkTransport, PrinterOfflineError, transportFor, type Transport } from '../src/transport';

const printer = (over: Partial<PrinterInfo> = {}): PrinterInfo => ({ id: 'p1', branchId: 'b', name: 'Cocina', role: 'KITCHEN', connection: { type: 'network', host: '127.0.0.1', port: 1 }, columns: 42, isActive: true, ...over });

class FakeApi implements AgentApi {
  acks: { id: string; ok: boolean }[] = []; calls = 0;
  constructor(public printersList: PrinterInfo[], public jobs: Record<string, PrintJob[]>) {}
  async printers() { return this.printersList; }
  async pending(id: string) { this.calls++; return (this.jobs[id] ?? []).filter((j) => !this.acks.some((a) => a.id === j.id && a.ok)); }
  async ack(id: string, ok: boolean) { this.acks.push({ id, ok }); }
}
const job = (id: string, content = 'Orden #1', kind = 'KITCHEN_TICKET'): PrintJob => ({ id, kind, content, attempts: 0 });

describe('transportes', () => {
  it('red: entrega los bytes por TCP', async () => {
    const got: Buffer[] = [];
    const srv = createServer((s) => { s.on('data', (d) => got.push(d)); }); await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as any).port;
    await networkTransport('127.0.0.1', port).send(Buffer.from('hola'));
    await new Promise((r) => setTimeout(r, 30));
    expect(Buffer.concat(got).toString()).toBe('hola'); srv.close();
  });
  it('red: impresora apagada → PrinterOfflineError', async () => {
    await expect(networkTransport('127.0.0.1', 1, 500).send(Buffer.from('x'))).rejects.toBeInstanceOf(PrinterOfflineError);
  });
  it('archivo/dispositivo: agrega los bytes; ruta inválida → PrinterOfflineError', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pa-')); const f = join(dir, 'lp0');
    await fileTransport(f).send(Buffer.from('ab')); await fileTransport(f).send(Buffer.from('cd'));
    expect((await readFile(f)).toString()).toBe('abcd');
    await expect(fileTransport(join(dir, 'no', 'existe', 'lp')).send(Buffer.from('x'))).rejects.toBeInstanceOf(PrinterOfflineError);
  });
});

describe('política local del agente (el servidor no manda sobre el equipo)', () => {
  const pol = { allowedPaths: ['/dev/'], allowedHosts: ['impresora.local'], allowPublic: false };
  it('solo dispositivos /dev y hosts de la red local', () => {
    expect(transportFor({ type: 'file', path: '/home/pi/.profile' }, pol)).toBeNull();
    expect(transportFor({ type: 'file', path: '/dev/../etc/cron.d/x' }, pol)).toBeNull();
    expect(transportFor({ type: 'usb', path: '/dev/usb/lp0' }, pol)).not.toBeNull();
    expect(transportFor({ type: 'network', host: '192.168.1.50', port: 9100 }, pol)).not.toBeNull();
    expect(transportFor({ type: 'network', host: '8.8.8.8' }, pol)).toBeNull();
    expect(transportFor({ type: 'network', host: '169.254.169.254' }, pol)).toBeNull();
    expect(transportFor({ type: 'network', host: 'otro.example.com' }, pol)).toBeNull();
    expect(transportFor({ type: 'network', host: 'impresora.local' }, pol)).not.toBeNull();
    expect(transportFor({ type: 'network', host: '10.0.0.5', port: 70000 }, pol)).toBeNull();
    expect(transportFor({ type: 'network', host: '8.8.8.8' }, { ...pol, allowPublic: true })).not.toBeNull();
  });
});

describe('agente', () => {
  it('imprime en orden, codifica ESC/POS y confirma cada trabajo', async () => {
    const sent: Buffer[] = [];
    const api = new FakeApi([printer()], { p1: [job('j1', 'Orden #1 ñ'), job('j2', 'Orden #2')] });
    const agent = new PrintAgent(api, { branchId: 'b', pollMs: 10, transport: () => ({ send: async (d) => { sent.push(d); } }) });
    expect(await agent.tick()).toBe(2);
    expect(api.acks).toEqual([{ id: 'j1', ok: true }, { id: 'j2', ok: true }]);
    expect(sent[0]!.subarray(0, 2).toString('hex')).toBe('1b40');
    expect(sent[0]!.includes(0xa4)).toBe(true);              // ñ en CP858
    expect(sent[0]!.includes(Buffer.from([0x1d, 0x21, 0x01]))).toBe(true);   // comanda: doble alto
    expect(await agent.tick()).toBe(0);                      // nada pendiente → no reimprime
  });

  it('impresora apagada: no confirma ni salta trabajos, espera con backoff y recupera sin perder nada', async () => {
    let online = false; const sent: string[] = [];
    const t: Transport = { send: async (d) => { if (!online) throw new PrinterOfflineError('apagada'); sent.push(d.toString('latin1')); } };
    const api = new FakeApi([printer()], { p1: [job('j1', 'UNO'), job('j2', 'DOS')] });
    const logs: string[] = [];
    const agent = new PrintAgent(api, { branchId: 'b', pollMs: 10, transport: () => t, log: (_l, m) => logs.push(m) });
    const t0 = 1_000_000;
    expect(await agent.tick(t0)).toBe(0);
    expect(api.acks).toEqual([]);                            // ningún ack: los trabajos siguen PENDING en la API
    const callsAfterFirst = api.calls;
    expect(await agent.tick(t0 + 500)).toBe(0); expect(api.calls).toBe(callsAfterFirst);   // en espera: ni siquiera consulta
    online = true;
    expect(await agent.tick(t0 + 2500)).toBe(2);             // pasó el backoff → imprime AMBOS en orden
    expect(sent.map((s) => /UNO|DOS/.exec(s)![0])).toEqual(['UNO', 'DOS']);
    expect(logs.some((l) => l.includes('sin conexión'))).toBe(true);
  });

  it('el backoff crece (2s, 4s, …) hasta un máximo', async () => {
    const api = new FakeApi([printer()], { p1: [job('j1')] });
    const agent = new PrintAgent(api, { branchId: 'b', pollMs: 10, maxBackoffMs: 5000, transport: () => ({ send: async () => { throw new PrinterOfflineError('x'); } }) });
    let t = 0; const waits: number[] = [];
    for (let i = 0; i < 4; i++) { const before = api.calls; await agent.tick(t); waits.push((agent as any).backoff.get('p1').ms); t += 10_000; expect(api.calls).toBeGreaterThan(before); }
    expect(waits).toEqual([2000, 4000, 5000, 5000]);
  });

  it('impresora sin conexión configurada o inactiva: error no recuperable / se ignora', async () => {
    const api = new FakeApi([printer({ id: 'p1', connection: {} }), printer({ id: 'p2', isActive: false })], { p1: [job('j1')], p2: [job('j2')] });
    const agent = new PrintAgent(api, { branchId: 'b', pollMs: 10 });
    await agent.tick();
    expect(api.acks).toEqual([{ id: 'j1', ok: false }]);     // se cuenta intento (a los 3 → FAILED en la API)
  });

  it('un error de la API no mata el ciclo ni lanza', async () => {
    const api = new FakeApi([printer()], {}); api.printers = async () => { throw new Error('API caída'); };
    const logs: string[] = [];
    const agent = new PrintAgent(api, { branchId: 'b', pollMs: 10, log: (_l, m) => logs.push(m) });
    expect(await agent.tick()).toBe(0); expect(logs[0]).toContain('API caída');
    expect(await agent.tick()).toBe(0);                      // sigue vivo (running liberado)
  });
});
