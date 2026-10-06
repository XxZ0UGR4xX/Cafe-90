import { Global, Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryEngine } from './inventory.engine';
import { InventoryService } from './inventory.service';

@Global()
@Module({ controllers: [InventoryController], providers: [InventoryEngine, InventoryService], exports: [InventoryEngine, InventoryService] })
export class InventoryModule {}
