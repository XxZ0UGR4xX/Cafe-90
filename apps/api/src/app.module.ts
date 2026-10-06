import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { EventsModule } from './common/domain-events';
import { DbModule } from './database/db.module';
import { AuditModule } from './modules/audit/audit.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { CashModule } from './modules/cash/cash.module';
import { FloorModule } from './modules/floor/floor.module';
import { SalesModule } from './modules/sales/sales.module';
import { KitchenModule } from './modules/kitchen/kitchen.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { CrmModule } from './modules/crm/crm.module';
import { HealthController } from './modules/health/health.controller';
import { IdentityModule } from './modules/identity/identity.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

@Module({
  imports: [DbModule, EventsModule, AuditModule, IdentityModule, TenancyModule, CatalogModule, NotificationsModule, InventoryModule, PurchasingModule, CashModule, FloorModule, SalesModule, KitchenModule, RealtimeModule, CrmModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
