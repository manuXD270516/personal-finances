import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

/**
 * Contexto ambiental de quién y desde dónde se ejecuta un comando (openspec add-audit-trail, design §1/§4): lo fija el
 * borde (middleware HTTP de la API, jobs y consumidores del worker) y lo leen los adapters que necesitan atribución
 * (auditoría, outbox) sin que cada caso de uso tenga que propagarlo. Nunca contiene tokens, cookies ni secretos.
 */
export type RequestOrigin = 'ui' | 'api' | 'import' | 'rule' | 'recurring' | 'system';

export type RequestActor =
  | { readonly type: 'USER'; readonly userId: string }
  | { readonly type: 'SYSTEM' | 'WORKER'; readonly process: string };

export interface RequestContext {
  actor?: RequestActor;
  origin?: RequestOrigin;
  /** User agent del cliente final (lo reenvía el BFF); truncado por quien lo persista. */
  userAgent?: string | null;
  /** IP del cliente final en claro: SOLO para calcular su HMAC; nunca se persiste ni se registra. */
  clientIp?: string | null;
  /** `Idempotency-Key` del comando, si la petición la trae. */
  idempotencyKey?: string | null;
  /** Evento o job que originó el trabajo (envelope v1 `causationId`). */
  causationId?: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Ejecuta `fn` con un contexto propio (copia: los cambios no se filtran al contexto exterior). */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run({ ...(storage.getStore() ?? {}), ...context }, fn);
}

export function currentRequestContext(): Readonly<RequestContext> | undefined {
  return storage.getStore();
}

/** Completa el contexto en curso (p. ej. el guard de identidad fija el actor tras validar el token). */
export function updateRequestContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identificador UUID estable para un id opaco (p. ej. un `X-Request-Id` entrante que no es UUID): si ya es un UUID se
 * devuelve en minúsculas; si no, un UUID versión 8 derivado de SHA-256 del valor (mismo valor ⇒ mismo UUID).
 */
export function uuidFromOpaqueId(value: string): string {
  if (UUID.test(value)) return value.toLowerCase();
  const h = createHash('sha256').update(value, 'utf8').digest();
  h[6] = (h[6]! & 0x0f) | 0x80;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
