import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
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
    } else if (err instanceof HttpException) {
      status = err.getStatus(); retryable = false;
      code = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN'
        : status === 429 ? 'RATE_LIMITED' : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL';
      message = errorMessage(code);
    } else if (typeof err === 'object' && err && 'code' in err && typeof (err as any).code === 'string') {
      const pg = err as { code: string; constraint?: string };
      if (pg.code === '23505') { status = 409; code = 'CONFLICT'; retryable = false; message = errorMessage(code); details = { constraint: pg.constraint }; }
      else if (pg.code === '23503' || pg.code === '23514' || pg.code === '55000') {
        status = 409; code = 'CONFLICT'; retryable = false; message = errorMessage(code);
      } else if (pg.code === '40001' || pg.code === '40P01') { status = 503; code = 'INTERNAL'; retryable = true; }
    }

    if (status >= 500) req.log.error({ err, requestId }, 'unhandled error');
    else if (status === 401 || status === 403) req.log.warn({ code, requestId, url: req.url }, 'access denied');

    void reply.status(status).send({ code, message, details, requestId, retryable });
  }
}
