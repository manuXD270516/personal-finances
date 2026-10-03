import { Catch, Inject, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Logger } from '../../logging/index.js';
import { LOGGER } from '../tokens.js';
import { API_CONVENTIONS, renderException, writeSnapshot, type ApiConventionsOptions } from './options.js';
import {
  NotModifiedResponse,
  ReplayedResponse,
  type ApiRequest,
  type ApiResponse,
} from './request-context.js';

/**
 * Filtro global RFC 9457: toda respuesta 4xx/5xx sale como `application/problem+json` con `type`, `title`,
 * `status`, `code` y `requestId` (incluye 404 de rutas desconocidas y versiones no publicadas). Un error inesperado
 * responde 500 `INTERNAL_ERROR` sin stack ni SQL; el detalle va solo al log (nivel `error`, mismo requestId).
 * También escribe las señales de reproducción idempotente y 304.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const req = host.switchToHttp().getRequest<ApiRequest>();
    const res = host.switchToHttp().getResponse<ApiResponse>();
    if (res.headersSent) {
      res.end();
      return;
    }

    if (exception instanceof NotModifiedResponse) {
      res.statusCode = 304;
      res.setHeader('etag', exception.etag);
      res.end();
      return;
    }

    if (exception instanceof ReplayedResponse) {
      const { status, headers, body } = exception.snapshot;
      res.statusCode = status;
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.setHeader('idempotent-replayed', 'true');
      if (body === undefined) {
        res.end();
      } else {
        if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(body));
      }
      return;
    }

    const rendered = renderException(exception, req, res, this.options);
    const { status, headers, body } = rendered.response;
    if (rendered.unexpected) {
      this.logger.error({ err: exception, 'http.status_code': status }, 'unhandled error');
    } else if (status >= 500) {
      this.logger.warn(
        {
          err: { type: exception instanceof Error ? exception.name : typeof exception },
          'http.status_code': status,
        },
        'dependency unavailable',
      );
    }
    writeSnapshot(res, { status, headers, body });
  }
}
