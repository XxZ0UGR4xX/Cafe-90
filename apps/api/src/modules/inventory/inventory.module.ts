import { Global, Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryEngine } from './inventory.engine';
import { ReconciliationService } from './reconciliation.service';
import { InventoryService } from './inventory.service';

@Global()
@Module({ controllers: [InventoryController], providers: [InventoryEngine, InventoryService, ReconciliationService], exports: [InventoryEngine, InventoryService, ReconciliationService] })
export class InventoryModule {}
