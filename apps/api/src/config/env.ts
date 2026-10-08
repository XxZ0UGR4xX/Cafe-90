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
  /** Límite global por minuto para peticiones SIN sesión (por IP). */
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  /** Límite por minuto para cada sesión autenticada (por token): varias tablets tras la misma IP del restaurante no se bloquean entre sí. */
  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(1200),
  JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
  PUBLIC_RATE_LIMIT_MAX: z.coerce.number().default(30),
  /** Consultas públicas sensibles por IP/minuto (puntos de lealtad, búsqueda y descarga de facturas). */
  PUBLIC_SENSITIVE_RATE_LIMIT_MAX: z.coerce.number().default(10),
  /** Lecturas públicas (menú, estado de pedido, mesa QR) por IP/minuto. */
  PUBLIC_READ_RATE_LIMIT_MAX: z.coerce.number().default(300),
  /** Proxies de confianza para X-Forwarded-For: lista de IP/CIDR o palabras clave (loopback, linklocal, uniquelocal). Por defecto, redes privadas (Caddy/nginx en la red de Docker). `false` = IP del socket. */
  TRUST_PROXY: z.string().default('loopback,linklocal,uniquelocal').transform((v) => (v === 'false' ? false : v === 'true' ? true : v)),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().default(10),
  /** Intentos de login (cualquier cuenta) por IP+tenant y minuto. */
  LOGIN_IP_RATE_LIMIT_MAX: z.coerce.number().default(40),
  /** Clave para cifrar secretos TOTP en reposo. Obligatoria en producción. */
  MFA_ENCRYPTION_KEY: z.string().min(32, 'MFA_ENCRYPTION_KEY debe tener al menos 32 caracteres').optional(),
  /** Si es 'true', SUPER_ADMIN/ADMIN deben enrolar 2FA para poder iniciar sesión. */
  MFA_ENFORCE: z.enum(['true', 'false']).default('false'),
  MFA_ISSUER: z.string().default('Amerix Burger'),
  /** Proveedor de timbrado CFDI. 'sandbox' = simulado (sin validez fiscal). Por defecto: sandbox en desarrollo/pruebas, none en producción. */
  FISCAL_PROVIDER: z.enum(['sandbox', 'none']).optional(),
  /** Correo saliente. Sin SMTP_URL los correos sólo se registran en el log (desarrollo/pruebas). Ej.: smtps://usuario:clave@smtp.proveedor.com:465 */
  SMTP_URL: z.string().url().optional(),
  MAIL_FROM: z.string().default('Amerix Burger <no-reply@retroburger.test>'),
  /** Redis (opcional): rate-limit y WebSocket compartidos entre réplicas de la API. Ej.: redis://redis:6379 */
  REDIS_URL: z.string().url().optional(),
  /** Token para GET /metrics (Prometheus). Sin él, el endpoint no existe. */
  METRICS_TOKEN: z.string().min(16, 'METRICS_TOKEN debe tener al menos 16 caracteres').optional(),
  /** URL pública del sitio de clientes (se imprime en el ticket para autofacturación). */
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5174'),
}).superRefine((v, ctx) => {
  if (v.NODE_ENV === 'production' && !v.MFA_ENCRYPTION_KEY)
    ctx.addIssue({ code: 'custom', path: ['MFA_ENCRYPTION_KEY'], message: 'es obligatoria en producción' });
  if (v.NODE_ENV === 'production' && v.COOKIE_SECURE !== 'true')
    ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'debe ser true en producción (la cookie de sesión solo viaja por HTTPS)' });
  if (v.NODE_ENV === 'production' && v.CORS_ORIGINS.split(',').some((o) => /localhost|127\.0\.0\.1/.test(o)))
    ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'no puede apuntar a localhost en producción' });
  if (v.NODE_ENV === 'production' && /^(.)\1+$/.test(v.JWT_ACCESS_SECRET))
    ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'secreto trivial' });
  if (v.NODE_ENV === 'production' && v.FISCAL_PROVIDER === 'sandbox')
    ctx.addIssue({ code: 'custom', path: ['FISCAL_PROVIDER'], message: "'sandbox' emite comprobantes SIN validez fiscal: no se permite en producción" });
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Docker Compose pasa variables vacías (SMTP_URL=) cuando no se configuran: equivalen a «no definida»
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${msg}`);
  }
  return parsed.data;
}

/** Token de inyección de la configuración validada. */
export const ENV = Symbol('ENV');
