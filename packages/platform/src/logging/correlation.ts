import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

/**
 * Contexto de correlación (docs/18 §3.3). `correlationId` es compartido por todas las líneas de log de una
 * petición y de los jobs que esta dispara; `requestId` solo existe dentro de la petición HTTP.
 */
export interface CorrelationContext {
  readonly correlationId: string;
  readonly requestId?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export function runWithCorrelation<T>(context: CorrelationContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentCorrelation(): CorrelationContext | undefined {
  return storage.getStore();
}

/** UUIDv7 (RFC 9562): ordenable por tiempo, como recomienda docs/18 §3.3 para `X-Request-Id`. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Acepta un `X-Request-Id` entrante solo si es un identificador opaco razonable; cualquier otro valor se
 * descarta (evita inyección en logs y que el header se use para colar datos).
 */
export function acceptRequestId(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate) ? candidate : undefined;
}
