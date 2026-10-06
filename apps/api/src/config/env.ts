import { z } from 'zod';

/** Variables de entorno validadas al arrancar. La app NO inicia si faltan o son inválidas. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_MIGRATE_URL: z.string().url().optional(),
  APP_DB_ROLE: z.string().default('retroburger_app'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().default(14),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  LOG_LEVEL: z.string().default('info'),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
  PUBLIC_RATE_LIMIT_MAX: z.coerce.number().default(30),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().default(10),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${msg}`);
  }
  return parsed.data;
}

/** Token de inyección de la configuración validada. */
export const ENV = Symbol('ENV');
