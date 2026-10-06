import { Body, Controller, Delete, Get, Global, HttpCode, Module, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CUSTOMER_SEGMENTS, CustomerDto } from '@retroburger/shared';
import { DomainEvents } from '../../common/domain-events';
import { Require } from '../identity/access.decorators';
import { CrmService } from './crm.service';

class CustomerBody extends createZodDto(CustomerDto) {}
class CustomersListQuery extends createZodDto(z.object({
  q: z.string().max(80).optional(), segment: z.enum(CUSTOMER_SEGMENTS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) })) {}
const id = new ParseUUIDPipe();

@ApiTags('crm')
@Controller('customers')
class CrmController {
  constructor(private readonly svc: CrmService) {}
  @Get() @Require('crm.customer.read') list(@Query() q: CustomersListQuery) { return this.svc.list(q); }
  @Get(':id') @Require('crm.customer.read') get(@Param('id', id) i: string) { return this.svc.get(i); }
  @Post() @Require('crm.customer.write') create(@Body() b: CustomerBody) { return this.svc.save(null, b); }
  @Put(':id') @Require('crm.customer.write') update(@Param('id', id) i: string, @Body() b: CustomerBody) { return this.svc.save(i, b); }
  @Delete(':id') @HttpCode(204) @Require('crm.customer.write') async remove(@Param('id', id) i: string) { await this.svc.remove(i); }
}

@Global()
@Module({ controllers: [CrmController], providers: [CrmService], exports: [CrmService] })
export class CrmModule implements OnModuleInit {
  constructor(private readonly events: DomainEvents, private readonly crm: CrmService) {}
  onModuleInit() {
    this.events.on('OrderPaid', async (q, e) => { if (e.payload.customerId) await this.crm.recordVisit(q, e.payload.customerId, e.payload.total); });
    this.events.on('OrderRefunded', async (q, e) => { if (e.payload.customerId) await this.crm.reverseVisit(q, e.payload.customerId, e.payload.amount, e.payload.full); });
  }
}
