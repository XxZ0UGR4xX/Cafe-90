import { Body, Controller, Get, Global, Header, HttpCode, Module, OnModuleInit, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PrinterDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { PrintingService } from './printing.service';

class PrinterBody extends createZodDto(PrinterDto) {}
class BranchQ extends createZodDto(z.object({ branchId: z.string().uuid() })) {}
class AckBody extends createZodDto(z.object({ ok: z.boolean() })) {}
class WidthQ extends createZodDto(z.object({ width: z.coerce.number().int().min(24).max(80).default(42) })) {}
const id = new ParseUUIDPipe();

@ApiTags('printing')
@Controller()
class PrintingController {
  constructor(private readonly svc: PrintingService) {}
  @Get('printers') @Require('printing.manage') printers(@Query() q: BranchQ) { return this.svc.printers(q.branchId); }
  @Post('printers') @Require('printing.manage') create(@Body() b: PrinterBody) { return this.svc.savePrinter(null, b); }
  @Put('printers/:id') @Require('printing.manage') update(@Param('id', id) i: string, @Body() b: PrinterBody) { return this.svc.savePrinter(i, b); }
  @Get('print/jobs/pending') @Require('printing.manage') pending(@Query('printerId', id) p: string) { return this.svc.pending(p); }
  @Post('print/jobs/:id/ack') @HttpCode(200) @Require('printing.manage') ack(@Param('id', id) i: string, @Body() b: AckBody) { return this.svc.ack(i, b.ok); }
  @Get('orders/:id/receipt.txt') @Header('Content-Type', 'text/plain; charset=utf-8') @Require('sales.order.read')
  receipt(@Param('id', id) i: string, @Query() q: WidthQ) { return this.svc.receiptText(i, q.width); }
}

@Global()
@Module({ controllers: [PrintingController], providers: [PrintingService], exports: [PrintingService] })
export class PrintingModule implements OnModuleInit {
  constructor(private readonly svc: PrintingService) {}
  onModuleInit() { this.svc.register(); }
}
