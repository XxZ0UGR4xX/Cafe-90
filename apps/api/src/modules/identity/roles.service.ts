import { Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@retroburger/shared';
import { DbService } from '../../database/db.service';
import { AppError, conflict, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RolesService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  list() {
    return this.db.tx(async (q) => (await q.query(
      `SELECT r.id, r.key, r.name, r.is_system AS "isSystem", r.version,
              COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.is_system DESC, r.name`)).rows);
  }

  permissions() { return PERMISSIONS.map((key) => ({ key, module: key.split('.')[0] })); }

  private checkPerms(perms: string[]) {
    const actor = ctx().principal!;
    const unknown = perms.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
    if (unknown.length) throw new AppError('VALIDATION_ERROR', 400, { unknown });
    const missing = perms.filter((p) => !actor.can(p));
    if (missing.length) throw forbidden({ reason: 'escalada de privilegios', missing: missing.slice(0, 5) });
  }

  async create(dto: { key: string; name: string; permissions: string[] }) {
    this.checkPerms(dto.permissions);
    return this.db.tx(async (q) => {
      const r = await q.query<{ id: string }>(
        `INSERT INTO roles (tenant_id, key, name) VALUES (app_tenant_id(), $1, $2) RETURNING id`, [dto.key, dto.name])
        .catch((e) => { if (e.code === '23505') throw conflict({ field: 'key' }); throw e; });
      await this.setPerms(q, r.rows[0]!.id, dto.permissions);
      await this.audit.record(q, { action: 'role.create', entity: 'role', entityId: r.rows[0]!.id, newValue: dto });
      return { id: r.rows[0]!.id, ...dto };
    });
  }

  async update(id: string, dto: { name: string; permissions: string[] }) {
    this.checkPerms(dto.permissions);
    return this.db.tx(async (q) => {
      const role = (await q.query('SELECT key, is_system FROM roles WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!role) throw notFound('role');
      if (role.is_system) throw forbidden({ reason: 'los roles del sistema no se modifican' });
      const before = (await q.query('SELECT permission_key FROM role_permissions WHERE role_id = $1', [id])).rows.map((r) => r.permission_key);
      await q.query('UPDATE roles SET name = $2, version = version + 1 WHERE id = $1', [id, dto.name]);
      await this.setPerms(q, id, dto.permissions);
      await this.audit.record(q, { action: 'role.update', entity: 'role', entityId: id, oldValue: { permissions: before }, newValue: dto });
      return { id, key: role.key, ...dto };
    });
  }

  async remove(id: string) {
    await this.db.tx(async (q) => {
      const role = (await q.query('SELECT key, is_system FROM roles WHERE id = $1', [id])).rows[0];
      if (!role) throw notFound('role');
      if (role.is_system) throw forbidden({ reason: 'los roles del sistema no se eliminan' });
      const used = (await q.query('SELECT count(*)::int AS n FROM user_roles WHERE role_id = $1', [id])).rows[0].n;
      if (used) throw conflict({ users: used }, '⚠️ El rol está asignado a usuarios.');
      await q.query('DELETE FROM roles WHERE id = $1', [id]);
      await this.audit.record(q, { action: 'role.delete', entity: 'role', entityId: id, oldValue: role });
    });
  }

  private async setPerms(q: import('../../database/db.service').Tx, roleId: string, perms: string[]) {
    await q.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    if (perms.length)
      await q.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_key)
         SELECT app_tenant_id(), $1, unnest($2::text[])`, [roleId, perms]);
  }
}
