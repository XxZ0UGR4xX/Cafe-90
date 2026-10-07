import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { AppModule } from './app.module';
import { createLogger, PinoNestLogger } from './common/logger';
import { requestContext } from './common/request-context';
import { loadEnv } from './config/env';
import { MetricsService } from './modules/metrics/metrics.service';
import { REDIS, type RedisClient } from './infra/redis.module';

export async function createApp(): Promise<NestFastifyApplication> {
  const env = loadEnv();
  const logger = createLogger(env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL);
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    genReqId: (req: { headers: Record<string, unknown> }) => (req.headers['x-request-id'] as string) || randomUUID(),
    trustProxy: true,
    disableRequestLogging: true,
    bodyLimit: 1_048_576,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: env.NODE_ENV === 'test' ? false : new PinoNestLogger(logger),
  });

  const fastify = app.getHttpAdapter().getInstance();
  // Contexto por request (ALS): requestId / IP / user-agent disponibles para auditoría y logs.
  fastify.addHook('onRequest', (req, _reply, done) => {
    requestContext.run({ requestId: req.id as string, ip: req.ip, userAgent: req.headers['user-agent'] }, done);
  });
  const metrics = app.get(MetricsService);
  fastify.addHook('onResponse', (req, reply, done) => {
    if (!req.url.startsWith('/metrics')) metrics.observeRequest(req.method, req.routeOptions?.url, reply.statusCode, reply.elapsedTime / 1000);
    req.log.info({ requestId: req.id, method: req.method, url: req.url.split('?')[0], status: reply.statusCode,
      ms: Math.round(reply.elapsedTime) }, 'request');
    done();
  });

  await app.register(fastifyHelmet as any, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(fastifyCors as any, {
    origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
    exposedHeaders: ['content-disposition'],   // nombre del archivo en descargas (XML de CFDI)
    allowedHeaders: ['content-type', 'authorization', 'x-requested-with', 'x-branch-id', 'idempotency-key', 'x-request-id'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(fastifyCookie as any);
  // Con Redis el límite global se comparte entre réplicas; si Redis cae, no se bloquea el tráfico (skipOnError)
  const redis = app.get<RedisClient>(REDIS);
  await app.register(fastifyRateLimit as any, {
    timeWindow: '1 minute',
    // Sesiones autenticadas: un cubo por token (el restaurante entero comparte una IP pública: limitar por IP bloquearía las tablets entre sí).
    keyGenerator: (req: { ip: string; headers: Record<string, unknown> }) => { const a = String(req.headers.authorization ?? ''); return a.startsWith('Bearer ') ? `t:${createHash('sha256').update(a).digest('hex').slice(0, 24)}` : `ip:${req.ip}`; },
    max: (_req: unknown, key: string) => (key.startsWith('t:') ? env.RATE_LIMIT_AUTH_MAX : env.RATE_LIMIT_MAX),
    ...(redis ? { redis, nameSpace: 'rl:global:', skipOnError: true } : {}) });

  if (env.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder()
      .setTitle('RetroBurger API').setVersion('0.1.0').addBearerAuth().build());
    SwaggerModule.setup('docs', app, cleanupOpenApiDoc(doc));
  }
  app.enableShutdownHooks();
  return app;
}
