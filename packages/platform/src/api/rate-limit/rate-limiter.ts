/** Cuota: `quota` peticiones en cualquier ventana de `windowSeconds` (docs/10 §10). */
export interface RateLimitPolicy {
  /** Nombre de la política en las cabeceras (`"reads"`, `"writes"`). */
  readonly name: string;
  readonly quota: number;
  readonly windowSeconds: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Peticiones restantes en la ventana actual tras esta petición (entero ≥ 0). */
  readonly remaining: number;
  /** Segundos hasta que la ventana libere toda la cuota. */
  readonly resetSeconds: number;
  /** Segundos a esperar antes de reintentar (solo si `allowed` es falso). */
  readonly retryAfterSeconds: number;
}

/** Puerto del límite de tasa. Adapter en memoria (una réplica, Phase 1); Valkey opcional (ADR-0008). */
export interface RateLimiter {
  consume(key: string, policy: RateLimitPolicy, now: Date): Promise<RateLimitDecision>;
}

/**
 * Ventana deslizante exacta (registro de instantes por clave): nunca más de `quota` peticiones aceptadas en
 * ningún intervalo de `windowSeconds`. Se eligió sobre el token bucket del design porque el bucket con recarga
 * continua acepta la petición 121 si la ráfaga dura unos segundos, y la spec exige 429 para 121 escrituras en
 * menos de un minuto. Una petición rechazada no consume cuota. Válido solo con una réplica de API.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly maxKeys = 100_000) {}

  async consume(key: string, policy: RateLimitPolicy, now: Date): Promise<RateLimitDecision> {
    const id = `${policy.name}\u0000${key}`;
    const t = now.getTime();
    const windowMs = policy.windowSeconds * 1000;
    const hits = (this.windows.get(id) ?? []).filter((at) => at > t - windowMs);

    const allowed = hits.length < policy.quota;
    if (allowed) hits.push(t);
    if (!this.windows.has(id) && this.windows.size >= this.maxKeys) this.evictIdle(t, windowMs);
    this.windows.set(id, hits);

    const oldest = hits[0] ?? t;
    const newest = hits.at(-1) ?? t;
    return {
      allowed,
      remaining: Math.max(0, policy.quota - hits.length),
      resetSeconds: Math.max(1, Math.ceil((newest + windowMs - t) / 1000)),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)),
    };
  }

  /** Acota memoria: descarta claves sin peticiones dentro de la ventana. */
  private evictIdle(now: number, windowMs: number): void {
    for (const [id, hits] of this.windows) {
      if ((hits.at(-1) ?? 0) <= now - windowMs) this.windows.delete(id);
    }
  }
}

/** Cabeceras IETF RateLimit (draft): `RateLimit-Policy: "writes";q=120;w=60` y `RateLimit: "writes";r=7;t=53`. */
export function rateLimitHeaders(
  policy: RateLimitPolicy,
  decision: RateLimitDecision,
): Record<string, string> {
  return {
    'ratelimit-policy': `"${policy.name}";q=${policy.quota};w=${policy.windowSeconds}`,
    ratelimit: `"${policy.name}";r=${decision.remaining};t=${decision.resetSeconds}`,
  };
}
