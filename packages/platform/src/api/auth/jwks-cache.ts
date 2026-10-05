import {
  createLocalJWKSet,
  errors as joseErrors,
  type FlattenedJWSInput,
  type JSONWebKeySet,
  type CompactJWSHeaderParameters,
  type JWTVerifyGetKey,
} from 'jose';

/**
 * JWKS remoto con caché, refetch limitado y fallback al último JWKS conocido (add-workspace-identity design §3,
 * gap de SPIKE-06: `createRemoteJWKSet` de `jose` no lo trae).
 *
 * - Caché de `cacheMaxAgeMs` (10 min): pasado ese plazo se vuelve a pedir el JWKS.
 * - `kid` desconocido ⇒ refetch, como mucho uno cada `cooldownMs` (también tras un fallo: no se martilla al IdP).
 * - Si el IdP no responde (error de red, timeout, HTTP ≠ 2xx o JWKS inválido) se siguen usando las claves del último
 *   JWKS obtenido con éxito mientras su antigüedad no supere `fallbackMaxAgeMs` (24 h), con log `warn` y la métrica
 *   `pf.auth.jwks_fallback`. Pasado ese plazo, o sin ningún JWKS previo, la verificación falla (⇒ 401).
 */
export interface JwksCacheOptions {
  readonly url: URL;
  readonly cacheMaxAgeMs?: number;
  readonly cooldownMs?: number;
  readonly fallbackMaxAgeMs?: number;
  /** Timeout de cada petición al JWKS (por defecto 5 s). */
  readonly timeoutMs?: number;
  /** Obtención del JWKS (por defecto `fetch`); inyectable en tests. */
  readonly fetchJwks?: (url: URL, timeoutMs: number) => Promise<unknown>;
  readonly now?: () => number;
  readonly observer?: JwksObserver;
}

/** Observabilidad del JWKS (logs y métricas los conecta el composition root). */
export interface JwksObserver {
  /** El IdP no respondió; `fallbackAgeMs` es la antigüedad del JWKS que se sigue usando (`null` si no hay ninguno o expiró). */
  refreshFailed?(info: { readonly error: string; readonly fallbackAgeMs: number | null }): void;
  /** Se verificó un token con el JWKS de respaldo (IdP caído). */
  fallbackUsed?(info: { readonly ageMs: number }): void;
  /** JWKS renovado con éxito. */
  refreshed?(info: { readonly keys: number }): void;
}

export const JWKS_METRICS = {
  fallback: 'pf.auth.jwks_fallback',
  refreshFailures: 'pf.auth.jwks_refresh_failures',
} as const;

const DEFAULTS = {
  cacheMaxAgeMs: 10 * 60_000,
  cooldownMs: 30_000,
  fallbackMaxAgeMs: 24 * 3_600_000,
  timeoutMs: 5_000,
} as const;

async function defaultFetch(url: URL, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
  return res.json();
}

function isJwks(value: unknown): value is JSONWebKeySet {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { keys?: unknown }).keys) &&
    (value as { keys: unknown[] }).keys.every((k) => typeof k === 'object' && k !== null)
  );
}

interface Snapshot {
  readonly fetchedAt: number;
  readonly keys: number;
  readonly getKey: JWTVerifyGetKey;
}

export class JwksCache {
  private snapshot: Snapshot | undefined;
  private lastAttemptAt: number | undefined;
  private inFlight: Promise<boolean> | undefined;
  private readonly now: () => number;

  constructor(private readonly options: JwksCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Función de claves para `jwtVerify`. */
  readonly getKey: JWTVerifyGetKey = async (header, token) => this.resolve(header, token);

  private get cfg() {
    const o = this.options;
    return {
      cacheMaxAgeMs: o.cacheMaxAgeMs ?? DEFAULTS.cacheMaxAgeMs,
      cooldownMs: o.cooldownMs ?? DEFAULTS.cooldownMs,
      fallbackMaxAgeMs: o.fallbackMaxAgeMs ?? DEFAULTS.fallbackMaxAgeMs,
      timeoutMs: o.timeoutMs ?? DEFAULTS.timeoutMs,
    };
  }

  private async resolve(header: CompactJWSHeaderParameters, token: FlattenedJWSInput) {
    const { cacheMaxAgeMs, fallbackMaxAgeMs } = this.cfg;
    let fresh = this.snapshot !== undefined && this.now() - this.snapshot.fetchedAt <= cacheMaxAgeMs;
    if (!fresh) fresh = await this.refresh(false);
    const snap = this.snapshot;
    if (!snap) throw new joseErrors.JWKSInvalid('JWKS unavailable');
    const age = this.now() - snap.fetchedAt;
    if (!fresh) {
      if (age > fallbackMaxAgeMs) throw new joseErrors.JWKSInvalid('JWKS fallback expired');
      this.options.observer?.fallbackUsed?.({ ageMs: age });
    }
    try {
      return await snap.getKey(header, token);
    } catch (err) {
      // `kid` desconocido (rotación de claves): un refetch limitado por el cooldown y un reintento.
      if (!(err instanceof joseErrors.JWKSNoMatchingKey) || !fresh) throw err;
      if (!(await this.refresh(true)) || this.snapshot === snap) throw err;
      return this.snapshot!.getKey(header, token);
    }
  }

  /** Pide el JWKS (single-flight). Devuelve `true` si el snapshot vigente es de esta obtención o aún fresco. */
  private async refresh(unknownKid: boolean): Promise<boolean> {
    const { cooldownMs } = this.cfg;
    if (this.inFlight) return this.inFlight;
    const now = this.now();
    if (this.lastAttemptAt !== undefined && now - this.lastAttemptAt < cooldownMs) {
      // Dentro del cooldown: sin nueva petición. Fresco solo si el snapshot vigente lo es.
      return (
        !unknownKid && this.snapshot !== undefined && now - this.snapshot.fetchedAt <= this.cfg.cacheMaxAgeMs
      );
    }
    this.lastAttemptAt = now;
    this.inFlight = this.fetchSnapshot().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async fetchSnapshot(): Promise<boolean> {
    const { timeoutMs, fallbackMaxAgeMs } = this.cfg;
    try {
      const body = await (this.options.fetchJwks ?? defaultFetch)(this.options.url, timeoutMs);
      if (!isJwks(body)) throw new Error('JWKS response is not a JSON Web Key Set');
      const getKey = createLocalJWKSet(body);
      this.snapshot = { fetchedAt: this.now(), keys: body.keys.length, getKey };
      this.options.observer?.refreshed?.({ keys: body.keys.length });
      return true;
    } catch (err) {
      const age = this.snapshot ? this.now() - this.snapshot.fetchedAt : null;
      this.options.observer?.refreshFailed?.({
        error: err instanceof Error ? err.message : String(err),
        fallbackAgeMs: age !== null && age <= fallbackMaxAgeMs ? age : null,
      });
      return false;
    }
  }
}
