import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { InvoiceDto, PurchaseOrderDto, QuoteDto, ReceiveDto, SupplierDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { PurchasingService } from './purchasing.service';

class SupplierBody extends createZodDto(SupplierDto) {}
class QuoteBody extends createZodDto(QuoteDto) {}
class OrderBody extends createZodDto(PurchaseOrderDto) {}
class PoReceiveBody extends createZodDto(ReceiveDto) {}
class InvoiceBody extends createZodDto(InvoiceDto) {}
class PurchasingBranchQuery extends createZodDto(z.object({ branchId: z.string().uuid().optional(), status: z.string().max(30).optional() })) {}
class SuggestQuery extends createZodDto(z.object({ branchId: z.string().uuid() })) {}
const id = new ParseUUIDPipe();

@ApiTags('purchasing')
@Controller()
export class PurchasingController {
  constructor(private readonly svc: PurchasingService) {}

  @Get('suppliers') @Require('purchasing.supplier.read') suppliers() { return this.svc.listSuppliers(); }
  @Post('suppliers') @Require('purchasing.supplier.write') createSupplier(@Body() b: SupplierBody) { return this.svc.saveSupplier(null, b); }
  @Put('suppliers/:id') @Require('purchasing.supplier.write') updateSupplier(@Param('id', id) i: string, @Body() b: SupplierBody) { return this.svc.saveSupplier(i, b); }
  @Delete('suppliers/:id') @HttpCode(204) @Require('purchasing.supplier.write') async deleteSupplier(@Param('id', id) i: string) { await this.svc.deleteSupplier(i); }

  @Get('purchase-quotes') @Require('purchasing.order.read') quotes(@Query() q: PurchasingBranchQuery) { return this.svc.listQuotes(q.branchId); }
  @Post('purchase-quotes') @Require('purchasing.order.write') createQuote(@Body() b: QuoteBody) { return this.svc.createQuote(b); }
  @Post('purchase-quotes/:id/accept') @Require('purchasing.order.write') accept(@Param('id', id) i: string) { return this.svc.acceptQuote(i); }

  @Get('purchase-suggestions') @Require('purchasing.order.read') suggestions(@Query() q: SuggestQuery) { return this.svc.suggestions(q.branchId); }
  @Get('purchase-orders') @Require('purchasing.order.read') orders(@Query() q: PurchasingBranchQuery) { return this.svc.listOrders(q.branchId, q.status); }
  @Get('purchase-orders/:id') @Require('purchasing.order.read') order(@Param('id', id) i: string) { return this.svc.getOrder(i); }
  @Post('purchase-orders') @Require('purchasing.order.write') createOrder(@Body() b: OrderBody) { return this.svc.createOrder(b); }
  @Post('purchase-orders/:id/submit') @Require('purchasing.order.write') submit(@Param('id', id) i: string) { return this.svc.submitOrder(i); }
  @Post('purchase-orders/:id/approve') @Require('purchasing.order.approve') approve(@Param('id', id) i: string) { return this.svc.approveOrder(i); }
  @Post('purchase-orders/:id/cancel') @Require('purchasing.order.write') cancel(@Param('id', id) i: string) { return this.svc.cancelOrder(i); }
  @Post('purchase-orders/:id/receive') @Require('purchasing.receive.write') receive(@Param('id', id) i: string, @Body() b: PoReceiveBody) { return this.svc.receive(i, b); }

  @Get('supplier-invoices') @Require('purchasing.order.read') invoices(@Query() q: PurchasingBranchQuery) { return this.svc.listInvoices(q.status); }
  @Post('supplier-invoices') @Require('purchasing.order.write') createInvoice(@Body() b: InvoiceBody) { return this.svc.createInvoice(b); }
  @Post('supplier-invoices/:id/pay') @Require('purchasing.order.approve') pay(@Param('id', id) i: string) { return this.svc.payInvoice(i); }
  @Get('ingredients/:id/cost-history') @Require('inventory.cost.read') costHistory(@Param('id', id) i: string) { return this.svc.costHistory(i); }
}
