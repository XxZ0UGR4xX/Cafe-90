import { Body, Controller, Delete, Get, Global, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { EmployeeDto } from '@retroburger/shared';
import { DbService } from '../../database/db.service';
import { notFound } from '../../common/errors';
import { ctx } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { Require } from '../identity/access.decorators';

class EmployeeBody extends createZodDto(EmployeeDto) {}
class EmployeeQuery extends createZodDto(z.object({ branchId: z.string().uuid().optional() })) {}
const id = new ParseUUIDPipe();

@Injectable()
export class StaffService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  list(branchId?: string) {
    const p = ctx().principal!;
    const scope = p.branchScope('staff.employee.read');
    const salary = p.can('staff.salary.read');
    return this.db.tx(async (q) => (await q.query(
      `SELECT e.id, e.branch_id AS "branchId", b.name AS branch, e.user_id AS "userId", u.email AS "userEmail", e.full_name AS "fullName", e.phone, e.email, e.position,
              ${salary ? 'e.salary' : 'NULL::numeric'} AS salary, e.hired_at AS "hiredAt", e.status
         FROM employees e LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN users u ON u.id = e.user_id
        WHERE e.deleted_at IS NULL AND ($1::uuid IS NULL OR e.branch_id = $1) AND ($2::uuid[] IS NULL OR e.branch_id = ANY($2::uuid[])) ORDER BY e.full_name`, [branchId ?? null, scope])).rows);
  }

  save(idv: string | null, d: z.infer<typeof EmployeeDto>) {
    const p = ctx().principal!;
    return this.db.tx(async (q) => {
      const sal = p.can('staff.salary.read') ? (d.salary ?? null) : null;   // sólo quien ve salarios puede fijarlos
      const vals = [d.branchId ?? null, d.userId ?? null, d.fullName, d.phone ?? null, d.email ?? null, d.position, d.hiredAt ?? null, d.status];
      const r = idv
        ? await q.query(`UPDATE employees SET branch_id=$2,user_id=$3,full_name=$4,phone=$5,email=$6,position=$7,hired_at=$8,status=$9, salary = CASE WHEN $10::boolean THEN $11 ELSE salary END WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [idv, ...vals, p.can('staff.salary.read'), sal])
        : await q.query(`INSERT INTO employees (tenant_id,branch_id,user_id,full_name,phone,email,position,hired_at,status,salary) VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [...vals, sal]);
      if (!r.rows[0]) throw notFound('employee');
      await this.audit.record(q, { action: idv ? 'employee.update' : 'employee.create', entity: 'employee', entityId: r.rows[0].id, branchId: d.branchId ?? null, newValue: { ...d, salary: d.salary == null ? null : '[RESTRINGIDO]' } });
      return { id: r.rows[0].id };
    });
  }

  remove(idv: string) {
    return this.db.tx(async (q) => {
      const r = await q.query(`UPDATE employees SET deleted_at = now(), status='INACTIVE' WHERE id=$1 AND deleted_at IS NULL`, [idv]);
      if (!r.rowCount) throw notFound('employee');
      await this.audit.record(q, { action: 'employee.delete', entity: 'employee', entityId: idv });
    });
  }
}

@ApiTags('staff')
@Controller('employees')
class StaffController {
  constructor(private readonly svc: StaffService) {}
  @Get() @Require('staff.employee.read') list(@Query() q: EmployeeQuery) { return this.svc.list(q.branchId); }
  @Post() @Require('staff.employee.write') create(@Body() b: EmployeeBody) { return this.svc.save(null, b); }
  @Put(':id') @Require('staff.employee.write') update(@Param('id', id) i: string, @Body() b: EmployeeBody) { return this.svc.save(i, b); }
  @Delete(':id') @HttpCode(204) @Require('staff.employee.write') async remove(@Param('id', id) i: string) { await this.svc.remove(i); }
}

@Global()
@Module({ controllers: [StaffController], providers: [StaffService], exports: [StaffService] })
export class StaffModule {}
