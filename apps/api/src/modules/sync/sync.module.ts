import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SupervisorAuthDto, SyncPushDto, SyncResolveDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { SyncService } from './sync.service';

class PushBody extends createZodDto(SyncPushDto) {}
class ResolveBody extends createZodDto(SyncResolveDto) {}
class SyncBranchQuery extends createZodDto(z.object({ branchId: z.string().uuid() })) {}
const id = new ParseUUIDPipe();

@ApiTags('sync')
@Controller('sync')
class SyncController {
  constructor(private readonly svc: SyncService) {}
  @Post('push') @Require('sales.order.create') push(@Body() b: PushBody) { return this.svc.push(b as any); }
  @Get('pull') @Require('catalog.product.read') pull(@Query() q: SyncBranchQuery) { return this.svc.pull(q.branchId); }
  @Get('exceptions') @Require('sales.order.readAll') exceptions(@Query() q: SyncBranchQuery) { return this.svc.exceptions(q.branchId); }
  @Post('exceptions/:id/retry') @Require('sales.order.readAll') retry(@Param('id', id) i: string, @Body() b?: { supervisor?: unknown }) {
    return this.svc.retry(i, b?.supervisor ? SupervisorAuthDto.parse(b.supervisor) : undefined);
  }
  @Post('exceptions/:id/resolve') @Require('sales.order.readAll') resolve(@Param('id', id) i: string, @Body() b: ResolveBody) { return this.svc.resolve(i, b.note); }
}

@Module({ controllers: [SyncController], providers: [SyncService] })
export class SyncModule {}
