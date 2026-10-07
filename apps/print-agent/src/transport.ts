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

/**
 * Política LOCAL del agente: no confía en lo que diga el servidor. Un administrador (o una cuenta comprometida) no puede
 * hacer que el agente escriba en archivos del equipo ni conecte a hosts arbitrarios.
 *  - Dispositivos: solo bajo /dev/ (o los prefijos de AGENT_ALLOWED_PATHS).
 *  - Red: IP privada/loopback (o los hosts de AGENT_ALLOWED_HOSTS; AGENT_ALLOW_PUBLIC_HOSTS=1 abre cualquier IP). Se excluye link-local/metadatos.
 */
export interface TransportPolicy { allowedPaths: string[]; allowedHosts: string[]; allowPublic: boolean }
export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): TransportPolicy {
  const list = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return { allowedPaths: ['/dev/', ...list(env.AGENT_ALLOWED_PATHS)], allowedHosts: list(env.AGENT_ALLOWED_HOSTS), allowPublic: env.AGENT_ALLOW_PUBLIC_HOSTS === '1' };
}
export function hostAllowed(host: string, policy: TransportPolicy): boolean {
  if (policy.allowedHosts.includes(host)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;                                   // nombres de host solo si están en la lista
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return false;
  if (a === 169 && b === 254) return false;               // link-local / metadatos de nube
  if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return true;
  return policy.allowPublic;
}
export function pathAllowed(path: string, policy: TransportPolicy): boolean {
  return !path.includes('..') && policy.allowedPaths.some((p) => path.startsWith(p));
}

export function transportFor(connection: Record<string, unknown>, policy: TransportPolicy = policyFromEnv()): Transport | null {
  if (connection.type === 'network' && typeof connection.host === 'string') {
    const port = Number(connection.port ?? 9100);
    if (!hostAllowed(connection.host, policy) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return networkTransport(connection.host, port);
  }
  if ((connection.type === 'file' || connection.type === 'usb') && typeof connection.path === 'string') {
    return pathAllowed(connection.path, policy) ? fileTransport(connection.path) : null;
  }
  return null;
}
