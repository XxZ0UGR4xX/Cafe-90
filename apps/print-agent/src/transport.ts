import { createConnection } from 'node:net';
import { appendFile } from 'node:fs/promises';

/** Error de conectividad: el trabajo NO se pierde, se reintenta cuando la impresora vuelva. */
export class PrinterOfflineError extends Error {}

export interface Transport { send(data: Buffer): Promise<void> }

/** TCP crudo (puerto 9100 de impresoras de red). */
export function networkTransport(host: string, port = 9100, timeoutMs = 5000): Transport {
  return {
    send: (data) => new Promise<void>((resolve, reject) => {
      const sock = createConnection({ host, port });
      let done = false;
      const fail = (e: Error) => { if (!done) { done = true; sock.destroy(); reject(new PrinterOfflineError(`${host}:${port} — ${e.message}`)); } };
      sock.setTimeout(timeoutMs, () => fail(new Error('tiempo de espera agotado')));
      sock.once('error', fail);
      sock.once('connect', () => { sock.end(data, () => undefined); });
      sock.once('close', () => { if (!done) { done = true; resolve(); } });
    }),
  };
}

/** Dispositivo o archivo (p. ej. /dev/usb/lp0 en Linux, o un archivo para pruebas). */
export function fileTransport(path: string): Transport {
  return { send: async (data) => { try { await appendFile(path, data); } catch (e) { throw new PrinterOfflineError(`${path} — ${(e as Error).message}`); } } };
}

export function transportFor(connection: Record<string, unknown>): Transport | null {
  if (connection.type === 'network' && typeof connection.host === 'string') return networkTransport(connection.host, Number(connection.port ?? 9100));
  if ((connection.type === 'file' || connection.type === 'usb') && typeof connection.path === 'string') return fileTransport(connection.path);
  return null;
}
