/** Limitador de ventana fija en memoria (login). En despliegue multi-instancia se reemplaza por Redis. */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(private readonly max: number, private readonly windowMs: number) {}

  /** Devuelve true si la petición excede el límite. */
  hit(key: string, now = Date.now()): boolean {
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
