import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../../config/env';
import { DbService, Tx } from '../../database/db.service';
import { AppError, forbidden, unauthenticated } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { AuthService, type Session } from './auth.service';
import { UsersService } from './users.service';
import { verifySecret } from './passwords';
import {
  decryptSecret, encryptSecret, generateRecoveryCodes, generateSecret, hashRecovery, looksLikeRecovery, otpauthUri, verifyTotp,
} from './totp';
import { verifyMfa } from './tokens';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

type CodeResult = 'ok' | 'invalid' | 'locked';
interface MfaUser { id: string; email: string; status: string; locked_until: Date | null; failed_attempts: number;
  mfa_secret_enc: string | null; mfa_pending_secret_enc: string | null; mfa_enabled_at: Date | null; mfa_last_step: string | null; mfa_recovery_hashes: string[] }

/** 2FA TOTP: reto en login, enrolamiento (voluntario u obligatorio por rol), baja y reinicio por un administrador. */
@Injectable()
export class MfaService {
  constructor(
    private readonly db: DbService, private readonly audit: AuditService, private readonly auth: AuthService,
    private readonly users: UsersService, @Inject(ENV) private readonly env: Env,
  ) {}

  private get keyMaterial() { return this.env.MFA_ENCRYPTION_KEY ?? this.env.JWT_ACCESS_SECRET; }

  private async lockUser(q: Tx, userId: string): Promise<MfaUser | undefined> {
    return (await q.query<MfaUser>(
      `SELECT id, email, status, locked_until, failed_attempts, mfa_secret_enc, mfa_pending_secret_enc, mfa_enabled_at, mfa_last_step, mfa_recovery_hashes
         FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [userId])).rows[0];
  }

  /** Valida un código TOTP (anti-replay) o de recuperación (un solo uso) y cuenta los fallos hacia el bloqueo de cuenta. */
  private async checkCode(q: Tx, u: MfaUser, code: string): Promise<CodeResult> {
    if (u.locked_until && new Date(u.locked_until) > new Date()) return 'locked';
    let ok = false; let used: 'totp' | 'recovery' = 'totp';
    if (u.mfa_secret_enc && looksLikeRecovery(code)) {
      const h = hashRecovery(code);
      if (u.mfa_recovery_hashes.includes(h)) {
        await q.query('UPDATE users SET mfa_recovery_hashes = array_remove(mfa_recovery_hashes, $2) WHERE id = $1', [u.id, h]);
        ok = true; used = 'recovery';
      }
    } else if (u.mfa_secret_enc) {
      const step = verifyTotp(decryptSecret(u.mfa_secret_enc, this.keyMaterial), code, u.mfa_last_step == null ? null : Number(u.mfa_last_step));
      if (step != null) { await q.query('UPDATE users SET mfa_last_step = $2 WHERE id = $1', [u.id, step]); ok = true; }
    }
    if (ok) {
      await q.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [u.id]);
      if (used === 'recovery') await this.audit.record(q, { action: 'auth.mfa_recovery_used', entity: 'user', entityId: u.id, userId: u.id,
        newValue: { remaining: u.mfa_recovery_hashes.length - 1 } });
      return 'ok';
    }
    const attempts = u.failed_attempts + 1; const lock = attempts >= MAX_FAILED;
    await q.query(
      `UPDATE users SET failed_attempts = $2, locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END WHERE id = $1`,
      [u.id, lock ? 0 : attempts, lock, String(LOCK_MINUTES)]);
    await this.audit.record(q, { action: 'auth.mfa_failed', entity: 'user', entityId: u.id, userId: u.id, newValue: { attempts, locked: lock } });
    return lock ? 'locked' : 'invalid';
  }

  private claims(token: string, purpose: 'challenge' | 'enroll') {
    return verifyMfa(token, this.env.JWT_ACCESS_SECRET, purpose).catch(() => { throw unauthenticated(); });
  }

  // ── Login: segundo paso ───────────────────────────────────────────────────
  async verifyChallenge(mfaToken: string, code: string): Promise<Session> {
    const { sub, tid } = await this.claims(mfaToken, 'challenge');
    const out = await this.db.tx(async (q) => {
      const u = await this.lockUser(q, sub);
      if (!u || u.status !== 'ACTIVE' || !u.mfa_enabled_at) return { fail: 'MFA_INVALID' as const };
      const r = await this.checkCode(q, u, code.trim());
      if (r === 'locked') return { fail: 'ACCOUNT_LOCKED' as const };
      if (r === 'invalid') return { fail: 'MFA_INVALID' as const };
      await q.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
      const session = await this.auth.issueSession(q, u.id, tid, randomUUID());
      await this.audit.record(q, { action: 'auth.mfa_verified', entity: 'user', entityId: u.id, userId: u.id });
      return { session };
    }, tid);
    if ('fail' in out) throw new AppError(out.fail!, out.fail === 'ACCOUNT_LOCKED' ? 423 : 401);
    return out.session!;
  }

  // ── Enrolamiento ─────────────────────────────────────────────────────────
  private async startFor(q: Tx, userId: string) {
    const u = await this.lockUser(q, userId);
    if (!u || u.status !== 'ACTIVE') throw unauthenticated();
    if (u.mfa_enabled_at) throw new AppError('CONFLICT', 409, { reason: 'mfa_already_enabled' }, false);
    const secret = generateSecret();
    await q.query('UPDATE users SET mfa_pending_secret_enc = $2 WHERE id = $1', [userId, encryptSecret(secret, this.keyMaterial)]);
    return { secret, otpauthUri: otpauthUri(secret, u.email, this.env.MFA_ISSUER) };
  }

  private async finishFor(q: Tx, userId: string, code: string): Promise<string[]> {
    const u = await this.lockUser(q, userId);
    if (!u || u.status !== 'ACTIVE') throw unauthenticated();
    if (u.mfa_enabled_at) throw new AppError('CONFLICT', 409, { reason: 'mfa_already_enabled' }, false);
    if (!u.mfa_pending_secret_enc) throw new AppError('VALIDATION_ERROR', 400, { reason: 'sin enrolamiento en curso' });
    const step = verifyTotp(decryptSecret(u.mfa_pending_secret_enc, this.keyMaterial), code, null);
    if (step == null) throw new AppError('MFA_INVALID', 401);
    const codes = generateRecoveryCodes();
    await q.query(
      `UPDATE users SET mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = NULL, mfa_enabled_at = now(),
              mfa_last_step = $2, mfa_recovery_hashes = $3 WHERE id = $1`, [userId, step, codes.map(hashRecovery)]);
    return codes;
  }

  /** Enrolamiento obligatorio durante el login (token 'enroll' en lugar de sesión). */
  async enrollStartWithToken(mfaToken: string) {
    const { sub, tid } = await this.claims(mfaToken, 'enroll');
    return this.db.tx((q) => this.startFor(q, sub), tid);
  }

  async enrollFinishWithToken(mfaToken: string, code: string): Promise<{ session: Session; recoveryCodes: string[] }> {
    const { sub, tid } = await this.claims(mfaToken, 'enroll');
    return this.db.tx(async (q) => {
      const recoveryCodes = await this.finishFor(q, sub, code);
      await q.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [sub]);
      const session = await this.auth.issueSession(q, sub, tid, randomUUID());
      await this.audit.record(q, { action: 'auth.mfa_enabled', entity: 'user', entityId: sub, userId: sub, newValue: { via: 'login_enroll' } });
      return { session, recoveryCodes };
    }, tid);
  }

  /** Enrolamiento voluntario desde una sesión ya iniciada. */
  setup() { return this.db.tx((q) => this.startFor(q, ctx().principal!.userId)); }

  async enable(code: string): Promise<{ recoveryCodes: string[] }> {
    const id = ctx().principal!.userId;
    return this.db.tx(async (q) => {
      const recoveryCodes = await this.finishFor(q, id, code);
      await this.audit.record(q, { action: 'auth.mfa_enabled', entity: 'user', entityId: id, newValue: { via: 'settings' } });
      return { recoveryCodes };
    });
  }

  /** Apagar 2FA exige contraseña + código vigente, y no se permite si el rol lo obliga y MFA_ENFORCE está activo. */
  async disable(password: string, code: string): Promise<void> {
    const id = ctx().principal!.userId;
    const out = await this.db.tx(async (q) => {
      const u = await this.lockUser(q, id);
      if (!u || !u.mfa_enabled_at) return 'OK' as const;
      if (this.env.MFA_ENFORCE === 'true' && (await this.auth.hasMfaRequiredRole(q, id))) return 'REQUIRED' as const;
      const pw = (await q.query('SELECT password_hash FROM users WHERE id = $1', [id])).rows[0]?.password_hash as string | undefined;
      if (!pw || !(await verifySecret(pw, password))) return 'INVALID_CREDENTIALS' as const;
      const r = await this.checkCode(q, u, code.trim());
      if (r !== 'ok') return r === 'locked' ? ('ACCOUNT_LOCKED' as const) : ('MFA_INVALID' as const);
      await q.query(`UPDATE users SET mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_enabled_at = NULL,
                            mfa_last_step = NULL, mfa_recovery_hashes = '{}' WHERE id = $1`, [id]);
      await this.audit.record(q, { action: 'auth.mfa_disabled', entity: 'user', entityId: id });
      return 'OK' as const;
    });
    if (out === 'REQUIRED') throw new AppError('MFA_REQUIRED', 403, { reason: 'rol con 2FA obligatorio' });
    if (out !== 'OK') throw new AppError(out, out === 'ACCOUNT_LOCKED' ? 423 : 401);
  }

  /** Un administrador reinicia el 2FA de otra persona (dispositivo perdido y sin códigos de recuperación). */
  async adminReset(targetId: string): Promise<void> {
    const actor = ctx().principal!;
    if (targetId === actor.userId) throw forbidden({ reason: 'usa Seguridad → desactivar 2FA' });
    await this.db.tx(async (q) => {
      await this.users.assertCanManage(q, targetId);
      await q.query(`UPDATE users SET mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_enabled_at = NULL,
                            mfa_last_step = NULL, mfa_recovery_hashes = '{}' WHERE id = $1`, [targetId]);
      await q.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [targetId]);
      await this.audit.record(q, { action: 'auth.mfa_reset', entity: 'user', entityId: targetId });
    });
  }
}
