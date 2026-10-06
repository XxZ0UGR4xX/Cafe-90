import { Body, Controller, Get, Global, Module, OnModuleInit, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DELIVERY_STATUSES, DeliveryAssignDto, DeliveryCreateDto, DeliveryStatusDto } from '@retroburger/shared';
import { Authenticated, Require } from '../identity/access.decorators';
import { DeliveryService } from './delivery.service';

class CreateBody extends createZodDto(DeliveryCreateDto) {}
class StatusBody extends createZodDto(DeliveryStatusDto) {}
class AssignBody extends createZodDto(DeliveryAssignDto) {}
class DeliveryListQuery extends createZodDto(z.object({ branchId: z.string().uuid(), status: z.string().max(100).optional(), mine: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') })) {}
void DELIVERY_STATUSES;
const id = new ParseUUIDPipe();

@ApiTags('delivery')
@Controller('delivery-orders')
class DeliveryController {
  constructor(private readonly svc: DeliveryService) {}
  @Get() @Require('delivery.order.read') list(@Query() q: DeliveryListQuery) { return this.svc.list(q); }
  @Get('mine') @Require('delivery.order.own') mine(@Query() q: DeliveryListQuery) { return this.svc.list({ ...q, mine: true }); }
  @Get(':id') @Require('delivery.order.read') get(@Param('id', id) i: string) { return this.svc.get(i); }
  @Post() @Require('delivery.order.write') create(@Body() b: CreateBody) { return this.svc.create(b); }
  @Post(':id/assign') @Require('delivery.order.write') assign(@Param('id', id) i: string, @Body() b: AssignBody) { return this.svc.assign(i, b.driverId); }
  @Post(':id/status') @Authenticated() status(@Param('id', id) i: string, @Body() b: StatusBody) { return this.svc.setStatus(i, b.to, b.reason); }
}

@Global()
@Module({ controllers: [DeliveryController], providers: [DeliveryService], exports: [DeliveryService] })
export class DeliveryModule implements OnModuleInit {
  constructor(private readonly svc: DeliveryService) {}
  onModuleInit() { this.svc.register(); }
}
