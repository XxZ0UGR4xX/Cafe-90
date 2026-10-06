import { Controller, Get, Global, Module, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DashboardQueryDto, REPORT_TYPES, ReportQueryDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { DashboardService } from './dashboard.service';
import { ReportsService } from './reports.service';

class ReportQuery extends createZodDto(ReportQueryDto) {}
class DashQuery extends createZodDto(DashboardQueryDto) {}
class BranchQ extends createZodDto(z.object({ branchId: z.string().uuid() })) {}
class AnalyticsQuery extends createZodDto(z.object({ branchId: z.string().uuid().optional(), from: z.string().date(), to: z.string().date() })) {}
class ReportType extends createZodDto(z.object({ type: z.enum(REPORT_TYPES) })) {}

@ApiTags('reports')
@Controller()
class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly dash: DashboardService) {}
  @Get('reports/:type') @Require('notifications.read') run(@Param() p: ReportType, @Query() q: ReportQuery) { return this.reports.run(p.type, q); }
  @Get('analytics/overview') @Require('reports.profit.read') analytics(@Query() q: AnalyticsQuery) { return this.reports.analytics(q); }
  @Get('dashboard/corporate') @Require('reports.corporate.read') corporate(@Query() q: DashQuery) { return this.dash.corporate(q); }
  @Get('dashboard/branches') @Require('tenancy.branch.read') branches() { return this.dash.branchCards(); }
  @Get('dashboard/manager') @Require('reports.sales.read') manager(@Query() q: BranchQ) { return this.dash.manager(q.branchId); }
  @Get('dashboard/cashier') @Require('cash.shift.operate') cashier(@Query() q: BranchQ) { return this.dash.cashier(q.branchId); }
  @Get('dashboard/waiter') @Require('floor.table.read') waiter(@Query() q: BranchQ) { return this.dash.waiter(q.branchId); }
  @Get('dashboard/warehouse') @Require('inventory.stock.read') warehouse(@Query() q: BranchQ) { return this.dash.warehouse(q.branchId); }
}

@Global()
@Module({ controllers: [ReportsController], providers: [ReportsService, DashboardService], exports: [ReportsService, DashboardService] })
export class ReportsModule {}
