import { HttpException } from '@nestjs/common';
import type { Clock } from '@pf/shared-kernel';
import {
  ApiProblem,
  DependencyUnavailableError,
  renderProblem,
  type ApiContract,
  type CommandTransaction,
  type CursorCodec,
  type HttpResponseSnapshot,
  type IdempotencyPolicy,
  type RateLimitPolicy,
  type RateLimiter,
} from '../../api/index.js';
import { currentCorrelation } from '../../logging/index.js';
import type { ApiRequest, ApiResponse } from './request-context.js';

export const API_CONVENTIONS = Symbol.for('pf.platform.ApiConventions');

/** Dependencias de las convenciones de API (las arma el composition root). */
export interface ApiConventionsOptions {
  readonly contract: ApiContract;
  readonly clock: Clock;
  /** Base del `type` de Problem Details (`API_PROBLEM_TYPE_BASE`). */
  readonly problemTypeBase: string;
  readonly idempotency: {
    readonly policy: IdempotencyPolicy;
    /** Transacción del comando: efectos y respuesta idempotente se confirman juntos. */
    readonly transaction?: CommandTransaction;
  };
  readonly cursors: CursorCodec;
  readonly rateLimit?: {
    readonly limiter: RateLimiter;
    readonly reads: RateLimitPolicy;
    readonly writes: RateLimitPolicy;
  };
}

const REQUEST_ID_HEADER = 'x-request-id';

export function requestIdOf(res: ApiResponse): string {
  const fromRes = res.getHeader(REQUEST_ID_HEADER);
  return currentCorrelation()?.requestId ?? (typeof fromRes === 'string' ? fromRes : 'unknown');
}

/** Errores de Nest/Express (404 de ruta, body-parser…) a errores del catálogo. */
export function normalizeException(exception: unknown): unknown {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const detail = typeof exception.message === 'string' ? exception.message : undefined;
    switch (status) {
      case 404:
      case 405:
        return new ApiProblem('RESOURCE_NOT_FOUND', 'no resource matches the request');
      case 401:
        return new ApiProblem('UNAUTHENTICATED');
      case 403:
        return new ApiProblem('INSUFFICIENT_ROLE');
      case 429:
        return new ApiProblem('RATE_LIMITED');
      case 503:
        return new DependencyUnavailableError('service');
      default:
        return status >= 400 && status < 500 ? new ApiProblem('VALIDATION_FAILED', detail) : exception;
    }
  }
  // Errores de body-parser (JSON malformado, cuerpo demasiado grande, charset no soportado).
  if (typeof exception === 'object' && exception !== null) {
    const { type, status } = exception as { type?: unknown; status?: unknown };
    if (
      typeof type === 'string' &&
      type.startsWith('entity.') &&
      typeof status === 'number' &&
      status < 500
    ) {
      return new ApiProblem('VALIDATION_FAILED', 'request body could not be parsed');
    }
  }
  return exception;
}

export function renderException(
  exception: unknown,
  req: ApiRequest,
  res: ApiResponse,
  options: Pick<ApiConventionsOptions, 'problemTypeBase'>,
) {
  return renderProblem(normalizeException(exception), {
    requestId: requestIdOf(res),
    instance: (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '',
    problemTypeBase: options.problemTypeBase,
  });
}

/** Captura la respuesta en curso para almacenarla (estado, `Location`/`ETag`, cuerpo JSON). */
export function snapshotResponse(res: ApiResponse, body: unknown): HttpResponseSnapshot {
  const headers: Record<string, string> = {};
  for (const name of ['location', 'etag']) {
    const v = res.getHeader(name);
    if (v !== undefined) headers[name] = String(v);
  }
  return {
    status: res.statusCode,
    headers,
    body: body === undefined ? undefined : (JSON.parse(JSON.stringify(body)) as unknown),
  };
}

declare module 'node:http' {
  interface IncomingMessage {
    originalUrl?: string;
  }
}

/** Escribe una respuesta materializada (problem+json o almacenada) directamente en el `ServerResponse`. */
export function writeSnapshot(res: ApiResponse, snapshot: HttpResponseSnapshot): void {
  res.statusCode = snapshot.status;
  for (const [k, v] of Object.entries(snapshot.headers)) res.setHeader(k, v);
  res.end(snapshot.body === undefined ? undefined : JSON.stringify(snapshot.body));
}

/**
 * Manejadores finales de Express para lo que el router de Nest no cubre: Nest solo instala su 404 bajo el
 * prefijo global (`/api/v1`), así que `/api/v2/...` (versión no publicada) o cualquier otra ruta desconocida
 * llegaría al 404 HTML de Express. Se registran DESPUÉS de `app.init()`.
 */
export function problemFallbackHandlers(options: Pick<ApiConventionsOptions, 'problemTypeBase'>) {
  const notFound = (req: ApiRequest, res: ApiResponse): void =>
    writeSnapshot(
      res,
      renderException(
        new ApiProblem('RESOURCE_NOT_FOUND', 'no resource matches the request'),
        req,
        res,
        options,
      ).response,
    );
  const onError = (err: unknown, req: ApiRequest, res: ApiResponse, _next: (e?: unknown) => void): void => {
    if (res.headersSent) {
      res.end();
      return;
    }
    writeSnapshot(res, renderException(err, req, res, options).response);
  };
  return { notFound, onError };
}
