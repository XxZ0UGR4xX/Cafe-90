import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BranchDto, BranchPatchDto, SettingDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { BranchesService } from './branches.service';
import { SettingsService } from './settings.service';

class BranchBody extends createZodDto(BranchDto) {}
class BranchPatchBody extends createZodDto(BranchPatchDto) {}
class SettingBody extends createZodDto(SettingDto) {}
class SettingsQuery extends createZodDto(z.object({ branchId: z.string().uuid().optional() })) {}

@ApiTags('tenancy')
@Controller()
export class TenancyController {
  constructor(private readonly branches: BranchesService, private readonly settings: SettingsService) {}

  @Get('branches') @Require('tenancy.branch.read') list() { return this.branches.list(); }
  @Get('branches/:branchId') @Require('tenancy.branch.read')
  get(@Param('branchId', ParseUUIDPipe) id: string) { return this.branches.get(id); }
  @Post('branches') @Require('tenancy.branch.write') create(@Body() b: BranchBody) { return this.branches.create(b); }
  @Patch('branches/:branchId') @Require('tenancy.branch.write')
  update(@Param('branchId', ParseUUIDPipe) id: string, @Body() b: BranchPatchBody) { return this.branches.update(id, b); }
  @Delete('branches/:branchId') @HttpCode(204) @Require('tenancy.branch.write')
  async remove(@Param('branchId', ParseUUIDPipe) id: string) { await this.branches.remove(id); }

  @Get('settings') @Require('tenancy.settings.read')
  getSettings(@Query() q: SettingsQuery) { return this.settings.effective(q.branchId); }
  @Put('settings') @Require('tenancy.settings.write')
  putSetting(@Body() b: SettingBody) { return this.settings.set(b.key, b.value, b.branchId); }
}
