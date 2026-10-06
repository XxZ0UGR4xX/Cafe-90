import { Injectable } from '@nestjs/common';
import { DbService, Tx } from '../../database/db.service';
import { AppError, conflict, forbidden, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { hashSecret } from './passwords';
import { UsersRepository } from './users.repository';

type Assignment = { role: string; branchIds: string[] | null };

@Injectable()
export class UsersService {
  constructor(private readonly db: DbService, private readonly repo: UsersRepository, private readonly audit: AuditService) {}

  list(page: { limit: number; offset: number }) {
    const scope = ctx().principal!.branchScope('identity.user.read');
    return this.db.tx((q) => this.repo.list(q, scope, page.limit, page.offset));
  }

  async get(id: string) {
    const u = await this.db.tx((q) => this.repo.get(q, id));
    if (!u) throw notFound('user');
    return u;
  }

  /** Evita escalada de privilegios: sólo se asignan roles cuyos permisos el actor ya posee y con alcance permitido. */
  private async resolveAssignments(q: Tx, items: Assignment[]) {
    const actor = ctx().principal!;
    const out: { roleId: string; branchId: string | null }[] = [];
    for (const it of items) {
      const role = await this.repo.roleByKey(q, it.role);
      if (!role) throw new AppError('VALIDATION_ERROR', 400, { role: it.role });
      if (role.key === 'SUPER_ADMIN' && !actor.grants.some((g) => g.roleKey === 'SUPER_ADMIN'))
        throw forbidden({ reason: 'solo SUPER_ADMIN asigna SUPER_ADMIN' });
      const perms = await this.repo.rolePermissions(q, role.id);
      const missing = perms.filter((p) => !actor.can(p));
      if (missing.length) throw forbidden({ reason: 'escalada de privilegios', missing: missing.slice(0, 5) });
      if (it.branchIds === null) {
        if (!actor.isCorporate) throw forbidden({ reason: 'alcance corporativo requiere rol corporativo' });
        out.push({ roleId: role.id, branchId: null });
      } else {
        for (const b of it.branchIds) {
          if (!actor.can('identity.user.write', b)) throw forbidden({ reason: 'sucursal fuera de alcance', branchId: b });
          out.push({ roleId: role.id, branchId: b });
        }
      }
    }
    return out;
  }

  /**
   * Sólo se administra a quien se está por debajo: el actor debe poseer TODOS los permisos de cada rol del objetivo,
   * en cada sucursal donde lo tiene (un rol corporativo del objetivo exige alcance corporativo). Evita que un gerente
   * edite, desbloquee o cambie la contraseña de un ADMIN o de personal de otra sucursal.
   */
  async assertCanManage(q: Tx, id: string) {
    const target = await this.repo.get(q, id);
    if (!target) throw notFound('user');
    const actor = ctx().principal!;
    if (target.roles.some((r) => r.role === 'SUPER_ADMIN') && !actor.grants.some((g) => g.roleKey === 'SUPER_ADMIN'))
      throw forbidden({ reason: 'no puedes modificar a un SUPER_ADMIN' });
    if (id === actor.userId) return target;
    for (const r of target.roles) {
      if (r.branchId === null && !actor.isCorporate) throw forbidden({ reason: 'el usuario tiene alcance corporativo' });
      const role = await this.repo.roleByKey(q, r.role);
      if (!role) continue;
      const missing = (await this.repo.rolePermissions(q, role.id)).filter((p) => !actor.can(p, r.branchId ?? undefined));
      if (missing.length) throw forbidden({ reason: 'el usuario tiene más privilegios que tú o está fuera de tu alcance', missing: missing.slice(0, 3) });
    }
    return target;
  }

  async create(dto: { email: string; fullName: string; password: string; pin?: string; userCode?: string; roles: Assignment[] }) {
    return this.db.tx(async (q) => {
      const assignments = await this.resolveAssignments(q, dto.roles);
      const id = await this.repo.insert(q, {
        email: dto.email, fullName: dto.fullName, userCode: dto.userCode,
        passwordHash: await hashSecret(dto.password), pinHash: dto.pin ? await hashSecret(dto.pin) : undefined,
      }).catch((e) => { if (e.code === '23505') throw conflict({ field: 'email|userCode' }, '⚠️ Ya existe un usuario con ese correo o código.'); throw e; });
      await this.repo.setRoles(q, id, assignments);
      const created = await this.repo.get(q, id);
      await this.audit.record(q, { action: 'user.create', entity: 'user', entityId: id, newValue: created });
      return created!;
    });
  }

  async update(id: string, dto: { fullName?: string; status?: 'ACTIVE' | 'DISABLED'; pin?: string; password?: string; roles?: Assignment[] }) {
    return this.db.tx(async (q) => {
      const before = await this.assertCanManage(q, id);
      if (dto.status === 'DISABLED' && id === ctx().principal!.userId) throw new AppError('FORBIDDEN', 403, { reason: 'no puedes deshabilitarte' });
      await this.repo.update(q, id, {
        fullName: dto.fullName, status: dto.status,
        passwordHash: dto.password ? await hashSecret(dto.password) : undefined,
        pinHash: dto.pin ? await hashSecret(dto.pin) : undefined,
      });
      if (dto.roles) await this.repo.setRoles(q, id, await this.resolveAssignments(q, dto.roles));
      if (dto.status === 'DISABLED' || dto.password)
        await q.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      const after = await this.repo.get(q, id);
      await this.audit.record(q, { action: 'user.update', entity: 'user', entityId: id, oldValue: before,
        newValue: { ...after, passwordChanged: !!dto.password, pinChanged: !!dto.pin } });
      return after!;
    });
  }

  async remove(id: string) {
    await this.db.tx(async (q) => {
      if (id === ctx().principal!.userId) throw new AppError('FORBIDDEN', 403, { reason: 'no puedes eliminarte' });
      const before = await this.assertCanManage(q, id);
      await this.repo.softDelete(q, id);
      await this.audit.record(q, { action: 'user.delete', entity: 'user', entityId: id, oldValue: before });
    });
  }
}
