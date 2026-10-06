import { Body, Controller, Delete, Get, Global, HttpCode, Module, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ApplyCouponDto, PromotionDto } from '@retroburger/shared';
import { DomainEvents } from '../../common/domain-events';
import { DbService } from '../../database/db.service';
import { ctx } from '../../common/request-context';
import { forbidden } from '../../common/errors';
import { Require } from '../identity/access.decorators';
import { SalesService } from '../sales/sales.service';
import { PromotionsService } from './promotions.service';

class PromotionBody extends createZodDto(PromotionDto) {}
class CouponBody extends createZodDto(ApplyCouponDto) {}
class ActiveQuery extends createZodDto(z.object({ branchId: z.string().uuid() })) {}
const id = new ParseUUIDPipe();

@ApiTags('promotions')
@Controller()
class PromotionsController {
  constructor(private readonly svc: PromotionsService, private readonly sales: SalesService, private readonly db: DbService) {}
  @Get('promotions') @Require('promotions.promotion.read') list() { return this.svc.list(); }
  @Get('promotions/active') @Require('promotions.promotion.read') active(@Query() q: ActiveQuery) { return this.svc.listActive(q.branchId); }
  @Post('promotions') @Require('promotions.promotion.write') create(@Body() b: PromotionBody) { return this.svc.save(null, b); }
  @Put('promotions/:id') @Require('promotions.promotion.write') update(@Param('id', id) i: string, @Body() b: PromotionBody) { return this.svc.save(i, b); }
  @Delete('promotions/:id') @HttpCode(204) @Require('promotions.promotion.write') async remove(@Param('id', id) i: string) { await this.svc.remove(i); }

  @Post('orders/:id/coupon') @Require('sales.discount.apply')
  coupon(@Param('id', id) i: string, @Body() b: CouponBody) { return this.setCoupon(i, b.code, true); }
  @Delete('orders/:id/coupon/:code') @Require('sales.discount.apply')
  removeCoupon(@Param('id', id) i: string, @Param('code') code: string) { return this.setCoupon(i, code, false); }

  private setCoupon(orderId: string, code: string, add: boolean) {
    return this.db.tx(async (q) => {
      const o = await this.sales.lockOrder(q, orderId);
      if (!ctx().principal!.can('sales.discount.apply', o.branch_id)) throw forbidden();
      await this.svc.setCoupon(q, orderId, code, add);
      await this.sales.recalc(q, orderId);
      return this.sales.get(orderId, q);
    });
  }
}

@Global()
@Module({ controllers: [PromotionsController], providers: [PromotionsService], exports: [PromotionsService] })
export class PromotionsModule implements OnModuleInit {
  constructor(private readonly events: DomainEvents, private readonly svc: PromotionsService) {}
  onModuleInit() { this.events.on('OrderPaid', (q, e) => this.svc.redeemFor(q, e.payload.orderId, e.payload.customerId)); }
}
