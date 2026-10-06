import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { AddItemsDto, CancelDto, DiscountDto, ItemCancelDto, ItemPatchDto, OrderCreateDto, OrderListDto, OrderPatchDto, PayDto, RefundDto, SplitItemsDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { PaymentsService } from './payments.service';
import { SalesService } from './sales.service';

class CreateBody extends createZodDto(OrderCreateDto) {}
class PatchBody extends createZodDto(OrderPatchDto) {}
class AddItemsBody extends createZodDto(AddItemsDto) {}
class ItemPatchBody extends createZodDto(ItemPatchDto) {}
class ItemCancelBody extends createZodDto(ItemCancelDto) {}
class PayBody extends createZodDto(PayDto) {}
class DiscountBody extends createZodDto(DiscountDto) {}
class CancelBody extends createZodDto(CancelDto) {}
class RefundBody extends createZodDto(RefundDto) {}
class SplitBody extends createZodDto(SplitItemsDto) {}
class OrdersListQuery extends createZodDto(OrderListDto) {}
const id = new ParseUUIDPipe();

@ApiTags('sales')
@Controller('orders')
export class SalesController {
  constructor(private readonly sales: SalesService, private readonly payments: PaymentsService) {}

  @Get() @Require('sales.order.read') list(@Query() q: OrdersListQuery) { return this.sales.list(q); }
  @Get(':id') @Require('sales.order.read') get(@Param('id', id) i: string) { return this.sales.get(i); }
  @Get(':id/receipt') @Require('sales.order.read') receipt(@Param('id', id) i: string) { return this.sales.receipt(i); }
  @Post() @Require('sales.order.create') create(@Body() b: CreateBody) { return this.sales.create(b); }
  @Patch(':id') @Require('sales.order.update') patch(@Param('id', id) i: string, @Body() b: PatchBody) { return this.sales.patch(i, b); }
  @Post(':id/items') @Require('sales.order.update') add(@Param('id', id) i: string, @Body() b: AddItemsBody) { return this.sales.addItems(i, b); }
  @Patch(':id/items/:itemId') @Require('sales.order.update')
  updateItem(@Param('id', id) i: string, @Param('itemId', id) it: string, @Body() b: ItemPatchBody) { return this.sales.updateItem(i, it, b); }
  @Post(':id/items/:itemId/cancel') @Require('sales.order.update')
  cancelItem(@Param('id', id) i: string, @Param('itemId', id) it: string, @Body() b: ItemCancelBody) { return this.sales.cancelItem(i, it, b); }
  @Post(':id/send-to-kitchen') @Require('sales.order.update') send(@Param('id', id) i: string) { return this.sales.sendToKitchen(i); }
  @Post(':id/discount') @Require('sales.discount.apply') discount(@Param('id', id) i: string, @Body() b: DiscountBody) { return this.sales.discount(i, b); }
  @Delete(':id/discounts/:discountId') @Require('sales.discount.override')
  removeDiscount(@Param('id', id) i: string, @Param('discountId', id) d: string) { return this.sales.removeDiscount(i, d); }
  @Post(':id/split') @Require('sales.order.update') split(@Param('id', id) i: string, @Body() b: SplitBody) { return this.sales.splitItems(i, b.itemIds); }
  @Post(':id/pay') @HttpCode(200) @Require('sales.order.pay') pay(@Param('id', id) i: string, @Body() b: PayBody) { return this.payments.pay(i, b); }
  @Post(':id/cancel') @HttpCode(200) @Require('sales.order.update') cancel(@Param('id', id) i: string, @Body() b: CancelBody) { return this.sales.cancel(i, b); }
  @Post(':id/refund') @HttpCode(200) @Require('sales.order.pay') refund(@Param('id', id) i: string, @Body() b: RefundBody) { return this.payments.refund(i, b); }
}
