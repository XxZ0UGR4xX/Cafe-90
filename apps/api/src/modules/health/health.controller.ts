import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { REDIS, type RedisClient } from '../../infra/redis.module';
import { ApiTags } from '@nestjs/swagger';
import { DbService } from '../../database/db.service';
import { Public } from '../identity/access.decorators';

@ApiTags('system')
@Controller()
export class HealthController {
  constructor(private readonly db: DbService, @Inject(REDIS) private readonly redis: RedisClient) {}
  @Public() @Get('health') health() { return { status: 'ok' }; }
  /** Lista = BD responde. Redis es opcional y degrada (rate-limit/WS por instancia) sin tumbar el servicio: se informa pero no falla. */
  @Public() @Get('ready') async ready() {
    try { await this.db.system('SELECT 1'); } catch { throw new ServiceUnavailableException(); }
    const redis = this.redis ? ((await this.redis.ping().then(() => 'up').catch(() => 'down')) as 'up' | 'down') : 'off';
    return { status: 'ready', redis };
  }
}
