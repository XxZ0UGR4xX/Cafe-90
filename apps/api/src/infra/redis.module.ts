import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';

export const REDIS = Symbol('REDIS');
export type RedisClient = Redis | null;

/** Redis es OPCIONAL: sin REDIS_URL todo funciona en memoria (una sola instancia). Con REDIS_URL se comparte entre réplicas de la API. */
export function connectRedis(url: string): Redis {
  const r = new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 5000, retryStrategy: (n) => Math.min(n * 200, 3000) });
  r.on('error', () => undefined);   // los errores se manejan en cada uso (fail-open) y /ready informa el estado
  return r;
}

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}
  async onApplicationShutdown() { if (this.redis) await this.redis.quit().catch(() => undefined); }
}

@Global()
@Module({
  providers: [{ provide: REDIS, inject: [ENV], useFactory: (env: Env): RedisClient => (env.REDIS_URL ? connectRedis(env.REDIS_URL) : null) }, RedisLifecycle],
  exports: [REDIS],
})
export class RedisModule {}
