import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let api: Awaited<ReturnType<typeof import('./helpers').startApi>>; let h: typeof import('./helpers');
beforeAll(async () => {
  process.env.RATE_LIMIT_MAX = '5'; process.env.RATE_LIMIT_AUTH_MAX = '20';
  h = await import('./helpers'); api = await h.startApi();
});
afterAll(async () => { process.env.RATE_LIMIT_MAX = '100000'; process.env.RATE_LIMIT_AUTH_MAX = '1000000'; await api.app.close(); });

describe('límite global de peticiones', () => {
  it('sin sesión: por IP; al excederlo responde 429 RATE_LIMITED (no 500) y es reintentable', async () => {
    const ip = { 'x-forwarded-for': '10.1.1.1' }; const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await api.req('GET', '/health', { headers: ip })).status);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    const blocked = await api.req('GET', '/health', { headers: ip });
    expect(blocked.status).toBe(429); expect(blocked.body.code).toBe('RATE_LIMITED'); expect(blocked.body.retryable).toBe(true);
    expect(blocked.body.message).toMatch(/Demasiados intentos/); expect(JSON.stringify(blocked.body)).not.toMatch(/stack|Error:/);
  });

  it('con sesión: un cubo POR TOKEN; dos tablets tras la misma IP no se bloquean entre sí ni con el límite anónimo', async () => {
    const t = await h.newTenant(api, 'rl'); const lan = { 'x-forwarded-for': '10.2.2.2' };   // la IP pública del restaurante, compartida
    const signIn = async () => (await api.req('POST', '/auth/login', { headers: lan, body: { tenant: t.slug, email: t.adminEmail, password: h.PASSWORD } })).body.accessToken as string;
    const tokA = await signIn(); const tokB = await signIn();
    const hit = async (tok: string, n: number) => { const r: number[] = []; for (let i = 0; i < n; i++) r.push((await api.req('GET', '/auth/me', { token: tok, headers: lan })).status); return r; };
    const a = await hit(tokA, 22);
    expect(a.filter((s) => s === 200).length).toBe(20); expect(a.slice(20)).toEqual([429, 429]);
    expect(await hit(tokB, 3)).toEqual([200, 200, 200]);       // otra sesión, misma IP: intacta
  });

  it('un Bearer inventado NO da un cubo propio: cae en el límite de su IP', async () => {
    const ip = { 'x-forwarded-for': '10.3.3.3' }; const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await api.req('GET', '/health', { headers: { ...ip, authorization: `Bearer falso-${i}-${Math.random()}` } })).status);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
  });
});
