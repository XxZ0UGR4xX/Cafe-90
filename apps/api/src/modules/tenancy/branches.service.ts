import { Injectable } from '@nestjs/common';
import { DbService } from '../../database/db.service';
import { conflict, notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';

const COLS = `id, name, code, address, phone, status, timezone, opening_hours AS "openingHours",
              business_day_cutoff AS "businessDayCutoff", created_at AS "createdAt"`;

@Injectable()
export class BranchesService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  list() {
    const scope = ctx().principal!.branchScope('tenancy.branch.read');
    return this.db.tx(async (q) => (await q.query(
      `SELECT ${COLS} FROM branches WHERE deleted_at IS NULL AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[])) ORDER BY name`,
      [scope])).rows);
  }

  async get(id: string) {
    const b = await this.db.tx(async (q) => (await q.query(`SELECT ${COLS} FROM branches WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0]);
    if (!b) throw notFound('branch');
    return b;
  }

  create(dto: { name: string; code: string; address?: string; phone?: string; status: string; timezone: string }) {
    return this.db.tx(async (q) => {
      const row = (await q.query(
        `INSERT INTO branches (tenant_id, name, code, address, phone, status, timezone)
         VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6) RETURNING ${COLS}`,
        [dto.name, dto.code, dto.address ?? null, dto.phone ?? null, dto.status, dto.timezone])
      ).rows[0];
      await this.audit.record(q, { action: 'branch.create', entity: 'branch', entityId: row.id, branchId: row.id, newValue: row });
      return row;
    }).catch((e) => { if (e.code === '23505') throw conflict({ field: 'code' }, '⚠️ Ya existe una sucursal con ese código.'); throw e; });
  }

  update(id: string, dto: Partial<{ name: string; code: string; address: string; phone: string; status: string; timezone: string }>) {
    return this.db.tx(async (q) => {
      const before = (await q.query(`SELECT ${COLS} FROM branches WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
      if (!before) throw notFound('branch');
      const row = (await q.query(
        `UPDATE branches SET name = COALESCE($2,name), code = COALESCE($3,code), address = COALESCE($4,address),
                phone = COALESCE($5,phone), status = COALESCE($6,status), timezone = COALESCE($7,timezone)
          WHERE id = $1 RETURNING ${COLS}`,
        [id, dto.name ?? null, dto.code ?? null, dto.address ?? null, dto.phone ?? null, dto.status ?? null, dto.timezone ?? null])
      ).rows[0];
      await this.audit.record(q, { action: 'branch.update', entity: 'branch', entityId: id, branchId: id, oldValue: before, newValue: row });
      return row;
    }).catch((e) => { if (e.code === '23505') throw conflict({ field: 'code' }, '⚠️ Ya existe una sucursal con ese código.'); throw e; });
  }

  remove(id: string) {
    return this.db.tx(async (q) => {
      const r = await q.query(`UPDATE branches SET deleted_at = now(), status = 'CLOSED' WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id]);
      if (!r.rowCount) throw notFound('branch');
      await this.audit.record(q, { action: 'branch.delete', entity: 'branch', entityId: id, branchId: id });
    });
  }
}
