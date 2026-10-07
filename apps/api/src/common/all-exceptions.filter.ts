import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ZodValidationException } from 'nestjs-zod';
import { errorMessage } from '@retroburger/shared';
import { AppError } from './errors';

/**
 * Convierte cualquier error en una respuesta comprensible: `{ code, message, details?, requestId, retryable }`.
 * Nunca expone stack traces ni "500 Internal Server Error" al usuario.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const req = http.getRequest<FastifyRequest>();
    const requestId = req.id as string;

    let status = 500; let code = 'INTERNAL'; let message = errorMessage('INTERNAL'); let details: unknown; let retryable = true;

    if (err instanceof AppError) {
      ({ status, code, details, retryable } = err); message = err.message;
    } else if (err instanceof ZodValidationException) {
      status = 400; code = 'VALIDATION_ERROR'; message = errorMessage(code); retryable = false;
      details = (err.getZodError() as any).issues?.map((i: any) => ({ path: i.path.join('.'), message: i.message }));
    } else if (err instanceof ZodError) {   // `schema.parse` dentro de un handler (p. ej. parámetros de ruta)
      status = 400; code = 'VALIDATION_ERROR'; message = errorMessage(code); retryable = false;
      details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if (err instanceof HttpException) {
      status = err.getStatus(); retryable = false;
      code = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN'
        : status === 429 ? 'RATE_LIMITED' : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL';
      message = errorMessage(code);
    } else if (typeof err === 'object' && err && typeof (err as any).statusCode === 'number' && (err as any).statusCode >= 400 && (err as any).statusCode < 500) {
      // Errores 4xx de plugins de Fastify (rate-limit 429, cuerpo demasiado grande 413, JSON inválido 400…): conservan su estado
      status = (err as any).statusCode; retryable = status === 429 || status === 408;
      code = status === 429 ? 'RATE_LIMITED' : status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'VALIDATION_ERROR';
      message = errorMessage(code);
    } else if (typeof err === 'object' && err && 'code' in err && typeof (err as any).code === 'string') {
      const pg = err as { code: string; constraint?: string };
      if (pg.code === '23505') { status = 409; code = 'CONFLICT'; retryable = false; message = errorMessage(code); }   // sin nombre de constraint: no revela esquema ni confirma datos
      else if (['22021', '22P05', '22P02', '22001', '22003', '22007', '22008'].includes(pg.code)) {   // texto con \0, uuid/fecha/número inválido, valor fuera de rango
        status = 400; code = 'VALIDATION_ERROR'; retryable = false; message = errorMessage(code);
      }
      else if (pg.code === '23503' || pg.code === '23514' || pg.code === '55000') {
        status = 409; code = 'CONFLICT'; retryable = false; message = errorMessage(code);
      } else if (pg.code === '40001' || pg.code === '40P01') { status = 503; code = 'INTERNAL'; retryable = true; }
    }

    if (status >= 500) req.log.error({ err, requestId }, 'unhandled error');
    else if (status === 401 || status === 403) req.log.warn({ code, requestId, url: req.url }, 'access denied');

    // Rutas que declaran otro Content-Type (ticket .txt, XML) no pueden serializar el error como texto/XML
    void reply.status(status).header('content-type', 'application/json; charset=utf-8').send({ code, message, details, requestId, retryable });
  }
}
