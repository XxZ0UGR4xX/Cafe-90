import { Body, Controller, Get, Global, HttpCode, Inject, Module, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import type { FastifyReply } from 'fastify';
import { CancelInvoiceDto, CustomerFiscalDto, FiscalProfileDto, GlobalInvoiceDto, InvoiceListQueryDto, IssueInvoiceDto } from '@retroburger/shared';
import { ENV, type Env } from '../../config/env';
import { Require } from '../identity/access.decorators';
import { FISCAL_PROVIDER, FiscalService } from './fiscal.service';
import type { FiscalProvider } from './providers/provider';
import { SandboxProvider } from './providers/sandbox.provider';

class ProfileBody extends createZodDto(FiscalProfileDto) {}
class CustomerFiscalBody extends createZodDto(CustomerFiscalDto) {}
class IssueBody extends createZodDto(IssueInvoiceDto) {}
class GlobalBody extends createZodDto(GlobalInvoiceDto) {}
class CancelBody extends createZodDto(CancelInvoiceDto) {}
class ListQuery extends createZodDto(InvoiceListQueryDto) {}
const id = new ParseUUIDPipe();

@ApiTags('fiscal')
@Controller()
class FiscalController {
  constructor(private readonly svc: FiscalService) {}

  @Get('fiscal/catalogs') @Require('fiscal.invoice.read') catalogs() { return this.svc.catalogs(); }
  @Get('fiscal/profile') @Require('fiscal.profile.read') profile() { return this.svc.profile(); }
  @Put('fiscal/profile') @Require('fiscal.profile.write') saveProfile(@Body() b: ProfileBody) { return this.svc.saveProfile(b); }

  @Get('customers/:id/fiscal') @Require('crm.customer.read') customerFiscal(@Param('id', id) i: string) { return this.svc.customerFiscal(i); }
  @Put('customers/:id/fiscal') @Require('crm.customer.write') saveCustomerFiscal(@Param('id', id) i: string, @Body() b: CustomerFiscalBody) { return this.svc.saveCustomerFiscal(i, b); }

  @Post('invoices') @Require('fiscal.invoice.issue') issue(@Body() b: IssueBody) { return this.svc.issueForOrder(b); }
  @Post('invoices/global') @Require('fiscal.invoice.issue') global(@Body() b: GlobalBody) { return this.svc.issueGlobal(b); }
  @Get('invoices') @Require('fiscal.invoice.read') list(@Query() q: ListQuery) { return this.svc.list(q); }
  @Get('invoices/:id') @Require('fiscal.invoice.read') get(@Param('id', id) i: string) { return this.svc.get(i); }
  @Get('invoices/:id/xml') @Require('fiscal.invoice.read')
  async xml(@Param('id', id) i: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.svc.xml(i);
    reply.header('content-type', 'application/xml; charset=utf-8').header('content-disposition', `attachment; filename="${r.filename}"`);
    return r.xml;
  }
  @Post('invoices/:id/cancel') @HttpCode(200) @Require('fiscal.invoice.cancel') cancel(@Param('id', id) i: string, @Body() b: CancelBody) { return this.svc.cancel(i, b); }
  @Post('invoices/:id/retry') @HttpCode(200) @Require('fiscal.invoice.issue') retry(@Param('id', id) i: string) { return this.svc.retry(i); }
}

/** 'sandbox' (simulado, sin validez fiscal) o 'none'. Un PAC real se agrega implementando FiscalProvider (ver docs/FISCAL.md). */
export const providerKey = (env: Env): 'sandbox' | 'none' => env.FISCAL_PROVIDER ?? (env.NODE_ENV === 'production' ? 'none' : 'sandbox');

@Global()
@Module({
  controllers: [FiscalController],
  providers: [
    FiscalService,
    { provide: FISCAL_PROVIDER, inject: [ENV], useFactory: (env: Env): FiscalProvider | null => (providerKey(env) === 'sandbox' ? new SandboxProvider() : null) },
  ],
  exports: [FiscalService],
})
export class FiscalModule { constructor(@Inject(ENV) _env: Env) {} }
