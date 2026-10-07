import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startApi } from './helpers';

let api: Api;
beforeAll(async () => { delete process.env.METRICS_TOKEN; api = await startApi(); });
afterAll(async () => { await api.app.close(); });

describe('métricas deshabilitadas por defecto', () => {
  it('sin METRICS_TOKEN el endpoint no existe (404), con o sin credenciales', async () => {
    expect((await api.req('GET', '/metrics')).status).toBe(404);
    expect((await api.req('GET', '/metrics', { headers: { authorization: 'Bearer lo-que-sea-lo-que-sea' } })).status).toBe(404);
  });
});
