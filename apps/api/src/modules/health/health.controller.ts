import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DbService } from '../../database/db.service';
import { Public } from '../identity/access.decorators';

@ApiTags('system')
@Controller()
export class HealthController {
  constructor(private readonly db: DbService) {}
  @Public() @Get('health') health() { return { status: 'ok' }; }
  @Public() @Get('ready') async ready() { await this.db.system('SELECT 1'); return { status: 'ready' }; }
}
