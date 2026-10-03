import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Clock } from '@pf/shared-kernel';
import { ProviderError, type FxRateProvider } from '../../domain/index.js';

/** Versión del cliente en el User-Agent (genérico del producto; sin datos de la instalación ni del usuario). */
export const PROVIDER_CLIENT_VERSION = '0.1.0';
export const PROVIDER_USER_AGENT = `PFOS-fx/${PROVIDER_CLIENT_VERSION} (+https://github.com/manuXD270516/personal-finances)`;
/** Hosts permitidos en producción (design.md decisión 9): nunca se sigue una redirección a otro host. */
export const PROVIDER_HOSTS: readonly string[] = ['paralelo.bo', 'bo.dolarapi.com'];
/** Espera ante un 429 sin `Retry-After` (design.md decisión 9). */
export const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface TransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Transporte HTTP mínimo (inyectable en tests). Recibe SOLO la URL y cabeceras fijas: nunca contexto de workspace. */
export type HttpTransport = (
  url: URL,
  headers: Readonly<Record<string, string>>,
  timeoutMs: number,
) => Promise<TransportResponse>;

/** Transporte sobre node:http(s): GET sin cuerpo, sin cookies y con EXACTAMENTE las cabeceras dadas (+ Host). */
export const nodeTransport: HttpTransport = (url, headers, timeoutMs) =>
  new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, { method: 'GET', headers: { ...headers }, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy(new ProviderError('PROVIDER_PAYLOAD_INVALID', 'response body too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: flatHeaders(res.headers),
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () =>
      req.destroy(new ProviderError('PROVIDER_TIMEOUT', `no response within ${timeoutMs} ms`)),
    );
    req.on('error', reject);
    req.end();
  });

function flatHeaders(h: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (v !== undefined) out[k] = Array.isArray(v) ? v.join(', ') : v;
  return out;
}

export interface ProviderHttpClientOptions {
  readonly clock: Clock;
  /** `FX_PROVIDER_TIMEOUT` (ms, ≤ 30 s). */
  readonly timeoutMs: number;
  readonly transport?: HttpTransport;
  /** Hosts permitidos (por defecto `PROVIDER_HOSTS`; los tests agregan el servidor local). */
  readonly allowedHosts?: readonly string[];
}

export interface HttpTextResponse {
  readonly body: string;
  /** Instante en que se obtuvo la respuesta (el de la solicitud original si viene de la caché). */
  readonly fetchedAt: string;
  readonly fromCache: boolean;
}

interface CacheEntry {
  readonly body: string;
  readonly fetchedAt: string;
  readonly expiresAt: number;
}

/**
 * `ProviderHttpClient` (design.md decisiones 9 y 10; NFR-COMP-007, NFR-COMP-001): lecturas `GET` anónimas con
 * cabeceras fijas (`Accept`, `User-Agent` genérico), sin query string, cookies ni credenciales; límite por
 * provider (≤ `limitPerMinute` en cualquier ventana de 60 s), caché en memoria por URL que respeta `Cache-Control: max-age` (menos `Age`), espera
 * ante `429` hasta `Retry-After` (o 60 s), timeout y allowlist de hosts (sin redirecciones). Toda falla es un
 * `ProviderError`; nunca devuelve una tasa.
 */
export class ProviderHttpClient {
  private readonly transport: HttpTransport;
  private readonly allowed: ReadonlySet<string>;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly sent = new Map<FxRateProvider, number[]>();
  private readonly blockedUntil = new Map<FxRateProvider, number>();

  constructor(private readonly options: ProviderHttpClientOptions) {
    this.transport = options.transport ?? nodeTransport;
    this.allowed = new Set(options.allowedHosts ?? PROVIDER_HOSTS);
  }

  /** Bloqueo por `Retry-After` conocido (también el persistido en `fx.provider_run`, que el servicio restaura). */
  blockUntil(provider: FxRateProvider, untilIso: string): void {
    const until = Date.parse(untilIso);
    if (Number.isFinite(until))
      this.blockedUntil.set(provider, Math.max(until, this.blockedUntil.get(provider) ?? 0));
  }

  async getText(provider: FxRateProvider, rawUrl: string, limitPerMinute: number): Promise<HttpTextResponse> {
    const url = new URL(rawUrl);
    if (!this.allowed.has(url.hostname) || url.search !== '' || url.username !== '' || url.password !== '') {
      throw new ProviderError('PROVIDER_UNAVAILABLE', `host or URL not allowed: ${url.hostname}`);
    }
    const now = this.options.clock.now();
    const cached = this.cache.get(url.href);
    if (cached && cached.expiresAt > now.epochMillis) {
      return { body: cached.body, fetchedAt: cached.fetchedAt, fromCache: true };
    }
    const blocked = this.blockedUntil.get(provider);
    if (blocked !== undefined && blocked > now.epochMillis) {
      throw new ProviderError(
        'PROVIDER_RATE_LIMITED',
        'waiting for Retry-After',
        null,
        new Date(blocked).toISOString(),
      );
    }
    this.takeToken(provider, limitPerMinute, now.epochMillis);
    let res: TransportResponse;
    try {
      res = await this.transport(
        url,
        { accept: 'application/json', 'user-agent': PROVIDER_USER_AGENT },
        this.options.timeoutMs,
      );
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError('PROVIDER_UNAVAILABLE', `request failed: ${(err as Error).name}`);
    }
    const fetchedAt = this.options.clock.now();
    if (res.status === 429) {
      const until = fetchedAt.epochMillis + retryAfterMs(res.headers['retry-after'], fetchedAt.epochMillis);
      this.blockedUntil.set(provider, until);
      throw new ProviderError(
        'PROVIDER_RATE_LIMITED',
        'rate limited (429)',
        429,
        new Date(until).toISOString(),
      );
    }
    if (res.status < 200 || res.status >= 300) {
      // 3xx incluido: nunca se sigue una redirección (allowlist de hosts).
      throw new ProviderError('PROVIDER_UNAVAILABLE', `unexpected HTTP ${res.status}`, res.status);
    }
    const maxAge = maxAgeMs(res.headers['cache-control'], res.headers['age']);
    if (maxAge > 0) {
      this.cache.set(url.href, {
        body: res.body,
        fetchedAt: fetchedAt.toString(),
        expiresAt: fetchedAt.epochMillis + maxAge,
      });
    }
    return { body: res.body, fetchedAt: fetchedAt.toString(), fromCache: false };
  }

  /** Ventana deslizante de 60 s: nunca más de `limitPerMinute` solicitudes en cualquier minuto. */
  private takeToken(provider: FxRateProvider, limitPerMinute: number, nowMs: number): void {
    const limit = Math.max(1, limitPerMinute);
    const sent = (this.sent.get(provider) ?? []).filter((t) => t > nowMs - 60_000);
    if (sent.length >= limit) {
      this.sent.set(provider, sent);
      throw new ProviderError(
        'PROVIDER_RATE_LIMITED',
        `local limit of ${limit}/min reached`,
        null,
        new Date((sent[0] as number) + 60_000).toISOString(),
      );
    }
    sent.push(nowMs);
    this.sent.set(provider, sent);
  }
}

/** `Retry-After` en segundos o fecha HTTP; ausente o inválido ⇒ 60 s. */
export function retryAfterMs(header: string | undefined, nowMs: number): number {
  if (header === undefined || header.trim() === '') return DEFAULT_RETRY_AFTER_MS;
  const v = header.trim();
  if (/^\d+$/.test(v)) return Number.parseInt(v, 10) * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : DEFAULT_RETRY_AFTER_MS;
}

/** `max-age` − `Age` (ms); `no-store`/`no-cache`/sin `max-age` ⇒ 0 (sin caché). */
export function maxAgeMs(cacheControl: string | undefined, age: string | undefined): number {
  if (!cacheControl || /\b(no-store|no-cache)\b/i.test(cacheControl)) return 0;
  const m = /\bmax-age=(\d+)/i.exec(cacheControl);
  if (!m) return 0;
  const ageSeconds = age && /^\d+$/.test(age.trim()) ? Number.parseInt(age.trim(), 10) : 0;
  return Math.max(0, Number.parseInt(m[1] as string, 10) - ageSeconds) * 1000;
}
