import { Injectable } from '@nestjs/common';
import { Tx } from '../../database/db.service';

export interface UserRow {
  id: string; email: string; user_code: string | null; full_name: string; status: string;
  last_login_at: Date | null; created_at: Date; mfa_enabled: boolean; roles: { role: string; branchId: string | null }[];
}

@Injectable()
export class UsersRepository {
  async list(q: Tx, branchScope: string[] | null, limit: number, offset: number): Promise<UserRow[]> {
    return (await q.query<UserRow>(
      `SELECT u.id, u.email, u.user_code, u.full_name, u.status, u.last_login_at, u.created_at, (u.mfa_enabled_at IS NOT NULL) AS mfa_enabled,
              COALESCE(json_agg(json_build_object('role', r.key, 'branchId', ur.branch_id)) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.deleted_at IS NULL
          AND ($1::uuid[] IS NULL OR EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.id AND x.branch_id = ANY($1::uuid[])))
        GROUP BY u.id ORDER BY u.full_name LIMIT $2 OFFSET $3`, [branchScope, limit, offset])).rows;
  }

  async get(q: Tx, id: string): Promise<UserRow | undefined> {
    return (await q.query<UserRow>(
      `SELECT u.id, u.email, u.user_code, u.full_name, u.status, u.last_login_at, u.created_at, (u.mfa_enabled_at IS NOT NULL) AS mfa_enabled,
              COALESCE(json_agg(json_build_object('role', r.key, 'branchId', ur.branch_id)) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
         FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.id = $1 AND u.deleted_at IS NULL GROUP BY u.id`, [id])).rows[0];
  }

  async insert(q: Tx, v: { email: string; fullName: string; userCode?: string; passwordHash: string; pinHash?: string }) {
    return (await q.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, full_name, user_code, password_hash, pin_hash)
       VALUES (app_tenant_id(), $1,$2,$3,$4,$5) RETURNING id`,
      [v.email.toLowerCase(), v.fullName, v.userCode ?? null, v.passwordHash, v.pinHash ?? null])).rows[0]!.id;
  }

  async update(q: Tx, id: string, v: { fullName?: string; status?: string; passwordHash?: string; pinHash?: string }) {
    await q.query(
      `UPDATE users SET full_name = COALESCE($2, full_name), status = COALESCE($3, status),
              password_hash = COALESCE($4, password_hash), pin_hash = COALESCE($5, pin_hash),
              failed_attempts = CASE WHEN $3 = 'ACTIVE' THEN 0 ELSE failed_attempts END,
              locked_until = CASE WHEN $3 = 'ACTIVE' THEN NULL ELSE locked_until END
        WHERE id = $1`, [id, v.fullName ?? null, v.status ?? null, v.passwordHash ?? null, v.pinHash ?? null]);
  }

  async softDelete(q: Tx, id: string) {
    await q.query(`UPDATE users SET deleted_at = now(), status = 'DISABLED' WHERE id = $1`, [id]);
    await q.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
  }

  async setRoles(q: Tx, userId: string, assignments: { roleId: string; branchId: string | null }[]) {
    await q.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    for (const a of assignments)
      await q.query('INSERT INTO user_roles (tenant_id, user_id, role_id, branch_id) VALUES (app_tenant_id(), $1,$2,$3)',
        [userId, a.roleId, a.branchId]);
  }

  async roleByKey(q: Tx, key: string) {
    return (await q.query<{ id: string; key: string }>('SELECT id, key FROM roles WHERE key = $1', [key])).rows[0];
  }

  async rolePermissions(q: Tx, roleId: string): Promise<string[]> {
    return (await q.query('SELECT permission_key FROM role_permissions WHERE role_id = $1', [roleId])).rows.map((r) => r.permission_key);
  }
}
