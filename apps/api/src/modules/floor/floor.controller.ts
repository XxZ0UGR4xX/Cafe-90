import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { TableDto, TableMergeDto, TableMoveDto, TableOpenDto, TableTransferDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { FloorService } from './floor.service';

class TableBody extends createZodDto(TableDto) {}
class TableOpenBody extends createZodDto(TableOpenDto) {}
class MoveBody extends createZodDto(TableMoveDto) {}
class MergeBody extends createZodDto(TableMergeDto) {}
class TableTransferBody extends createZodDto(TableTransferDto) {}
class FloorBranchQuery extends createZodDto(z.object({ branchId: z.string().uuid() })) {}
const id = new ParseUUIDPipe();

@ApiTags('floor')
@Controller()
export class FloorController {
  constructor(private readonly svc: FloorService) {}
  @Get('tables') @Require('floor.table.read') list(@Query() q: FloorBranchQuery) { return this.svc.list(q.branchId); }
  @Post('branches/:branchId/tables') @Require('floor.table.write') create(@Param('branchId', id) b: string, @Body() d: TableBody) { return this.svc.save(b, null, d); }
  @Put('branches/:branchId/tables/:id') @Require('floor.table.write') update(@Param('branchId', id) b: string, @Param('id', id) i: string, @Body() d: TableBody) { return this.svc.save(b, i, d); }
  @Delete('branches/:branchId/tables/:id') @HttpCode(204) @Require('floor.table.write') async remove(@Param('branchId', id) b: string, @Param('id', id) i: string) { await this.svc.remove(b, i); }
  @Post('tables/:id/open') @Require('floor.table.operate') open(@Param('id', id) i: string, @Body() d: TableOpenBody) { return this.svc.open(i, d); }
  @Post('tables/:id/move') @Require('floor.table.operate') move(@Param('id', id) i: string, @Body() d: MoveBody) { return this.svc.move(i, d.toTableId); }
  @Post('tables/:id/merge') @Require('floor.table.operate') merge(@Param('id', id) i: string, @Body() d: MergeBody) { return this.svc.merge(i, d.tableIds); }
  @Post('tables/:id/transfer') @Require('floor.table.operate') transfer(@Param('id', id) i: string, @Body() d: TableTransferBody) { return this.svc.transfer(i, d.waiterId); }
  @Post('tables/:id/release') @Require('floor.table.operate') release(@Param('id', id) i: string) { return this.svc.release(i); }
  @Post('tables/:id/clean') @Require('floor.table.operate') clean(@Param('id', id) i: string) { return this.svc.clean(i); }
}
