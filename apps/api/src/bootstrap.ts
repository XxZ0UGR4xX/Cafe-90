import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
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
  await app.register(fastifyRateLimit as any, { max: env.RATE_LIMIT_MAX, timeWindow: '1 minute' });

  if (env.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder()
      .setTitle('RetroBurger API').setVersion('0.1.0').addBearerAuth().build());
    SwaggerModule.setup('docs', app, cleanupOpenApiDoc(doc));
  }
  app.enableShutdownHooks();
  return app;
}
