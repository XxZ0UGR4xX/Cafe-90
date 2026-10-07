import type Redis from 'ioredis';

/** Limitador de ventana fija. En memoria (1 instancia) o en Redis (compartido entre réplicas). */
export interface RateLimiter {
  /** Devuelve true si la petición excede el límite. */
  hit(key: string, now?: number): Promise<boolean>;
  clear(): void;
}

export class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(private readonly max: number, private readonly windowMs: number) {}

  async hit(key: string, now = Date.now()): Promise<boolean> {
    const e = this.hits.get(key);
    if (!e || e.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      if (this.hits.size > 10_000) this.gc(now);
      return false;
    }
    e.count++;
    return e.count > this.max;
  }
  private gc(now: number) { for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k); }
  clear() { this.hits.clear(); }
}

// INCR + expiración en la PRIMERA petición de la ventana, de forma atómica (sin condiciones de carrera entre réplicas)
const SCRIPT = `local c = redis.call('INCR', KEYS[1]); if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end; return c`;

/**
 * Ventana fija en Redis. Si Redis no responde se DEJA PASAR (fail-open): una caída de Redis no debe tumbar el login/POS;
 * la protección por cuenta (bloqueo tras 5 intentos) vive en PostgreSQL y sigue activa.
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis, private readonly max: number, private readonly windowMs: number, private readonly prefix: string,
    private readonly onError: (e: Error) => void = () => undefined) {}

  async hit(key: string): Promise<boolean> {
    try {
      const n = (await this.redis.eval(SCRIPT, 1, `rl:${this.prefix}:${key}`, String(this.windowMs))) as number;
      return n > this.max;
    } catch (e) { this.onError(e as Error); return false; }
  }
  clear() { /* las claves expiran solas */ }
}

export const createRateLimiter = (redis: Redis | null, max: number, windowMs: number, prefix: string, onError?: (e: Error) => void): RateLimiter =>
  redis ? new RedisRateLimiter(redis, max, windowMs, prefix, onError) : new MemoryRateLimiter(max, windowMs);
