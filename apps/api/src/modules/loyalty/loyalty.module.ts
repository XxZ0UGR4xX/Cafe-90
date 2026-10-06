import { Body, Controller, Get, Global, Module, OnModuleInit, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { LoyaltyProgramDto, PointsAdjustDto, RedeemDto, RewardDto } from '@retroburger/shared';
import { DomainEvents } from '../../common/domain-events';
import { Require } from '../identity/access.decorators';
import { LoyaltyService } from './loyalty.service';

class ProgramBody extends createZodDto(LoyaltyProgramDto) {}
class RewardBody extends createZodDto(RewardDto) {}
class RedeemBody extends createZodDto(RedeemDto) {}
class AdjustBody extends createZodDto(PointsAdjustDto) {}
const id = new ParseUUIDPipe();

@ApiTags('loyalty')
@Controller('loyalty')
class LoyaltyController {
  constructor(private readonly svc: LoyaltyService) {}
  @Get('program') @Require('loyalty.rule.read') program() { return this.svc.program(); }
  @Put('program') @Require('loyalty.rule.write') saveProgram(@Body() b: ProgramBody) { return this.svc.saveProgram(b); }
  @Get('rewards') @Require('loyalty.rule.read') rewards() { return this.svc.rewards(); }
  @Post('rewards') @Require('loyalty.rule.write') createReward(@Body() b: RewardBody) { return this.svc.saveReward(null, b); }
  @Put('rewards/:id') @Require('loyalty.rule.write') updateReward(@Param('id', id) i: string, @Body() b: RewardBody) { return this.svc.saveReward(i, b); }
  @Get('customers/:id') @Require('crm.customer.read') account(@Param('id', id) i: string) { return this.svc.accountView(i); }
  @Post('redeem') @Require('loyalty.redeem') redeem(@Body() b: RedeemBody) { return this.svc.redeem(b); }
  @Post('adjust') @Require('loyalty.rule.write') adjust(@Body() b: AdjustBody) { return this.svc.adjust(b); }
}

@Global()
@Module({ controllers: [LoyaltyController], providers: [LoyaltyService], exports: [LoyaltyService] })
export class LoyaltyModule implements OnModuleInit {
  constructor(private readonly events: DomainEvents, private readonly loyalty: LoyaltyService) {}
  onModuleInit() {
    this.events.on('OrderPaid', (q, e) => this.loyalty.earnForOrder(q, { orderId: e.payload.orderId, customerId: e.payload.customerId, total: e.payload.total, branchId: e.branchId! }));
    this.events.on('OrderRefunded', async (q, e) => { if (e.payload.full) await this.loyalty.reverseForOrder(q, { orderId: e.payload.orderId, customerId: e.payload.customerId }); });
    this.events.on('OrderCancelled', async (q, e) => {
      const o = (await q.query('SELECT customer_id FROM orders WHERE id=$1', [e.payload.orderId])).rows[0];
      await this.loyalty.reverseForOrder(q, { orderId: e.payload.orderId, customerId: o?.customer_id ?? null });
    });
  }
}
