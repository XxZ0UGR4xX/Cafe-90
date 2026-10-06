import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { Api, PASSWORD, createBranch, createUser, login, newTenant, startApi } from './helpers';
import { ENV, type Env } from '../src/config/env';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, generateRecoveryCodes, hashRecovery, looksLikeRecovery, otpauthUri, stepAt, totpAt, verifyTotp } from '../src/modules/identity/totp';

describe('totp (RFC 6238)', () => {
  // Vectores de prueba del RFC 6238 (SHA-1, secreto ASCII "12345678901234567890"), truncados a 6 dígitos
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']])(
    'código esperado en t=%i', (t, code) => { expect(totpAt(secret, t * 1000)).toBe(code); });

  it('base32 ida y vuelta', () => { const b = Buffer.from('hola retroburger'); expect(base32Decode(base32Encode(b)).equals(b)).toBe(true); });

  it('acepta ±1 paso, rechaza más lejano y rechaza reuso (anti-replay)', () => {
    const now = 1_700_000_000_000;
    const code = totpAt(secret, now);
    expect(verifyTotp(secret, code, null, now)).toBe(stepAt(now));
    expect(verifyTotp(secret, code, null, now + 30_000)).toBe(stepAt(now)); // desfase de un paso
    expect(verifyTotp(secret, code, null, now + 120_000)).toBeNull();      // fuera de ventana
    expect(verifyTotp(secret, code, stepAt(now), now)).toBeNull();         // ya usado
    expect(verifyTotp(secret, '12345', null, now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });

  it('cifrado AES-GCM: ida y vuelta, no determinista, con clave incorrecta o manipulado falla', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP', 'k'.repeat(32));
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(encryptSecret('JBSWY3DPEHPK3PXP', 'k'.repeat(32))).not.toBe(a);
    expect(decryptSecret(a, 'k'.repeat(32))).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(a, 'x'.repeat(32))).toThrow();
    const parts = a.split('.'); parts[3] = Buffer.from('manipulado').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), 'k'.repeat(32))).toThrow();
  });

  it('códigos de recuperación: formato, unicidad y normalización', () => {
    const codes = generateRecoveryCodes(); expect(new Set(codes).size).toBe(10);
    for (const c of codes) { expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/); expect(looksLikeRecovery(c)).toBe(true); }
    expect(hashRecovery(codes[0]!)).toBe(hashRecovery(codes[0]!.toLowerCase().replace('-', ' ')));
    expect(looksLikeRecovery('123456')).toBe(false);
    expect(otpauthUri('ABC', 'a@b.test', 'Retro Burger')).toContain('issuer=Retro%20Burger');
  });
});

let api: Api; let env: Env; let pool: Pool;
beforeAll(async () => { api = await startApi(); env = api.app.get<Env>(ENV); pool = new Pool({ connectionString: process.env.DATABASE_MIGRATE_URL }); });
afterAll(async () => { env.MFA_ENFORCE = 'false'; await pool.end(); await api.app.close(); });

async function asTenant(tenantId: string, sql: string, params: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    const r = await c.query(sql, params); await c.query('COMMIT'); return r.rows;
  } finally { c.release(); }
}
const loginBody = (t: { slug: string }, email: string) => ({ tenant: t.slug, email, password: PASSWORD });
async function enableMfa(t: { slug: string }, email: string) {
  const token = await login(api, t, email);
  const s = await api.req('POST', '/auth/2fa/setup', { token });
  expect(s.status).toBe(200);
  const en = await api.req('POST', '/auth/2fa/enable', { token, body: { code: totpAt(s.body.secret) } });
  expect(en.status).toBe(200);
  return { secret: s.body.secret as string, recoveryCodes: en.body.recoveryCodes as string[], token };
}
// el paso 30s no se puede reusar: para el siguiente login se usa un código de un paso adelante (dentro de la ventana ±1)
const nextCode = (secret: string, step: number) => totpAt(secret, (stepAt(Date.now()) + step) * 30_000);

describe('2FA TOTP — flujo de login', () => {
  it('sin 2FA el login sigue entregando sesión; me.mfa.enabled = false', async () => {
    const t = await newTenant(api);
    const token = await login(api, t, t.adminEmail);
    expect((await api.req('GET', '/auth/me', { token })).body.mfa).toEqual({ enabled: false, required: false });
  });

  it('enrolar → login exige código → verificar entrega sesión y cookie', async () => {
    const t = await newTenant(api, 'mfa');
    const { secret } = await enableMfa(t, t.adminEmail);

    const r = await api.req('POST', '/auth/login', { body: loginBody(t, t.adminEmail) });
    expect(r.status).toBe(200);
    expect(r.body.mfaRequired).toBe(true);
    expect(r.body.accessToken).toBeUndefined();
    expect(String(r.headers['set-cookie'] ?? '')).not.toContain('rb_refresh');

    // el token intermedio NO sirve como Bearer
    expect((await api.req('GET', '/auth/me', { token: r.body.mfaToken })).status).toBe(401);

    expect((await api.req('POST', '/auth/2fa/verify', { body: { mfaToken: r.body.mfaToken, code: '000000' } })).body.code).toBe('MFA_INVALID');
    const ok = await api.req('POST', '/auth/2fa/verify', { body: { mfaToken: r.body.mfaToken, code: nextCode(secret, 1) } });
    expect(ok.status).toBe(200);
    expect(String(ok.headers['set-cookie'])).toContain('rb_refresh=');
    const me = await api.req('GET', '/auth/me', { token: ok.body.accessToken });
    expect(me.body.mfa.enabled).toBe(true);
  });

  it('un código ya usado no se acepta de nuevo (anti-replay)', async () => {
    const t = await newTenant(api, 'mfa');
    const { secret } = await enableMfa(t, t.adminEmail);
    const l = await api.req('POST', '/auth/login', { body: loginBody(t, t.adminEmail) });
    const code = nextCode(secret, 1);
    expect((await api.req('POST', '/auth/2fa/verify', { body: { mfaToken: l.body.mfaToken, code } })).status).toBe(200);
    const l2 = await api.req('POST', '/auth/login', { body: loginBody(t, t.adminEmail) });
    expect((await api.req('POST', '/auth/2fa/verify', { body: { mfaToken: l2.body.mfaToken, code } })).body.code).toBe('MFA_INVALID');
  });

  it('código de recuperación: sirve una sola vez', async () => {
    const t = await newTenant(api, 'mfa');
    const { recoveryCodes } = await enableMfa(t, t.adminEmail);
    expect(recoveryCodes).toHaveLength(10);
    const l = await api.req('POST', '/auth/login', { body: loginBody(t, t.adminEmail) });
    expect((await api.req('POST', '/auth/2fa/verify', { body: { mfaToken: l.body.mfaToken, code: recoveryCodes[0] } })).status).toBe(200);
    const l2 = await api.req('POST', '/auth/login', { body: loginBody(t, t.adminEmail) });
    expect((await api.req('POST', '/auth/2fa/verify', { body: { mfaToken: l2.body.mfaToken, code: recoveryCodes[0] } })).body.code).toBe('MFA_INVALID');
    expect((await api.req('POST', '/auth/2fa/verify', { body: { mfaToken: l2.body.mfaToken, code: recoveryCodes[1]!.toLowerCase() } })).status).toBe(200);
  });

  it('5 códigos fallidos bloquean la cuenta; la contraseña correcta no reinicia el contador', async () => {
    const t = await newTenant(api, 'mfa');
    await enableMfa(t, t.adminEmail);
    for (let i = 0; i < 5; i++) {
      const l = await api.req('POST', '/auth/login', { body: loginBody(t, t.adminEmail) });
      expect(l.body.mfaRequired).toBe(true);
      await api.req('POST', '/auth/2fa/verify', { body: { mfaToken: l.body.mfaToken, code: '111111' } });
    }
    const locked = await api.req('POST', '/auth/login', { body: loginBody(t, t.adminEmail) });
    expect(locked.status).toBe(423);
  });

  it('PIN rápido no puede saltarse el 2FA', async () => {
    const t = await newTenant(api, 'mfa');
    const admin = await login(api, t, t.adminEmail);
    const br = await createBranch(api, admin, 'M1');
    const u = await createUser(api, admin, t, 'GERENTE', [br.id]);
    const before = await api.req('POST', '/auth/pin-login', { body: { tenant: t.slug, userCode: u.userCode, pin: '1234' } });
    expect(before.status).toBe(200);
    // el gerente activa 2FA
    await enableMfa(t, u.email);
    const after = await api.req('POST', '/auth/pin-login', { body: { tenant: t.slug, userCode: u.userCode, pin: '1234' } });
    expect(after.status).toBe(403);
    expect(after.body.code).toBe('MFA_REQUIRED');
    expect(after.body.accessToken).toBeUndefined();
  });

  it('el secreto se guarda cifrado y nunca aparece en la auditoría', async () => {
    const t = await newTenant(api, 'mfa');
    const { secret } = await enableMfa(t, t.adminEmail);
    const row = (await asTenant(t.tenantId, 'SELECT mfa_secret_enc, mfa_recovery_hashes FROM users WHERE id = $1', [t.adminId]))[0];
    expect(row.mfa_secret_enc).not.toContain(secret);
    expect(row.mfa_recovery_hashes).toHaveLength(10);
    const audit = await asTenant(t.tenantId, 'SELECT action, new_value FROM audit_logs');
    expect(audit.some((a) => a.action === 'auth.mfa_enabled')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it('no se puede enrolar dos veces; desactivar exige contraseña + código', async () => {
    const t = await newTenant(api, 'mfa');
    const { secret, token } = await enableMfa(t, t.adminEmail);
    expect((await api.req('POST', '/auth/2fa/setup', { token })).status).toBe(409);
    const bad = await api.req('POST', '/auth/2fa/disable', { token, body: { password: 'incorrecta-123', code: nextCode(secret, 1) } });
    expect(bad.status).toBe(401);
    const off = await api.req('POST', '/auth/2fa/disable', { token, body: { password: PASSWORD, code: nextCode(secret, 1) } });
    expect(off.status).toBe(204);
    expect((await api.req('POST', '/auth/login', { body: loginBody(t, t.adminEmail) })).body.accessToken).toBeTruthy();
  });

  it('reinicio de 2FA por un administrador; un gerente no alcanza a admins ni a otras sucursales', async () => {
    const t = await newTenant(api, 'mfa');
    const admin = await login(api, t, t.adminEmail);
    const br = await createBranch(api, admin, 'M2');
    const br2 = await createBranch(api, admin, 'M2B');
    const mgr = await createUser(api, admin, t, 'GERENTE', [br.id]);
    const otherBranchMgr = await createUser(api, admin, t, 'GERENTE', [br2.id], 'otro');
    await enableMfa(t, mgr.email);
    await enableMfa(t, otherBranchMgr.email);
    expect((await api.req('POST', '/auth/login', { body: loginBody(t, mgr.email) })).body.mfaRequired).toBe(true);
    expect((await api.req('POST', `/users/${mgr.id}/mfa/reset`, { token: admin })).status).toBe(204);
    expect((await api.req('POST', '/auth/login', { body: loginBody(t, mgr.email) })).body.accessToken).toBeTruthy();

    const mt = await login(api, t, mgr.email);
    expect((await api.req('POST', `/users/${otherBranchMgr.id}/mfa/reset`, { token: mt })).status).toBe(403);
    expect((await api.req('POST', `/users/${t.adminId}/mfa/reset`, { token: mt })).status).toBe(403);
    expect((await api.req('POST', `/users/${mgr.id}/mfa/reset`, { token: mt })).status).toBe(403); // a sí mismo: usar "desactivar"
  });

  it('un gerente no puede cambiar la contraseña ni los datos de un ADMIN (jerarquía de privilegios)', async () => {
    const t = await newTenant(api, 'mfa');
    const admin = await login(api, t, t.adminEmail);
    const br = await createBranch(api, admin, 'M4');
    const mgr = await createUser(api, admin, t, 'GERENTE', [br.id]);
    const mt = await login(api, t, mgr.email);
    const hit = await api.req('PATCH', `/users/${t.adminId}`, { token: mt, body: { password: 'Hackeada-12345!' } });
    expect(hit.status).toBe(403);
    expect((await api.req('POST', '/auth/login', { body: { tenant: t.slug, email: t.adminEmail, password: 'Hackeada-12345!' } })).status).toBe(401);
    expect((await api.req('DELETE', `/users/${t.adminId}`, { token: mt })).status).toBe(403);
  });
});

describe('2FA TOTP — obligatorio para ADMIN (MFA_ENFORCE=true)', () => {
  it('el login del admin pide enrolar, y al terminar entrega sesión + códigos de recuperación', async () => {
    env.MFA_ENFORCE = 'true';
    try {
      const t = await newTenant(api, 'mfa');
      const l = await api.req('POST', '/auth/login', { body: loginBody(t, t.adminEmail) });
      expect(l.status).toBe(200);
      expect(l.body.mfaSetupRequired).toBe(true);
      expect(l.body.accessToken).toBeUndefined();

      // el token de enrolamiento no sirve para el reto (propósito distinto)
      expect((await api.req('POST', '/auth/2fa/verify', { body: { mfaToken: l.body.mfaToken, code: '123456' } })).status).toBe(401);

      const st = await api.req('POST', '/auth/2fa/enroll/start', { body: { mfaToken: l.body.mfaToken } });
      expect(st.status).toBe(200);
      expect(st.body.otpauthUri).toContain('otpauth://totp/');
      expect((await api.req('POST', '/auth/2fa/enroll/finish', { body: { mfaToken: l.body.mfaToken, code: '000000' } })).body.code).toBe('MFA_INVALID');
      const fin = await api.req('POST', '/auth/2fa/enroll/finish', { body: { mfaToken: l.body.mfaToken, code: totpAt(st.body.secret) } });
      expect(fin.status).toBe(200);
      expect(fin.body.recoveryCodes).toHaveLength(10);
      const me = await api.req('GET', '/auth/me', { token: fin.body.accessToken });
      expect(me.body.mfa).toEqual({ enabled: true, required: true });

      // con rol obligatorio no se puede apagar
      const off = await api.req('POST', '/auth/2fa/disable', { token: fin.body.accessToken, body: { password: PASSWORD, code: nextCode(st.body.secret, 1) } });
      expect(off.status).toBe(403);
      expect(off.body.code).toBe('MFA_REQUIRED');
    } finally { env.MFA_ENFORCE = 'false'; }
  });

  it('roles operativos (cajero) no se ven afectados', async () => {
    env.MFA_ENFORCE = 'true';
    try {
      const t = await newTenant(api, 'mfa');
      env.MFA_ENFORCE = 'false';
      const admin = await login(api, t, t.adminEmail);
      const br = await createBranch(api, admin, 'M3');
      const cashier = await createUser(api, admin, t, 'CAJERO', [br.id]);
      env.MFA_ENFORCE = 'true';
      expect((await api.req('POST', '/auth/login', { body: loginBody(t, cashier.email) })).body.accessToken).toBeTruthy();
    } finally { env.MFA_ENFORCE = 'false'; }
  });
});
