/**
 * Cliente del BFF hacia finance-api (ADR-0019) con las convenciones de `platform/api-conventions`:
 * - `Idempotency-Key` UUIDv7 generada UNA vez por intento del usuario (cada llamada a `command`) y reutilizada en
 *   los reintentos técnicos (error de red, 503, 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`, 429): un reintento nunca
 *   duplica dinero (INV-027).
 * - `If-Match` con el ETag de la versión que el usuario está editando; `ETag` de cada respuesta expuesto.
 * - Errores RFC 9457 expuestos como `FinanceApiError` con el `problem` (la UI traduce por `code`).
 */

export interface ApiProblemBody {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly [extension: string]: unknown;
}

export class FinanceApiError extends Error {
  override readonly name = 'FinanceApiError';
  constructor(
    readonly status: number,
    readonly problem: ApiProblemBody,
  ) {
    super(`${status} ${problem.code ?? 'UNKNOWN'}`);
  }
}

export interface ApiResult<T> {
  readonly status: number;
  readonly data: T | undefined;
  /** `ETag` de la respuesta (versión del agregado), para el siguiente `If-Match`. */
  readonly etag: string | undefined;
  /** `true` si la API reprodujo una respuesta almacenada (`Idempotent-Replayed`). */
  readonly replayed: boolean;
}

export interface FinanceApiClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  /** Reintentos técnicos máximos por intento del usuario (por defecto 2). */
  readonly maxRetries?: number;
  /** Espera antes del reintento `n` (1..); por defecto respeta `Retry-After` o 200 ms × n. */
  readonly delay?: (ms: number) => Promise<void>;
  /** Generador de claves (tests); por defecto UUIDv7. */
  readonly newIdempotencyKey?: () => string;
  /** Cabeceras por petición (p. ej. `Authorization` con el access token de la sesión del BFF). */
  readonly headers?: () => Record<string, string>;
}

export interface CommandOptions {
  /** Versión (o ETag) del agregado que se modifica ⇒ `If-Match`. */
  readonly ifMatch?: number | string;
  /** Envía `Idempotency-Key` (POST financieros). Por defecto `true` en POST. */
  readonly idempotent?: boolean;
  readonly contentType?: string;
}

/** UUIDv7 (RFC 9562): 48 bits de milisegundos + aleatorio; ordenable y apto como clave de idempotencia. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ms = BigInt(now);
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const etagOf = (value: number | string): string => (typeof value === 'number' ? `"${value}"` : value);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createFinanceApiClient(options: FinanceApiClientOptions) {
  const doFetch = options.fetch ?? fetch;
  const maxRetries = options.maxRetries ?? 2;
  const delay = options.delay ?? sleep;
  const newKey = options.newIdempotencyKey ?? (() => uuidv7());

  async function send<T>(
    method: string,
    path: string,
    init: { body?: unknown; headers: Record<string, string> },
  ) {
    const res = await doFetch(`${options.baseUrl}${path}`, {
      method,
      headers: { accept: 'application/json', ...(options.headers?.() ?? {}), ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = res.status === 304 ? '' : await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    return { res, json: json as T | ApiProblemBody | undefined };
  }

  /** ¿Un reintento técnico con la MISMA clave puede tener éxito? */
  const retriable = (status: number, problem: ApiProblemBody | undefined) =>
    status === 503 ||
    status === 429 ||
    (status === 409 && problem?.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS');

  return {
    /** Lectura; con `etag` envía `If-None-Match` y un 304 devuelve `data: undefined`. */
    async get<T>(path: string, opts: { etag?: string } = {}): Promise<ApiResult<T>> {
      const { res, json } = await send<T>('GET', path, {
        headers: opts.etag ? { 'if-none-match': opts.etag } : {},
      });
      if (!res.ok && res.status !== 304)
        throw new FinanceApiError(res.status, (json ?? {}) as ApiProblemBody);
      return {
        status: res.status,
        data: res.status === 304 ? undefined : (json as T),
        etag: res.headers.get('etag') ?? opts.etag,
        replayed: false,
      };
    },

    /**
     * Un intento del usuario (p. ej. pulsar "Guardar"): una sola `Idempotency-Key` para todos sus reintentos
     * técnicos. Un nuevo intento (nueva llamada) genera otra clave.
     */
    async command<T>(
      method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      path: string,
      body: unknown,
      opts: CommandOptions = {},
    ): Promise<ApiResult<T>> {
      const headers: Record<string, string> = {};
      if (body !== undefined)
        headers['content-type'] =
          opts.contentType ?? (method === 'PATCH' ? 'application/merge-patch+json' : 'application/json');
      if (opts.idempotent ?? method === 'POST') headers['idempotency-key'] = newKey();
      if (opts.ifMatch !== undefined) headers['if-match'] = etagOf(opts.ifMatch);

      for (let attempt = 0; ; attempt += 1) {
        let outcome: Awaited<ReturnType<typeof send<T>>> | undefined;
        try {
          outcome = await send<T>(method, path, { body, headers });
        } catch (err) {
          // Error de red: la petición pudo o no llegar; reintentar con la misma clave es seguro.
          if (attempt >= maxRetries || !headers['idempotency-key']) throw err;
          await delay(200 * (attempt + 1));
          continue;
        }
        const { res, json } = outcome;
        if (res.ok) {
          return {
            status: res.status,
            data: json as T | undefined,
            etag: res.headers.get('etag') ?? undefined,
            replayed: res.headers.get('idempotent-replayed') === 'true',
          };
        }
        const problem = (json ?? {}) as ApiProblemBody;
        if (
          attempt < maxRetries &&
          retriable(res.status, problem) &&
          (headers['idempotency-key'] || res.status !== 409)
        ) {
          const retryAfter = Number(res.headers.get('retry-after'));
          await delay(
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 200 * (attempt + 1),
          );
          continue;
        }
        throw new FinanceApiError(res.status, problem);
      }
    },
  };
}

export type FinanceApiClient = ReturnType<typeof createFinanceApiClient>;
