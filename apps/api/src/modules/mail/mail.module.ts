import { Body, Controller, Get, Global, HttpCode, Module, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env';
import { Require } from '../identity/access.decorators';
import { MAIL_TRANSPORT, MailService } from './mail.service';
import { LogTransport, SmtpTransport, type MailTransport } from './mail.transport';

class TestBody extends createZodDto(z.object({ to: z.string().email() })) {}
class OutboxQuery extends createZodDto(z.object({ status: z.enum(['PENDING', 'SENDING', 'SENT', 'FAILED']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })) {}

@ApiTags('mail')
@Controller('mail')
class MailController {
  constructor(private readonly svc: MailService) {}
  @Get('status') @Require('tenancy.settings.read') status() { return { transport: this.svc.transport.kind }; }
  @Get('outbox') @Require('tenancy.settings.read') outbox(@Query() q: OutboxQuery) { return this.svc.outbox(q.status, q.limit); }
  @Post('test') @HttpCode(200) @Require('tenancy.settings.write') test(@Body() b: TestBody) { return this.svc.sendTest(b.to); }
}

@Global()
@Module({
  controllers: [MailController],
  providers: [MailService, { provide: MAIL_TRANSPORT, inject: [ENV], useFactory: (env: Env): MailTransport => (env.SMTP_URL ? new SmtpTransport(env.SMTP_URL) : new LogTransport()) }],
  exports: [MailService],
})
export class MailModule {}
