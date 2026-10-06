import { Controller, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Require } from '../identity/access.decorators';
import { NotificationsService } from './notifications.service';

class NotificationsListQuery extends createZodDto(z.object({
  branchId: z.string().uuid().optional(),
  unreadOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(200).default(50) })) {}

@ApiTags('notifications')
@Controller('notifications')
class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}
  @Get() @Require('notifications.read') list(@Query() q: NotificationsListQuery) { return this.svc.list(q); }
  @Post('read-all') @HttpCode(204) @Require('notifications.read') async readAll() { await this.svc.markAllRead(); }
  @Post(':id/read') @HttpCode(204) @Require('notifications.read')
  async read(@Param('id', new ParseUUIDPipe()) id: string) { await this.svc.markRead(id); }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
