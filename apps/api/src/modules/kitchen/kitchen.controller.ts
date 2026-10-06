import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { StationDto, TicketStatusDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { KitchenService } from './kitchen.service';

class StatusBody extends createZodDto(TicketStatusDto) {}
class StationBody extends createZodDto(StationDto) {}
class TicketsQuery extends createZodDto(z.object({ branchId: z.string().uuid(), station: z.string().max(30).optional(), status: z.enum(['NEW', 'PREPARING', 'READY', 'DELIVERED']).optional() })) {}
class KitchenBranchQuery extends createZodDto(z.object({ branchId: z.string().uuid() })) {}
const id = new ParseUUIDPipe();

@ApiTags('kitchen')
@Controller('kitchen')
export class KitchenController {
  constructor(private readonly svc: KitchenService) {}
  @Get('stations') @Require('kitchen.ticket.read') stations(@Query() q: KitchenBranchQuery) { return this.svc.stations(q.branchId); }
  @Put('branches/:branchId/stations') @Require('tenancy.settings.write')
  saveStation(@Param('branchId', id) b: string, @Body() d: StationBody) { return this.svc.saveStation(b, d); }
  @Get('tickets') @Require('kitchen.ticket.read') tickets(@Query() q: TicketsQuery) { return this.svc.tickets(q); }
  @Patch('tickets/:id/status') @Require('kitchen.ticket.update') status(@Param('id', id) i: string, @Body() b: StatusBody) { return this.svc.setStatus(i, b.to); }
  @Get('metrics') @Require('kitchen.metrics.read') metrics(@Query() q: KitchenBranchQuery) { return this.svc.metrics(q.branchId); }
}
