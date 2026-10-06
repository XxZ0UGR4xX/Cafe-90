import { Injectable } from '@nestjs/common';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLE_KEYS, ROLE_LABELS } from '@retroburger/shared';
import { DbService, Tx } from '../../database/db.service';
import { hashSecret } from '../identity/passwords';

/** Alta de un tenant (restaurante/cadena) con roles del sistema y su primer SUPER_ADMIN. */
@Injectable()
export class ProvisionerService {
  constructor(private readonly db: DbService) {}

  /** Sincroniza el catálogo global de permisos (idempotente). */
  async syncPermissionCatalog(): Promise<void> {
    await this.db.system(
      `INSERT INTO permissions (key, module) SELECT k, split_part(k, '.', 1) FROM unnest($1::text[]) k
       ON CONFLICT (key) DO NOTHING`, [PERMISSIONS as unknown as string[]]);
  }

  async createTenant(input: {
    slug: string; name: string; currency?: string; timezone?: string;
    admin: { email: string; fullName: string; password: string };
  }): Promise<{ tenantId: string; adminId: string }> {
    await this.syncPermissionCatalog();
    // La creación del tenant ocurre fuera de RLS: se genera el id y luego se opera dentro de su contexto.
    const id = (await this.db.system<{ id: string }>('SELECT uuid_v7() AS id')).rows[0]!.id;
    const adminId = await this.db.tx(async (q) => {
      await q.query(`INSERT INTO restaurants (id, slug, name, currency, timezone) VALUES ($1,$2,$3,$4,$5)`,
        [id, input.slug, input.name, input.currency ?? 'MXN', input.timezone ?? 'America/Mexico_City']);
      await this.seedRoles(q);
      const adminRole = (await q.query("SELECT id FROM roles WHERE key = 'SUPER_ADMIN'")).rows[0].id;
      const u = await q.query(
        `INSERT INTO users (tenant_id, email, full_name, password_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
        [id, input.admin.email.toLowerCase(), input.admin.fullName, await hashSecret(input.admin.password)]);
      await q.query('INSERT INTO user_roles (tenant_id, user_id, role_id, branch_id) VALUES ($1,$2,$3,NULL)', [id, u.rows[0].id, adminRole]);
      return u.rows[0].id as string;
    }, id);
    return { tenantId: id, adminId };
  }

  private async seedRoles(q: Tx) {
    for (const key of ROLE_KEYS) {
      const r = await q.query(
        `INSERT INTO roles (tenant_id, key, name, is_system) VALUES (app_tenant_id(), $1, $2, true) RETURNING id`,
        [key, ROLE_LABELS[key]]);
      await q.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_key)
         SELECT app_tenant_id(), $1, unnest($2::text[])`, [r.rows[0].id, DEFAULT_ROLE_PERMISSIONS[key]]);
    }
  }
}
