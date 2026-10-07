import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CountDto, CountSubmitDto, MovementDto, StockLevelDto, TransferDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { InventoryService } from './inventory.service';
import { ReconciliationService } from './reconciliation.service';
import { DbService } from '../../database/db.service';
import { ctx } from '../../common/request-context';
import { forbidden } from '../../common/errors';

class InventoryMovementBody extends createZodDto(MovementDto) {}
class LevelBody extends createZodDto(StockLevelDto) {}
class CountBody extends createZodDto(CountDto) {}
class CountSubmitBody extends createZodDto(CountSubmitDto) {}
class StockTransferBody extends createZodDto(TransferDto) {}
class TransferReceiveBody extends createZodDto(z.object({ items: z.array(z.object({ ingredientId: z.string().uuid(), qty: z.number().min(0) })).optional() })) {}
class StockQuery extends createZodDto(z.object({ branchId: z.string().uuid().optional(), status: z.enum(['AVAILABLE', 'LOW', 'CRITICAL', 'OUT_OF_STOCK']).optional() })) {}
class KardexQuery extends createZodDto(z.object({
  branchId: z.string().uuid(), ingredientId: z.string().uuid().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100) })) {}
class ExpQuery extends createZodDto(z.object({ branchId: z.string().uuid(), days: z.coerce.number().int().min(1).max(365).default(7) })) {}
class TransferQuery extends createZodDto(z.object({ branchId: z.string().uuid().optional() })) {}

const id = new ParseUUIDPipe();

@ApiTags('inventory')
@Controller()
export class InventoryController {
  constructor(private readonly svc: InventoryService, private readonly recon: ReconciliationService, private readonly db: DbService) {}

  @Get('inventory') @Require('inventory.stock.read') stock(@Query() q: StockQuery) { return this.svc.stock(q.branchId, q.status); }
  @Get('inventory/kardex') @Require('inventory.stock.read') kardex(@Query() q: KardexQuery) { return this.svc.kardex(q); }
  /** Conciliación kardex ↔ saldo ↔ lotes de una sucursal (la misma que corre cada noche). */
  @Get('inventory/reconciliation') @Require('inventory.stock.read') async reconciliation(@Query() q: TransferQuery) {
    if (q.branchId && !ctx().principal!.can('inventory.stock.read', q.branchId)) throw forbidden();
    const findings = await this.db.tx((tx) => this.recon.check(tx, q.branchId));
    const scope = ctx().principal!.branchScope('inventory.stock.read');
    return { checkedAt: new Date().toISOString(), ok: findings.every((f) => f.severity !== 'CRITICAL'), findings: scope ? findings.filter((f) => scope.includes(f.branchId)) : findings };
  }
  @Get('inventory/expiring') @Require('inventory.stock.read') expiring(@Query() q: ExpQuery) { return this.svc.expiring(q.branchId, q.days); }
  @Post('inventory/movements') @Require('inventory.movement.write') move(@Body() b: InventoryMovementBody) { return this.svc.move(b); }
  @Put('inventory/levels') @Require('inventory.movement.write') levels(@Body() b: LevelBody) { return this.svc.setLevels(b); }

  @Post('inventory/counts') @Require('inventory.count.write') createCount(@Body() b: CountBody) { return this.svc.createCount(b); }
  @Get('inventory/counts/:id') @Require('inventory.count.write') count(@Param('id', id) i: string) { return this.svc.getCountById(i); }
  @Put('inventory/counts/:id/items') @Require('inventory.count.write') submit(@Param('id', id) i: string, @Body() b: CountSubmitBody) { return this.svc.submitCount(i, b.items); }
  @Post('inventory/counts/:id/apply') @Require('inventory.count.write') apply(@Param('id', id) i: string) { return this.svc.applyCount(i); }

  @Get('transfers') @Require('inventory.transfer.read') transfers(@Query() q: TransferQuery) { return this.svc.listTransfers(q.branchId); }
  @Get('transfers/:id') @Require('inventory.transfer.read') transfer(@Param('id', id) i: string) { return this.svc.getTransfer(i); }
  @Post('transfers') @Require('inventory.transfer.write') createTransfer(@Body() b: StockTransferBody) { return this.svc.createTransfer(b); }
  @Post('transfers/:id/approve') @Require('inventory.transfer.approve') approve(@Param('id', id) i: string) { return this.svc.transition(i, 'approve'); }
  @Post('transfers/:id/dispatch') @Require('inventory.transfer.write') dispatch(@Param('id', id) i: string) { return this.svc.transition(i, 'dispatch'); }
  @Post('transfers/:id/receive') @Require('inventory.transfer.write') receive(@Param('id', id) i: string, @Body() b: TransferReceiveBody) { return this.svc.transition(i, 'receive', b); }
  @Post('transfers/:id/cancel') @Require('inventory.transfer.write') cancel(@Param('id', id) i: string) { return this.svc.transition(i, 'cancel'); }
}
