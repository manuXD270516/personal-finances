import type { IncomingMessage, ServerResponse } from 'node:http';
import { runWithRequestContext, type RequestOrigin } from '../api/context/request-context.js';

type Next = (err?: unknown) => void;

/** Cabecera con la que el BFF de finance-web marca las peticiones que nacen en la UI (origen `ui`). */
export const CLIENT_ORIGIN_HEADER = 'x-pfos-origin';
const MAX_USER_AGENT = 512;
const IP = /^[0-9a-fA-F.:]{2,45}$/;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * IP del cliente final: primer salto de `X-Forwarded-For` (lo fija el BFF / el proxy de entrada; finance-api no se
 * expone públicamente, docs/12 §2) o la dirección del socket. Solo se usa para calcular su HMAC de auditoría.
 */
export function clientIpOf(req: IncomingMessage): string | null {
  const forwarded = first(req.headers['x-forwarded-for'])?.split(',')[0]?.trim();
  const candidate = forwarded || req.socket?.remoteAddress || '';
  const ip = candidate.startsWith('::ffff:') ? candidate.slice(7) : candidate;
  return IP.test(ip) ? ip : null;
}

/**
 * Middleware HTTP que abre el contexto ambiental de la petición (openspec add-audit-trail): origen (`ui` si viene del
 * BFF, `api` en otro caso), user agent, IP del cliente (solo para su HMAC) e `Idempotency-Key`. El actor lo completa
 * el guard de identidad (`setPrincipal`). Debe registrarse después de `httpContextMiddleware`.
 */
export function requestContextMiddleware() {
  return (req: IncomingMessage, _res: ServerResponse, next: Next): void => {
    const origin: RequestOrigin = first(req.headers[CLIENT_ORIGIN_HEADER]) === 'ui' ? 'ui' : 'api';
    const userAgent = first(req.headers['user-agent'])?.slice(0, MAX_USER_AGENT) ?? null;
    const idempotencyKey = first(req.headers['idempotency-key']) ?? null;
    runWithRequestContext({ origin, userAgent, clientIp: clientIpOf(req), idempotencyKey }, () => next());
  };
}
