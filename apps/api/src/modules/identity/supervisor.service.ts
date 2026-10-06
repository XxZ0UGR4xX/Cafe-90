import { Injectable } from '@nestjs/common';
import { DbService } from '../../database/db.service';
import { AppError } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { PrincipalRepository } from './principal.repository';
import { verifySecret } from './passwords';

export interface SupervisorInput { userCode: string; pin: string }

/**
 * Autorización de supervisor por PIN para acciones sensibles (descuentos altos, cancelaciones, retiros...).
 * Si el actor ya tiene el permiso no se pide PIN. Los intentos fallidos bloquean la cuenta del supervisor.
 */
@Injectable()
export class SupervisorService {
  constructor(private readonly db: DbService, private readonly principals: PrincipalRepository) {}

  /** Devuelve el id del usuario que autoriza (el propio actor o el supervisor). */
  async authorize(permission: string, branchId: string, sup?: SupervisorInput): Promise<string> {
    const actor = ctx().principal!;
    if (actor.can(permission, branchId)) return actor.userId;
    if (!sup) throw new AppError('SUPERVISOR_REQUIRED', 403, { permission });

    const u = await this.db.tx(async (q) => (await q.query(
      `SELECT id, pin_hash, status, locked_until FROM users WHERE user_code = $1 AND deleted_at IS NULL`, [sup.userCode])).rows[0]);
    const locked = u?.locked_until && new Date(u.locked_until) > new Date();
    const ok = !!u && !locked && u.status === 'ACTIVE' && !!u.pin_hash && (await verifySecret(u.pin_hash, sup.pin));
    if (!ok) {
      if (u) await this.db.independent(async (q) => {
        await q.query(`UPDATE users SET failed_attempts = failed_attempts + 1,
          locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = $1`, [u.id]);
      });
      throw new AppError('SUPERVISOR_REQUIRED', 403, { reason: 'pin_invalid' });
    }
    const sp = await this.principals.load(u.id, actor.tenantId);
    if (!sp || !sp.can(permission, branchId)) throw new AppError('SUPERVISOR_REQUIRED', 403, { reason: 'insufficient_permission' });
    await this.db.independent(async (q) => { await q.query('UPDATE users SET failed_attempts = 0 WHERE id = $1', [u.id]); });
    return u.id;
  }
}
