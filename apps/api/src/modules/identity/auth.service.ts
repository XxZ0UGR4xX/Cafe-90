import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../../config/env';
import { DbService, Tx } from '../../database/db.service';
import { AppError, unauthenticated } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { PrincipalRepository } from './principal.repository';
import { hashSecret, verifySecret } from './passwords';
import { hashToken, newOpaqueToken, signAccess } from './tokens';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const REUSE_GRACE_MS = 10_000;
// Hash de relleno para igualar tiempos cuando el usuario no existe (anti-enumeración).
let DUMMY: string | undefined;

export interface Session { accessToken: string; expiresIn: number; refreshToken: string; refreshExpiresAt: Date }

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly principals: PrincipalRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async resolveTenant(slug: string): Promise<string | null> {
    const { rows } = await this.db.system<{ t: string | null }>('SELECT resolve_tenant($1) AS t', [slug]);
    return rows[0]?.t ?? null;
  }

  async login(dto: { tenant: string; email: string; password: string }): Promise<Session> {
    return this.authenticate(dto.tenant, 'email', dto.email.toLowerCase(), dto.password, 'auth.login');
  }

  async pinLogin(dto: { tenant: string; userCode: string; pin: string }): Promise<Session> {
    return this.authenticate(dto.tenant, 'pin', dto.userCode, dto.pin, 'auth.pin_login');
  }

  private async authenticate(slug: string, mode: 'email' | 'pin', ident: string, secret: string, action: string) {
    DUMMY ??= await hashSecret('dummy-password-for-timing');
    const tenantId = await this.resolveTenant(slug);
    if (!tenantId) { await verifySecret(DUMMY, secret); throw new AppError('INVALID_CREDENTIALS', 401); }

    const outcome = await this.db.tx(async (q) => {
      const col = mode === 'email' ? 'lower(email)' : 'user_code';
      const { rows } = await q.query(
        `SELECT id, password_hash, pin_hash, status, failed_attempts, locked_until FROM users
          WHERE ${col} = $1 AND deleted_at IS NULL FOR UPDATE`, [ident]);
      const u = rows[0];
      const hash = u ? (mode === 'email' ? u.password_hash : u.pin_hash) : null;
      const ok = await verifySecret(hash ?? DUMMY!, secret);
      if (!u || !hash || u.status !== 'ACTIVE') {
        await this.audit.record(q, { action: `${action}_failed`, entity: 'user', entityId: u?.id ?? null, userId: u?.id ?? null,
          newValue: { ident: mode === 'email' ? ident : `code:${ident}`, reason: 'unknown_or_disabled' } });
        return { fail: 'INVALID_CREDENTIALS' as const };
      }
      if (u.locked_until && new Date(u.locked_until) > new Date()) return { fail: 'ACCOUNT_LOCKED' as const };
      if (!ok) {
        const attempts = u.failed_attempts + 1;
        const lock = attempts >= MAX_FAILED;
        await q.query(
          `UPDATE users SET failed_attempts = $2, locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END WHERE id = $1`,
          [u.id, lock ? 0 : attempts, lock, String(LOCK_MINUTES)]);
        await this.audit.record(q, { action: `${action}_failed`, entity: 'user', entityId: u.id, userId: u.id,
          newValue: { attempts, locked: lock } });
        return { fail: (lock ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS') as 'ACCOUNT_LOCKED' | 'INVALID_CREDENTIALS' };
      }
      await q.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
      const session = await this.issue(q, u.id, tenantId, randomUUID());
      await this.audit.record(q, { action, entity: 'user', entityId: u.id, userId: u.id });
      return { session };
    }, tenantId);

    if ('fail' in outcome) throw new AppError(outcome.fail!, outcome.fail === 'ACCOUNT_LOCKED' ? 423 : 401);
    return outcome.session!;
  }

  private async issue(q: Tx, userId: string, tenantId: string, familyId: string): Promise<Session> {
    const refresh = newOpaqueToken();
    const expires = new Date(Date.now() + this.env.REFRESH_TTL_DAYS * 86_400_000);
    const c = ctx();
    await q.query(
      `INSERT INTO refresh_tokens (tenant_id, user_id, family_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, userId, familyId, hashToken(refresh), expires, c.ip ?? null, c.userAgent?.slice(0, 300) ?? null]);
    const accessToken = await signAccess({ sub: userId, tid: tenantId, sid: familyId },
      this.env.JWT_ACCESS_SECRET, this.env.JWT_ACCESS_TTL_SECONDS);
    return { accessToken, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS, refreshToken: refresh, refreshExpiresAt: expires };
  }

  /** Rotación de refresh token con detección de reuso (revoca toda la familia). */
  async refresh(token: string): Promise<Session> {
    const hash = hashToken(token);
    const { rows } = await this.db.system<{ t: string | null }>('SELECT resolve_refresh_tenant($1) AS t', [hash]);
    const tenantId = rows[0]?.t;
    if (!tenantId) throw unauthenticated();

    const out = await this.db.tx(async (q) => {
      const r = (await q.query(
        `SELECT rt.id, rt.user_id, rt.family_id, rt.expires_at, rt.used_at, rt.revoked_at, u.status
           FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
          WHERE rt.token_hash = $1 FOR UPDATE OF rt`, [hash])).rows[0];
      if (!r || r.revoked_at || new Date(r.expires_at) < new Date() || r.status !== 'ACTIVE') return { fail: true };
      if (r.used_at) {
        const recent = Date.now() - new Date(r.used_at).getTime() < REUSE_GRACE_MS;
        if (!recent) {
          await q.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [r.family_id]);
          await this.audit.record(q, { action: 'auth.refresh_reuse_detected', entity: 'user', entityId: r.user_id, userId: r.user_id });
        }
        return { fail: true };
      }
      await q.query('UPDATE refresh_tokens SET used_at = now() WHERE id = $1', [r.id]);
      return { session: await this.issue(q, r.user_id, tenantId, r.family_id) };
    }, tenantId);
    if (!out.session) throw unauthenticated();
    return out.session;
  }

  async logout(token: string | undefined): Promise<void> {
    const p = ctx().principal;
    if (!p) return;
    await this.db.tx(async (q) => {
      if (token) {
        await q.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id =
             (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL`, [hashToken(token)]);
      }
      await this.audit.record(q, { action: 'auth.logout', entity: 'user', entityId: p.userId });
    });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const p = ctx().principal!;
    await this.db.tx(async (q) => {
      const u = (await q.query('SELECT password_hash FROM users WHERE id = $1 FOR UPDATE', [p.userId])).rows[0];
      if (!u || !(await verifySecret(u.password_hash, currentPassword))) throw new AppError('INVALID_CREDENTIALS', 401);
      await q.query('UPDATE users SET password_hash = $2 WHERE id = $1', [p.userId, await hashSecret(newPassword)]);
      await q.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [p.userId]);
      await this.audit.record(q, { action: 'auth.password_changed', entity: 'user', entityId: p.userId });
    });
  }

  async me() {
    const p = ctx().principal!;
    const row = await this.db.tx(async (q) => (await q.query(
      `SELECT u.id, u.email, u.full_name, r.name AS tenant_name, r.currency, r.locale, r.timezone, r.slug
         FROM users u JOIN restaurants r ON r.id = u.tenant_id WHERE u.id = $1`, [p.userId])).rows[0]);
    const scope = p.branchScope('tenancy.branch.read');
    return {
      id: row.id, email: row.email, fullName: row.full_name,
      tenant: { id: p.tenantId, slug: row.slug, name: row.tenant_name, currency: row.currency.trim(), locale: row.locale, timezone: row.timezone },
      roles: p.grants, permissions: p.permissionList(), branchScope: scope, isCorporate: p.isCorporate,
    };
  }
}
