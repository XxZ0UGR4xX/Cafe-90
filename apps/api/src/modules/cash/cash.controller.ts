import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CashMovementDto, RegisterDto, ShiftCloseDto, ShiftOpenDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { CashService } from './cash.service';

class ShiftOpenBody extends createZodDto(ShiftOpenDto) {}
class CloseBody extends createZodDto(ShiftCloseDto) {}
class CashMovementBody extends createZodDto(CashMovementDto) {}
class RegisterBody extends createZodDto(RegisterDto) {}
class CashBranchQuery extends createZodDto(z.object({ branchId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(200).default(50) })) {}
class OptBranchQuery extends createZodDto(z.object({ branchId: z.string().uuid().optional() })) {}
const id = new ParseUUIDPipe();

@ApiTags('cash')
@Controller('cash')
export class CashController {
  constructor(private readonly svc: CashService) {}
  @Get('registers') @Require('cash.shift.operate') registers(@Query() q: CashBranchQuery) { return this.svc.listRegisters(q.branchId); }
  @Post('registers') @Require('cash.shift.approve') register(@Body() b: RegisterBody) { return this.svc.createRegister(b); }
  @Post('shifts/open') @Require('cash.shift.operate') open(@Body() b: ShiftOpenBody) { return this.svc.open(b); }
  @Get('shifts/current') @Require('cash.shift.operate') current(@Query() q: OptBranchQuery) { return this.svc.current(q.branchId); }
  @Get('shifts') @Require('cash.shift.readAll') list(@Query() q: CashBranchQuery) { return this.svc.list(q.branchId, q.limit); }
  @Get('shifts/:id') @Require('cash.shift.operate') get(@Param('id', id) i: string) { return this.svc.get(i); }
  @Get('shifts/:id/report') @Require('cash.shift.operate') report(@Param('id', id) i: string) { return this.svc.get(i); }
  @Post('shifts/:id/close') @Require('cash.shift.operate') close(@Param('id', id) i: string, @Body() b: CloseBody) { return this.svc.close(i, b); }
  @Post('movements') @Require('cash.movement.write') movement(@Body() b: CashMovementBody) { return this.svc.movement(b); }
}
