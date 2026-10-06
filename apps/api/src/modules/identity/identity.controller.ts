import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RoleDto, UserCreateDto, UserPatchDto } from '@retroburger/shared';
import { Require } from './access.decorators';
import { MfaService } from './mfa.service';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';

class UserCreateBody extends createZodDto(UserCreateDto) {}
class UserPatchBody extends createZodDto(UserPatchDto) {}
class RoleBody extends createZodDto(RoleDto) {}
class RolePatchBody extends createZodDto(RoleDto.omit({ key: true })) {}
class PageQuery extends createZodDto(z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) })) {}

@ApiTags('identity')
@Controller()
export class IdentityController {
  constructor(private readonly users: UsersService, private readonly roles: RolesService, private readonly mfa: MfaService) {}

  @Get('users') @Require('identity.user.read') listUsers(@Query() p: PageQuery) { return this.users.list(p); }
  @Get('users/:id') @Require('identity.user.read') getUser(@Param('id', ParseUUIDPipe) id: string) { return this.users.get(id); }
  @Post('users') @Require('identity.user.write') createUser(@Body() b: UserCreateBody) { return this.users.create(b); }
  @Patch('users/:id') @Require('identity.user.write')
  updateUser(@Param('id', ParseUUIDPipe) id: string, @Body() b: UserPatchBody) { return this.users.update(id, b); }
  @Delete('users/:id') @HttpCode(204) @Require('identity.user.write')
  async removeUser(@Param('id', ParseUUIDPipe) id: string) { await this.users.remove(id); }

  @Post('users/:id/mfa/reset') @HttpCode(204) @Require('identity.user.write')
  async resetMfa(@Param('id', ParseUUIDPipe) id: string) { await this.mfa.adminReset(id); }

  @Get('roles') @Require('identity.role.read') listRoles() { return this.roles.list(); }
  @Get('permissions') @Require('identity.role.read') permissions() { return this.roles.permissions(); }
  @Post('roles') @Require('identity.role.write') createRole(@Body() b: RoleBody) { return this.roles.create(b); }
  @Put('roles/:id') @Require('identity.role.write')
  updateRole(@Param('id', ParseUUIDPipe) id: string, @Body() b: RolePatchBody) { return this.roles.update(id, b); }
  @Delete('roles/:id') @HttpCode(204) @Require('identity.role.write')
  async removeRole(@Param('id', ParseUUIDPipe) id: string) { await this.roles.remove(id); }
}
