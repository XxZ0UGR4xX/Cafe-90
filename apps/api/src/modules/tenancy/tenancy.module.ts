import { Global, Module, OnModuleInit } from '@nestjs/common';
import { BranchesService } from './branches.service';
import { ProvisionerService } from './provisioner.service';
import { SettingsService } from './settings.service';
import { TenancyController } from './tenancy.controller';

@Global()
@Module({
  controllers: [TenancyController],
  providers: [BranchesService, SettingsService, ProvisionerService],
  exports: [BranchesService, SettingsService, ProvisionerService],
})
export class TenancyModule implements OnModuleInit {
  constructor(private readonly provisioner: ProvisionerService) {}
  async onModuleInit() { await this.provisioner.syncPermissionCatalog(); await this.provisioner.syncSystemRoles(); }
}
