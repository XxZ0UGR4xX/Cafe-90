import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startApi } from './helpers';
import { Fixture, buildFixture } from './fixtures';

let api: Api; let f: Fixture;
beforeAll(async () => { api = await startApi(); f = await buildFixture(api, 'reg'); });
afterAll(async () => { await f.close(); await api.app.close(); });

describe('caja: una persona por caja', () => {
  it('si la caja ya está abierta por otra persona, el mensaje dice quién (no "ya tienes una caja")', async () => {
    const open = (token: string) => api.req('POST', '/cash/shifts/open', { token, body: { branchId: f.branchId, openingFloat: 100 } });
    expect((await open(f.tokens.cajero)).status).toBe(201);
    const r = await open(f.tokens.gerente);
    expect(r.status).toBe(409); expect(r.body.code).toBe('REGISTER_IN_USE'); expect(r.body.message).toContain('User cajero');
    // quien ya tiene su turno sigue recibiendo el aviso propio
    expect((await open(f.tokens.cajero)).body.code).toBe('SHIFT_ALREADY_OPEN');
  });
});
