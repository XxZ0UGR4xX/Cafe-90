import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessGuard } from './access.guard';
import { AuthController, LoginRateLimitGuard } from './auth.controller';
import { AuthService } from './auth.service';
import { IdentityController } from './identity.controller';
import { PrincipalRepository } from './principal.repository';
import { RolesService } from './roles.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Global()
@Module({
  controllers: [AuthController, IdentityController],
  providers: [
    AuthService, UsersService, UsersRepository, RolesService, PrincipalRepository, LoginRateLimitGuard,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [PrincipalRepository],
})
export class IdentityModule {}
