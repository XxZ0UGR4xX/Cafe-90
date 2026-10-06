import { Injectable } from '@nestjs/common';
import { DbService } from '../../database/db.service';
import { Principal } from './principal';

@Injectable()
export class PrincipalRepository {
  constructor(private readonly db: DbService) {}

  /** Carga identidad + permisos efectivos. Devuelve null si el usuario no existe/está deshabilitado. */
  async load(userId: string, tenantId: string): Promise<Principal | null> {
    return this.db.tx(async (q) => {
      const { rows } = await q.query(
        `SELECT u.full_name, u.status, r.key AS role_key, ur.branch_id, rp.permission_key
           FROM users u
           LEFT JOIN user_roles ur ON ur.user_id = u.id
           LEFT JOIN roles r ON r.id = ur.role_id
           LEFT JOIN role_permissions rp ON rp.role_id = r.id
          WHERE u.id = $1 AND u.deleted_at IS NULL`,
        [userId],
      );
      if (!rows.length || rows[0].status !== 'ACTIVE') return null;
      return Principal.build(userId, tenantId, rows[0].full_name, rows.filter((r) => r.role_key));
    }, tenantId);
  }

  /** Ids de todas las sucursales activas del tenant (para sockets corporativos). */
  async branchIds(tenantId: string): Promise<string[]> {
    return this.db.tx(async (q) => (await q.query('SELECT id FROM branches WHERE deleted_at IS NULL')).rows.map((r) => r.id), tenantId);
  }
}
