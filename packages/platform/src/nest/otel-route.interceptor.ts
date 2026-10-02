import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { context } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import type { Observable } from 'rxjs';

/**
 * Fija `http.route` (plantilla, nunca la URL con ids) en el span HTTP y en la métrica
 * `http.server.request.duration`, y renombra el span a `METHOD /ruta` (SPIKE-10 hallazgo 3: sin
 * instrumentation-express ni instrumentation-nestjs-core, que no soporta Nest 12). No-op si OTel está apagado.
 */
@Injectable()
export class OtelRouteInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() === 'http') {
      const req = ctx.switchToHttp().getRequest<{ route?: { path?: unknown }; method: string }>();
      const rpc = getRPCMetadata(context.active());
      const path = req.route?.path;
      if (rpc?.type === RPCType.HTTP && typeof path === 'string') {
        rpc.route = path;
        rpc.span.updateName(`${req.method} ${path}`);
      }
    }
    return next.handle();
  }
}
