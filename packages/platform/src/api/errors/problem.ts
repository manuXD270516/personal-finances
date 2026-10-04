import { isDomainError, type FieldViolation } from '@pf/shared-kernel';
import { ErrorCatalog, isErrorCode, type ErrorCode } from './error-catalog.js';

/** Elemento de `errors[]` (`components.schemas.FieldError`). `in` distingue parámetros de campos del cuerpo. */
export interface ProblemField {
  readonly pointer: string;
  readonly code: string;
  readonly detail?: string;
  readonly in?: 'body' | 'query' | 'header' | 'path';
}

/** Cuerpo RFC 9457 con las extensiones PFOS (`components.schemas.Problem`). */
export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly detail?: string;
  readonly instance?: string;
  readonly errors?: readonly ProblemField[];
  readonly [extension: string]: unknown;
}

/** Respuesta HTTP materializada (la misma forma que se almacena para reproducir una clave de idempotencia). */
export interface HttpResponseSnapshot {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * Error HTTP con `code` del catálogo. Lo lanzan los mecanismos de plataforma (validación, idempotencia,
 * precondiciones, cursores, límite de tasa) y la capa interface; el dominio lanza `DomainError`.
 */
export class ApiProblem extends Error {
  override readonly name = 'ApiProblem';
  readonly status: number;
  readonly fields: readonly ProblemField[];
  readonly headers: Readonly<Record<string, string>>;
  readonly extensions: Readonly<Record<string, unknown>>;

  constructor(
    readonly code: ErrorCode,
    detail?: string,
    options: {
      readonly fields?: readonly ProblemField[];
      readonly headers?: Readonly<Record<string, string>>;
      readonly extensions?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    } = {},
  ) {
    super(
      detail ?? ErrorCatalog.title(code),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.status = ErrorCatalog.status(code);
    this.fields = options.fields ?? [];
    this.headers = options.headers ?? {};
    this.extensions = options.extensions ?? {};
  }
}

/** 412 con `currentVersion` (docs/10 §6). */
export const preconditionFailed = (currentVersion: number): ApiProblem =>
  new ApiProblem('PRECONDITION_FAILED', `current version is ${currentVersion}`, {
    extensions: { currentVersion },
  });

/** 409 por carrera entre el chequeo de versión y el UPDATE (0 filas afectadas). */
export const concurrencyConflict = (currentVersion?: number): ApiProblem =>
  new ApiProblem('CONCURRENCY_CONFLICT', 'the resource changed while the operation was running', {
    extensions: currentVersion === undefined ? {} : { currentVersion },
  });

/** Una dependencia (p. ej. PostgreSQL) no está disponible: 503 con `Retry-After`, nunca se almacena. */
export class DependencyUnavailableError extends Error {
  override readonly name = 'DependencyUnavailableError';
  constructor(
    readonly dependency: string,
    options: { readonly cause?: unknown; readonly retryAfterSeconds?: number } = {},
  ) {
    super(`${dependency} unavailable`, options.cause === undefined ? undefined : { cause: options.cause });
    this.retryAfterSeconds = options.retryAfterSeconds ?? 1;
  }
  readonly retryAfterSeconds: number;
}

/** Códigos de error de conexión de Node y SQLSTATE de PostgreSQL que indican base de datos no disponible. */
const UNAVAILABLE_ERRNO = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);
const UNAVAILABLE_SQLSTATE = /^(08...|57P01|57P02|57P03|53300)$/;

/** ¿El error indica una dependencia caída (→ 503) en vez de un bug (→ 500)? */
export function isDependencyUnavailable(err: unknown): boolean {
  if (err instanceof DependencyUnavailableError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && (UNAVAILABLE_ERRNO.has(code) || UNAVAILABLE_SQLSTATE.test(code)))
    return true;
  const message = (err as { message?: unknown }).message;
  if (
    typeof message === 'string' &&
    /timeout exceeded when trying to connect|Connection terminated/i.test(message)
  ) {
    return true;
  }
  const cause = (err as { cause?: unknown }).cause;
  return cause !== undefined && cause !== err && isDependencyUnavailable(cause);
}

export interface RenderContext {
  readonly requestId: string;
  /** `instance` (ruta de la petición, sin query). */
  readonly instance?: string;
  readonly problemTypeBase?: string;
}

export interface RenderedProblem {
  readonly response: HttpResponseSnapshot;
  /** `true` si el error no era esperado (500): se registra con nivel `error` y stack (solo en logs). */
  readonly unexpected: boolean;
}

const violationsToFields = (violations: readonly FieldViolation[]): ProblemField[] =>
  violations.map((v) => ({
    pointer: v.pointer,
    code: v.code,
    ...(v.detail === undefined ? {} : { detail: v.detail }),
  }));

/**
 * Convierte cualquier error en una respuesta `application/problem+json` (RFC 9457). Nunca incluye stack traces,
 * SQL, nombres de tablas ni mensajes de errores inesperados: esos detalles van solo al log.
 */
export function renderProblem(err: unknown, ctx: RenderContext): RenderedProblem {
  let code: ErrorCode;
  let detail: string | undefined;
  let fields: readonly ProblemField[] = [];
  let headers: Record<string, string> = {};
  let extensions: Readonly<Record<string, unknown>> = {};
  let unexpected = false;

  if (err instanceof ApiProblem) {
    code = err.code;
    detail = err.message;
    fields = err.fields;
    headers = { ...err.headers };
    extensions = err.extensions;
  } else if (isDomainError(err) && isErrorCode(err.code)) {
    code = err.code;
    detail = err.message;
    fields = violationsToFields(err.violations);
    // Única extensión que el dominio publica (docs/10 §6): la versión vigente en 412/409.
    const currentVersion = err.details['currentVersion'];
    if (Number.isInteger(currentVersion)) extensions = { currentVersion };
  } else if (isDependencyUnavailable(err)) {
    code = 'SERVICE_UNAVAILABLE';
    detail = 'a dependency is temporarily unavailable; retry later';
    const retry = err instanceof DependencyUnavailableError ? err.retryAfterSeconds : 1;
    headers = { 'retry-after': String(retry) };
  } else {
    // Incluye DomainError con un code fuera del catálogo: es un bug, no un error de cliente.
    code = 'INTERNAL_ERROR';
    detail = 'an unexpected error occurred; use requestId to report it';
    unexpected = true;
  }

  const status = ErrorCatalog.status(code);
  const body: ProblemBody = {
    ...extensions,
    type: ErrorCatalog.typeUri(code, ctx.problemTypeBase),
    title: ErrorCatalog.title(code),
    status,
    code,
    ...(detail === undefined ? {} : { detail }),
    ...(ctx.instance === undefined ? {} : { instance: ctx.instance }),
    requestId: ctx.requestId,
    ...(fields.length > 0 ? { errors: fields } : {}),
  };
  return {
    response: { status, headers: { ...headers, 'content-type': PROBLEM_CONTENT_TYPE }, body },
    unexpected,
  };
}
