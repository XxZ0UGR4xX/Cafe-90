import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const TOKEN = 'metrics-token-0123456789';
let startApi: typeof import('./helpers').startApi; let newTenant: typeof import('./helpers').newTenant; let login: typeof import('./helpers').login; let PASSWORD: string;
let api: Awaited<ReturnType<typeof import('./helpers').startApi>>;
beforeAll(async () => {
  process.env.METRICS_TOKEN = TOKEN;
  ({ startApi, newTenant, login, PASSWORD } = await import('./helpers'));
  api = await startApi();
});
afterAll(async () => { delete process.env.METRICS_TOKEN; await api.app.close(); });
const scrape = (auth?: string) => api.req('GET', '/metrics', { headers: auth ? { authorization: auth } : {} });

describe('métricas Prometheus', () => {
  it('exige el token (Bearer) y no es accesible sin él', async () => {
    expect((await scrape()).status).toBe(401);
    expect((await scrape('Bearer incorrecto-incorrecto')).status).toBe(401);
    expect((await scrape(`Bearer ${TOKEN}`)).status).toBe(200);
  });

  it('etiqueta rutas con la plantilla (sin ids), cuenta fallos de login y expone pool y procesos', async () => {
    const t = await newTenant(api, 'met');
    const token = await login(api, t, t.adminEmail);
    await api.req('GET', `/orders/${randomUUID()}`, { token });
    await api.req('POST', '/auth/login', { body: { tenant: t.slug, email: t.adminEmail, password: 'mala-clave-123' } });
    const text = String((await scrape(`Bearer ${TOKEN}`)).body);
    expect(text).toMatch(/rb_http_request_duration_seconds_count\{[^}]*route="\/orders\/:id"[^}]*status="404"/);
    expect(text).toMatch(/rb_http_request_duration_seconds_count\{[^}]*route="\/auth\/login"[^}]*status="401"/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);      // ni un UUID en las etiquetas
    expect(text).not.toContain(t.adminEmail);
    expect(text).toMatch(/rb_login_failures_total\{[^}]*\} [1-9]/);
    expect(text).toMatch(/rb_db_pool_connections\{[^}]*state="total"[^}]*\} \d+/);
    expect(text).toContain('rb_process_cpu_user_seconds_total');
    expect(text).not.toContain('route="/metrics"');                                                   // el scrape no se mide a sí mismo
  });
});
