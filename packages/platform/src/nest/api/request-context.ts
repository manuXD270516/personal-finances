import type { IncomingMessage, ServerResponse } from 'node:http';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import {
  updateRequestContext,
  type ContractOperation,
  type HttpResponseSnapshot,
  type ValidatedRequest,
} from '../../api/index.js';

/** Usuario autenticado del request. Lo fija el guard de autenticación (`add-workspace-identity`). */
export interface Principal {
  readonly userId: string;
}

/** Estado de las convenciones de API adjunto al request. */
export interface ApiRequestState {
  operation?: ContractOperation;
  validated?: ValidatedRequest;
  /** Versión esperada según `If-Match` (`"7"` → 7). */
  expectedVersion?: number;
  /** La cuota de esta petición ya se consumió (guard anónimo o interceptor autenticado). */
  rateLimited?: boolean;
}

export type ApiRequest = IncomingMessage & {
  route?: { path?: unknown };
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  path?: string;
  ip?: string;
  pfApi?: ApiRequestState;
  pfPrincipal?: Principal;
};

export type ApiResponse = ServerResponse;

export const apiState = (req: ApiRequest): ApiRequestState => (req.pfApi ??= {});

export const principalOf = (req: ApiRequest): Principal | undefined => req.pfPrincipal;

/** Punto único para fijar el usuario autenticado (lo usará el guard de identidad; en tests, el harness). */
export const setPrincipal = (req: ApiRequest, principal: Principal): void => {
  req.pfPrincipal = principal;
  // Atribución ambiental (auditoría, outbox): el actor de todo lo que ejecute esta petición es el usuario.
  updateRequestContext({ actor: { type: 'USER', userId: principal.userId } });
};

export const headerValue = (req: ApiRequest, name: string): string | undefined => {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v.join(', ') : v;
};

/** `@ExpectedVersion()` → versión de `If-Match` validada por `ConditionalRequestInterceptor`. */
export const ExpectedVersion = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    apiState(ctx.switchToHttp().getRequest<ApiRequest>()).expectedVersion,
);

/** `@ValidatedQuery()` → query validada y con tipos coercionados según el contrato. */
export const ValidatedQuery = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    apiState(ctx.switchToHttp().getRequest<ApiRequest>()).validated?.query ?? {},
);

/** Señal: reproducir una respuesta almacenada de idempotencia (la escribe `ProblemDetailsFilter`). */
export class ReplayedResponse {
  constructor(readonly snapshot: HttpResponseSnapshot) {}
}

/** Señal: `If-None-Match` coincide ⇒ 304 sin cuerpo. */
export class NotModifiedResponse {
  constructor(readonly etag: string) {}
}
