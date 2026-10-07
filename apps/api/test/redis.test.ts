import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as client } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { MemoryRateLimiter, RedisRateLimiter } from '../src/common/rate-limiter';
import { connectRedis } from '../src/infra/redis.module';

const URL = process.env.REDIS_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('rate limiter en memoria', () => {
  it('cuenta por ventana y se reinicia', async () => {
    const l = new MemoryRateLimiter(2, 1000);
    expect([await l.hit('k', 0), await l.hit('k', 10), await l.hit('k', 20)]).toEqual([false, false, true]);
    expect(await l.hit('k', 1500)).toBe(false);          // ventana nueva
    expect(await l.hit('otra', 0)).toBe(false);          // claves independientes
  });
});

// Estas pruebas necesitan un Redis real: se omiten sin REDIS_URL (en CI hay un servicio redis).
describe.skipIf(!URL)('Redis (compartido entre réplicas)', () => {
  let r: Redis; const prefix = `t${Date.now()}`;
  beforeAll(() => { r = connectRedis(URL!); });
  afterAll(async () => { await r.quit(); });

  it('el límite es COMPARTIDO: dos limitadores (dos réplicas) suman sus peticiones; la ventana expira; fail-open si Redis cae', async () => {
    const a = new RedisRateLimiter(r, 3, 400, prefix), b = new RedisRateLimiter(r, 3, 400, prefix);
    expect(await a.hit('ip1')).toBe(false); expect(await b.hit('ip1')).toBe(false); expect(await a.hit('ip1')).toBe(false);
    expect(await b.hit('ip1')).toBe(true);               // la 4.ª, aunque cada réplica sólo vio 2
    expect(await a.hit('ip2')).toBe(false);              // otra clave
    await sleep(500);
    expect(await a.hit('ip1')).toBe(false);              // ventana nueva
    const dead = connectRedis('redis://127.0.0.1:1');
    const errors: string[] = []; const c = new RedisRateLimiter(dead, 1, 1000, prefix, (e) => errors.push(e.message));
    expect(await c.hit('x')).toBe(false); expect(await c.hit('x')).toBe(false);   // nunca bloquea si Redis no responde
    expect(errors.length).toBe(2); dead.disconnect();
  });

  it('dos instancias de la API: el login se limita en conjunto y un evento de la instancia B llega a un socket de la A', async () => {
    process.env.REDIS_URL = URL; process.env.LOGIN_RATE_LIMIT_MAX = '3';
    const { startApi, newTenant, login, createBranch, PASSWORD } = await import('./helpers');
    const A = await startApi(); const B = await startApi();
    try {
      await A.app.listen(0, '127.0.0.1');
      const t = await newTenant(A, 'rds');
      const bad = (api: typeof A) => api.req('POST', '/auth/login', { body: { tenant: t.slug, email: `nadie-${prefix}@x.test`, password: 'x' } });
      const codes: number[] = [];
      for (const api of [A, B, A, B]) codes.push((await bad(api)).status);
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]); expect(codes[3]).toBe(429);   // el 4.º, en la OTRA réplica, ya está limitado

      // tiempo real entre réplicas
      const admin = await login(A, t, t.adminEmail, PASSWORD);
      const branch = await createBranch(A, admin, 'RDS');
      const port = (A.app.getHttpServer().address() as AddressInfo).port;
      const sock = client(`http://127.0.0.1:${port}`, { path: '/ws', auth: { token: admin }, transports: ['websocket'] });
      await new Promise<void>((res, rej) => { sock.on('ready', () => res()); sock.on('error', rej); setTimeout(() => rej(new Error('sin ready')), 5000); });
      const got = new Promise<any>((res) => sock.on('TableChanged', res));
      // la mesa se crea y se abre desde la instancia B (el socket está en la A)
      const table = (await B.req('POST', `/branches/${branch.id}/tables`, { token: admin, body: { number: 1, capacity: 4 } })).body;
      await B.req('POST', `/tables/${table.id}/open`, { token: admin, body: { guests: 2 } });
      const ev = await Promise.race([got, sleep(5000).then(() => null)]);
      expect(ev).toBeTruthy(); expect(ev.branchId).toBe(branch.id);
      sock.close();
      const ready = (await B.req('GET', '/ready')).body; expect(ready).toEqual({ status: 'ready', redis: 'up' });
    } finally { await A.app.close(); await B.app.close(); delete process.env.REDIS_URL; delete process.env.LOGIN_RATE_LIMIT_MAX; }
  });
});
