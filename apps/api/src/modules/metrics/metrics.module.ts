import { Controller, Get, Global, Headers, Inject, Module, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../../config/env';
import { Public } from '../identity/access.decorators';
import { MetricsService } from './metrics.service';

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/**
 * GET /metrics — protegido con METRICS_TOKEN (Bearer). Sin token configurado el endpoint NO existe (404).
 * En producción además el proxy lo bloquea hacia Internet: sólo Prometheus, por la red interna, lo consulta.
 */
@ApiExcludeController()
@Controller()
class MetricsController {
  constructor(private readonly metrics: MetricsService, @Inject(ENV) private readonly env: Env) {}
  @Public() @Get('metrics')
  async scrape(@Headers('authorization') auth?: string) {
    if (!this.env.METRICS_TOKEN) throw new NotFoundException();
    if (!auth || !safeEq(auth, `Bearer ${this.env.METRICS_TOKEN}`)) throw new UnauthorizedException();
    return this.metrics.render();
  }
}

@Global()
@Module({ controllers: [MetricsController], providers: [MetricsService], exports: [MetricsService] })
export class MetricsModule {}
