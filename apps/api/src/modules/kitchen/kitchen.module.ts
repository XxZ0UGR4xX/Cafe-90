import { Global, Module, OnModuleInit } from '@nestjs/common';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';

@Global()
@Module({ controllers: [KitchenController], providers: [KitchenService], exports: [KitchenService] })
export class KitchenModule implements OnModuleInit {
  constructor(private readonly svc: KitchenService) {}
  onModuleInit() { this.svc.register(); }
}
