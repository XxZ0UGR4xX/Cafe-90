import pino, { type Logger } from 'pino';
import type { LoggerService } from '@nestjs/common';

export function createLogger(level = 'info', pretty = false): Logger {
  return pino({
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
        '*.password', '*.pin', '*.newPassword', '*.currentPassword', '*.token', '*.refreshToken'],
      censor: '[REDACTED]',
    },
    ...(pretty ? {} : {}),
  });
}

/** Adaptador para que los logs de Nest salgan en JSON por pino. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly l: Logger) {}
  log(m: unknown, ...p: unknown[]) { this.l.info({ ctx: p[0] }, String(m)); }
  error(m: unknown, ...p: unknown[]) { this.l.error({ ctx: p[p.length - 1], trace: p[0] }, String(m)); }
  warn(m: unknown, ...p: unknown[]) { this.l.warn({ ctx: p[0] }, String(m)); }
  debug(m: unknown, ...p: unknown[]) { this.l.debug({ ctx: p[0] }, String(m)); }
  verbose(m: unknown, ...p: unknown[]) { this.l.trace({ ctx: p[0] }, String(m)); }
}
