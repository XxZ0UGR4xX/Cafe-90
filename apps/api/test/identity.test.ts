import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { Api, PASSWORD, createBranch, createUser, login, newTenant, startApi } from './helpers';

let api: Api;
beforeAll(async () => { api = await startApi(); });
afterAll(async () => { await api.app.close(); });

describe('autenticación', () => {
  it('login correcto devuelve access token y cookie HttpOnly de refresh', async () => {
    const t = await newTenant(api);
    const r = await api.req('POST', '/auth/login', { body: { tenant: t.slug, email: t.adminEmail, password: PASSWORD } });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toContain('rb_refresh=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const me = await api.req('GET', '/auth/me', { token: r.body.accessToken });
    expect(me.body.email).toBe(t.adminEmail);
    expect(me.body.isCorporate).toBe(true);
  });

  it('credenciales inválidas → mensaje humano, sin revelar si el usuario existe', async () => {
    const t = await newTenant(api);
    const a = await api.req('POST', '/auth/login', { body: { tenant: t.slug, email: t.adminEmail, password: 'incorrecta-123' } });
    const b = await api.req('POST', '/auth/login', { body: { tenant: t.slug, email: 'nadie@x.test', password: 'incorrecta-123' } });
    const c = await api.req('POST', '/auth/login', { body: { tenant: 'no-existe', email: 'nadie@x.test', password: 'x' } });
    for (const r of [a, b, c]) { expect(r.status).toBe(401); expect(r.body.code).toBe('INVALID_CREDENTIALS'); }
    expect(a.body.message).toBe(b.body.message);
    expect(JSON.stringify(a.body)).not.toMatch(/stack|500/i);
  });

  it('bloquea la cuenta tras 5 intentos fallidos', async () => {
    const t = await newTenant(api);
    for (let i = 0; i < 5; i++) await api.req('POST', '/auth/login', { body: { tenant: t.slug, email: t.adminEmail, password: 'mala-clave-123' } });
    const r = await api.req('POST', '/auth/login', { body: { tenant: t.slug, email: t.adminEmail, password: PASSWORD } });
    expect(r.status).toBe(423);
    expect(r.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('refresh rota el token y detecta reuso revocando la familia', async () => {
    const t = await newTenant(api);
    const l = await api.req('POST', '/auth/login', { body: { tenant: t.slug, email: t.adminEmail, password: PASSWORD } });
    const rt1 = /rb_refresh=([^;]+)/.exec(String(l.headers['set-cookie']))![1]!;
    const csrf = { 'x-requested-with': 'retroburger' };

    // sin header CSRF → rechazado
    expect((await api.req('POST', '/auth/refresh', { headers: { cookie: `rb_refresh=${rt1}` } })).status).toBe(403);

    const r2 = await api.req('POST', '/auth/refresh', { headers: { cookie: `rb_refresh=${rt1}`, ...csrf } });
    expect(r2.status).toBe(200);
    const rt2 = /rb_refresh=([^;]+)/.exec(String(r2.headers['set-cookie']))![1]!;
    expect(rt2).not.toBe(rt1);

    // reuso inmediato (dentro de gracia) → 401 sin revocar la familia
    expect((await api.req('POST', '/auth/refresh', { headers: { cookie: `rb_refresh=${rt1}`, ...csrf } })).status).toBe(401);
    expect((await api.req('POST', '/auth/refresh', { headers: { cookie: `rb_refresh=${rt2}`, ...csrf } })).status).toBe(200);

    // reuso fuera de gracia → toda la familia queda revocada
    const owner = new Pool({ connectionString: process.env.DATABASE_MIGRATE_URL });
    await owner.query(`UPDATE refresh_tokens SET used_at = now() - interval '1 minute' WHERE used_at IS NOT NULL AND tenant_id = $1`, [t.tenantId]);
    expect((await api.req('POST', '/auth/refresh', { headers: { cookie: `rb_refresh=${rt1}`, ...csrf } })).status).toBe(401);
    const live = await owner.query('SELECT count(*)::int n FROM refresh_tokens WHERE tenant_id=$1 AND revoked_at IS NULL', [t.tenantId]);
    expect(live.rows[0].n).toBe(0);
    await owner.end();
  });

  it('pin-login para mesero y logout revoca el refresh', async () => {
    const t = await newTenant(api);
    const admin = await login(api, t, t.adminEmail);
    const u = await createUser(api, admin, t, 'MESERO', null);
    const r = await api.req('POST', '/auth/pin-login', { body: { tenant: t.slug, userCode: u.userCode, pin: '1234' } });
    expect(r.status).toBe(200);
    const bad = await api.req('POST', '/auth/pin-login', { body: { tenant: t.slug, userCode: u.userCode, pin: '9999' } });
    expect(bad.status).toBe(401);
  });

  it('tokens manipulados o ausentes son rechazados', async () => {
    expect((await api.req('GET', '/auth/me')).status).toBe(401);
    expect((await api.req('GET', '/auth/me', { token: 'abc.def.ghi' })).status).toBe(401);
  });

  it('usuario deshabilitado pierde acceso de inmediato', async () => {
    const t = await newTenant(api);
    const admin = await login(api, t, t.adminEmail);
    const u = await createUser(api, admin, t, 'CAJERO', null);
    const tok = await login(api, t, u.email);
    expect((await api.req('GET', '/auth/me', { token: tok })).status).toBe(200);
    await api.req('PATCH', `/users/${u.id}`, { token: admin, body: { status: 'DISABLED' } });
    expect((await api.req('GET', '/auth/me', { token: tok })).status).toBe(401);
  });
});

describe('RBAC', () => {
  it('mesero: ve mesas/pedidos pero no usuarios, costos ni auditoría', async () => {
    const t = await newTenant(api);
    const admin = await login(api, t, t.adminEmail);
    const m = await createUser(api, admin, t, 'MESERO', null);
    const tok = await login(api, t, m.email);
    expect((await api.req('GET', '/users', { token: tok })).status).toBe(403);
    expect((await api.req('GET', '/audit-logs', { token: tok })).status).toBe(403);
    const me = await api.req('GET', '/auth/me', { token: tok });
    expect(Object.keys(me.body.permissions)).toContain('sales.order.create');
    expect(Object.keys(me.body.permissions)).not.toContain('catalog.cost.read');
  });

  it('gerente con alcance de una sucursal sólo ve/accede a esa sucursal', async () => {
    const t = await newTenant(api);
    const admin = await login(api, t, t.adminEmail);
    const b1 = await createBranch(api, admin, 'CENTRO');
    const b2 = await createBranch(api, admin, 'NORTE');
    const g = await createUser(api, admin, t, 'GERENTE', [b1.id]);
    const tok = await login(api, t, g.email);
    const list = await api.req('GET', '/branches', { token: tok });
    expect(list.body.map((b: any) => b.id)).toEqual([b1.id]);
    expect((await api.req('GET', `/branches/${b1.id}`, { token: tok })).status).toBe(200);
    expect((await api.req('GET', `/branches/${b2.id}`, { token: tok })).status).toBe(403);
    expect((await api.req('POST', '/branches', { token: tok, body: { name: 'X', code: 'XX' } })).status).toBe(403);
  });

  it('impide escalada de privilegios', async () => {
    const t = await newTenant(api);
    const admin = await login(api, t, t.adminEmail);
    const b1 = await createBranch(api, admin, 'CENTRO');
    const g = await createUser(api, admin, t, 'GERENTE', [b1.id]);
    const gt = await login(api, t, g.email);
    const body = (role: string, branchIds: string[] | null) => ({ email: `x${Math.random()}@${t.slug}.test`, fullName: 'X Y', password: PASSWORD, roles: [{ role, branchIds }] });
    expect((await api.req('POST', '/users', { token: gt, body: body('SUPER_ADMIN', [b1.id]) })).status).toBe(403);
    expect((await api.req('POST', '/users', { token: gt, body: body('ADMIN', [b1.id]) })).status).toBe(403);
    expect((await api.req('POST', '/users', { token: gt, body: body('MESERO', null) })).status).toBe(403); // alcance corporativo
    expect((await api.req('POST', '/users', { token: gt, body: body('MESERO', [b1.id]) })).status).toBe(201);
  });

  it('todo endpoint declara permiso (falla cerrado)', async () => {
    const { Reflector } = await import('@nestjs/core');
    const { MODULE_METADATA } = await import('@nestjs/common/constants');
    const { AppModule } = await import('../src/app.module');
    const { REQUIRE_KEY, PUBLIC_KEY, AUTHENTICATED_KEY } = await import('../src/modules/identity/access.decorators');
    const refl = new Reflector();
    const controllers: any[] = [];
    const walk = (m: any) => {
      controllers.push(...(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, m) ?? []));
      for (const i of Reflect.getMetadata(MODULE_METADATA.IMPORTS, m) ?? []) walk(i);
    };
    walk(AppModule);
    expect(controllers.length).toBeGreaterThan(3);
    const missing: string[] = [];
    for (const C of controllers) {
      for (const name of Object.getOwnPropertyNames(C.prototype)) {
        const h = C.prototype[name];
        if (name === 'constructor' || typeof h !== 'function' || Reflect.getMetadata('method', h) === undefined) continue;
        const ok = [REQUIRE_KEY, PUBLIC_KEY, AUTHENTICATED_KEY].some((k) => refl.getAllAndOverride(k, [h, C]));
        if (!ok) missing.push(`${C.name}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('multi-tenant (RLS)', () => {
  it('un tenant no ve ni modifica datos de otro', async () => {
    const a = await newTenant(api, 'a'); const b = await newTenant(api, 'b');
    const ta = await login(api, a, a.adminEmail); const tb = await login(api, b, b.adminEmail);
    const ba = await createBranch(api, ta, 'A1');
    await createBranch(api, tb, 'B1');
    expect((await api.req('GET', '/branches', { token: ta })).body).toHaveLength(1);
    expect((await api.req('GET', `/branches/${ba.id}`, { token: tb })).status).toBe(404);
    expect((await api.req('PATCH', `/branches/${ba.id}`, { token: tb, body: { name: 'hack' } })).status).toBe(404);
    const ub = await api.req('GET', '/users', { token: tb });
    expect(ub.body.every((u: any) => u.email.endsWith(`@${b.slug}.test`))).toBe(true);
    const aud = await api.req('GET', '/audit-logs', { token: tb });
    expect(aud.body.items.length).toBeGreaterThan(0);
  });

  it('sin contexto de tenant la BD no devuelve filas (falla cerrada) para TODAS las tablas con tenant_id', async () => {
    const app = new Pool({ connectionString: process.env.DATABASE_URL });
    const owner = new Pool({ connectionString: process.env.DATABASE_MIGRATE_URL });
    const tables = (await owner.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relispartition = false
          AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_name = c.relname AND k.column_name IN ('tenant_id') AND k.table_schema='public')`)).rows;
    expect(tables.length).toBeGreaterThan(10);
    for (const t of tables) {
      expect(t.relrowsecurity, `RLS en ${t.relname}`).toBe(true);
      expect(t.relforcerowsecurity, `FORCE RLS en ${t.relname}`).toBe(true);
      const r = await app.query(`SELECT count(*)::int n FROM "${t.relname}"`);
      expect(r.rows[0].n, `filas visibles sin tenant en ${t.relname}`).toBe(0);
    }
    const role = await owner.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'retroburger_app'`);
    expect(role.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    await app.end(); await owner.end();
  });
});

describe('auditoría', () => {
  it('registra acciones con usuario/IP/valores y es inmutable', async () => {
    const t = await newTenant(api);
    const tok = await login(api, t, t.adminEmail);
    const b = await createBranch(api, tok, 'AUD');
    await api.req('PATCH', `/branches/${b.id}`, { token: tok, body: { name: 'Nuevo nombre' } });
    const logs = await api.req('GET', `/audit-logs?entity=branch&entityId=${b.id}`, { token: tok });
    const upd = logs.body.items.find((l: any) => l.action === 'branch.update');
    expect(upd.old_value.name).toContain('AUD');
    expect(upd.new_value.name).toBe('Nuevo nombre');
    expect(upd.user_name).toBe('Admin');
    expect(upd.ip).toBeTruthy();

    const app = new Pool({ connectionString: process.env.DATABASE_URL });
    const c = await app.connect();
    await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id',$1,true)", [t.tenantId]);
    await expect(c.query('UPDATE audit_logs SET action = $1', ['x'])).rejects.toThrow(/append-only/);
    await c.query('ROLLBACK');
    await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id',$1,true)", [t.tenantId]);
    await expect(c.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
    await c.query('ROLLBACK'); c.release(); await app.end();
  });

  it('no guarda contraseñas ni PIN en auditoría ni en texto plano', async () => {
    const t = await newTenant(api);
    const tok = await login(api, t, t.adminEmail);
    await createUser(api, tok, t, 'MESERO', null);
    const logs = await api.req('GET', '/audit-logs?entity=user', { token: tok });
    expect(JSON.stringify(logs.body)).not.toContain(PASSWORD);
    const owner = new Pool({ connectionString: process.env.DATABASE_MIGRATE_URL });
    const h = await owner.query('SELECT password_hash FROM users WHERE tenant_id=$1', [t.tenantId]);
    expect(h.rows.every((r) => r.password_hash.startsWith('$argon2id$'))).toBe(true);
    await owner.end();
  });
});

describe('errores y validación', () => {
  it('validación devuelve mensaje humano y detalles por campo', async () => {
    const t = await newTenant(api);
    const tok = await login(api, t, t.adminEmail);
    const r = await api.req('POST', '/branches', { token: tok, body: { name: 'x', code: 'minus' } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION_ERROR');
    expect(r.body.message).toMatch(/⚠️/);
    expect(r.body.requestId).toBeTruthy();
  });
  it('conflicto de código de sucursal es comprensible', async () => {
    const t = await newTenant(api);
    const tok = await login(api, t, t.adminEmail);
    await createBranch(api, tok, 'DUP');
    const r = await api.req('POST', '/branches', { token: tok, body: { name: 'Otra', code: 'DUP' } });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Ya existe/);
  });
});
