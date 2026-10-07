import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', JWT_ACCESS_SECRET: 'x'.repeat(32) };

describe('configuración del entorno', () => {
  it('variables vacías (Docker Compose) equivalen a no definidas', () => {
    const e = loadEnv({ ...base, SMTP_URL: '', FISCAL_PROVIDER: '', MFA_ENCRYPTION_KEY: '' });
    expect(e.SMTP_URL).toBeUndefined(); expect(e.FISCAL_PROVIDER).toBeUndefined(); expect(e.MFA_ENCRYPTION_KEY).toBeUndefined();
  });
  it('producción exige MFA_ENCRYPTION_KEY y prohíbe el proveedor fiscal simulado', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/MFA_ENCRYPTION_KEY/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', MFA_ENCRYPTION_KEY: 'k'.repeat(32), FISCAL_PROVIDER: 'sandbox' })).toThrow(/sandbox/);
    expect(loadEnv({ ...base, NODE_ENV: 'production', MFA_ENCRYPTION_KEY: 'k'.repeat(32) }).NODE_ENV).toBe('production');
  });
  it('secretos cortos o URL inválidas se rechazan al arrancar', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'corto' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...base, SMTP_URL: 'no-es-url' })).toThrow(/SMTP_URL/);
  });
});
