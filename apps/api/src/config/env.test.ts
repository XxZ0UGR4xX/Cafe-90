import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', JWT_ACCESS_SECRET: 'abcdefghij0123456789ABCDEFGHIJ01' };
const prod = { ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true', CORS_ORIGINS: 'https://admin.ejemplo.mx' };

describe('configuración del entorno', () => {
  it('variables vacías (Docker Compose) equivalen a no definidas', () => {
    const e = loadEnv({ ...base, SMTP_URL: '', FISCAL_PROVIDER: '', MFA_ENCRYPTION_KEY: '' });
    expect(e.SMTP_URL).toBeUndefined(); expect(e.FISCAL_PROVIDER).toBeUndefined(); expect(e.MFA_ENCRYPTION_KEY).toBeUndefined();
  });
  it('producción exige MFA_ENCRYPTION_KEY y prohíbe el proveedor fiscal simulado', () => {
    expect(() => loadEnv({ ...prod })).toThrow(/MFA_ENCRYPTION_KEY/);
    expect(() => loadEnv({ ...prod, MFA_ENCRYPTION_KEY: 'k'.repeat(32), FISCAL_PROVIDER: 'sandbox' })).toThrow(/sandbox/);
    expect(loadEnv({ ...prod, MFA_ENCRYPTION_KEY: 'k'.repeat(32) }).NODE_ENV).toBe('production');
  });
  it('producción exige cookie segura, CORS sin localhost y un secreto no trivial', () => {
    const ok = { ...prod, MFA_ENCRYPTION_KEY: 'k'.repeat(32) };
    expect(() => loadEnv({ ...ok, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadEnv({ ...ok, CORS_ORIGINS: 'http://localhost:5173' })).toThrow(/CORS_ORIGINS/);
    expect(() => loadEnv({ ...ok, JWT_ACCESS_SECRET: 'x'.repeat(32) })).toThrow(/trivial/);
  });
  it('secretos cortos o URL inválidas se rechazan al arrancar', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'corto' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...base, SMTP_URL: 'no-es-url' })).toThrow(/SMTP_URL/);
  });
});
