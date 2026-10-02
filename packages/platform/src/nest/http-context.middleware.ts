import type { IncomingMessage, ServerResponse } from 'node:http';
import { acceptRequestId, runWithCorrelation, uuidv7, type Logger } from '../logging/index.js';

type Next = (err?: unknown) => void;

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Middleware HTTP (Express) de plataforma:
 * 1. Toma `X-Request-Id` entrante (si es un id opaco válido) o genera un UUIDv7, y lo devuelve en la respuesta.
 * 2. Ejecuta el resto de la petición dentro del contexto de correlación (correlation_id = request_id, docs/18 §3.3).
 * 3. Registra una línea por petición con un serializer allow-list (método, ruta plantilla, estado, duración):
 *    nunca headers, query ni body (docs/18 §3.2). Los probes `/health/*` se registran en `debug`.
 */
export function httpContextMiddleware(logger: Logger) {
  return (req: IncomingMessage, res: ServerResponse, next: Next): void => {
    const requestId = acceptRequestId(req.headers[REQUEST_ID_HEADER]) ?? uuidv7();
    const correlation = { correlationId: requestId, requestId };
    res.setHeader(REQUEST_ID_HEADER, requestId);
    const started = process.hrtime.bigint();

    res.on('finish', () => {
      const route = (req as IncomingMessage & { route?: { path?: unknown } }).route?.path;
      const status = res.statusCode;
      const isProbe = (req.url ?? '').startsWith('/health/');
      const level = isProbe ? 'debug' : status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      runWithCorrelation(correlation, () =>
        logger[level](
          {
            'http.method': req.method,
            'http.route': typeof route === 'string' ? route : 'unmatched',
            'http.status_code': status,
            duration_ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
          },
          'request completed',
        ),
      );
    });

    runWithCorrelation(correlation, () => next());
  };
}
