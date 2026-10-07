import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DbService } from '../../database/db.service';
import { ctx } from '../../common/request-context';
import { Require } from '../identity/access.decorators';

const Query_ = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  userId: z.string().uuid().optional(),
  entity: z.string().max(60).optional(),
  entityId: z.string().max(80).optional(),
  action: z.string().max(80).optional(),
  branchId: z.string().uuid().optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
class AuditQueryDto extends createZodDto(Query_) {}

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly db: DbService) {}

  @Get()
  @Require('audit.log.read')
  async list(@Query() q: AuditQueryDto) {
    const scope = ctx().principal!.branchScope('audit.log.read');
    const rows = await this.db.tx(async (tx) => {
      const where: string[] = []; const p: unknown[] = [];
      const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
      if (q.from) add('at >= ?', q.from);
      if (q.to) add('at <= ?', q.to);
      if (q.cursor) add('at < ?', q.cursor);
      if (q.userId) add('user_id = ?', q.userId);
      if (q.entity) add('entity = ?', q.entity);
      if (q.entityId) add('entity_id = ?', q.entityId);
      if (q.action) add('action = ?', q.action);
      if (q.branchId) add('branch_id = ?', q.branchId);
      if (scope) add('branch_id = ANY(?::uuid[])', scope);   // los eventos globales (sin sucursal: usuarios, roles, configuración) solo los ve el alcance corporativo
      p.push(q.limit + 1);
      return (await tx.query(
        `SELECT id, branch_id, user_id, user_name, host(ip) AS ip, action, entity, entity_id, old_value, new_value,
                reason, request_id, at FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY at DESC, id DESC LIMIT $${p.length}`, p)).rows;
    });
    const items = rows.slice(0, q.limit);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1].at.toISOString() : null };
  }
}
