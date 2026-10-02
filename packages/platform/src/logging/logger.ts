import { isSpanContextValid, trace } from '@opentelemetry/api';
import {
  destination,
  pino,
  stdSerializers,
  stdTimeFunctions,
  type DestinationStream,
  type Logger,
} from 'pino';
import { currentCorrelation } from './correlation.js';
import { REDACTION_CENSOR, REDACT_PATHS } from './redaction.js';

export type { Logger } from 'pino';

export type ProcessRole = 'api' | 'worker' | 'migrate' | 'seed' | 'web';

export interface CreateLoggerOptions {
  /** `service.name` (p. ej. finance-api, finance-worker). */
  readonly service: string;
  readonly role: ProcessRole;
  /** `deployment.environment` (PFOS_ENV). */
  readonly environment: string;
  readonly level: string;
  /** Destino alternativo (tests). Por defecto stdout. */
  readonly destination?: DestinationStream;
}

/**
 * Logger JSON estructurado (docs/18 §3.1): una línea JSON por evento con `time`, `level`, `msg`,
 * `service.name`, `deployment.environment`, `process.role`, `correlation_id`/`request_id` (AsyncLocalStorage)
 * y `trace_id`/`span_id` cuando hay un span activo (OTel habilitado).
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      base: {
        'service.name': options.service,
        'deployment.environment': options.environment,
        'process.role': options.role,
      },
      messageKey: 'msg',
      timestamp: stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: [...REDACT_PATHS], censor: REDACTION_CENSOR },
      serializers: { err: stdSerializers.err },
      mixin: () => {
        const fields: Record<string, string> = {};
        const correlation = currentCorrelation();
        if (correlation) {
          fields['correlation_id'] = correlation.correlationId;
          if (correlation.requestId) fields['request_id'] = correlation.requestId;
        }
        const span = trace.getActiveSpan();
        if (span) {
          const ctx = span.spanContext();
          if (isSpanContextValid(ctx)) {
            fields['trace_id'] = ctx.traceId;
            fields['span_id'] = ctx.spanId;
            fields['trace_flags'] = `0${ctx.traceFlags.toString(16)}`;
          }
        }
        return fields;
      },
    },
    options.destination ?? destination(1),
  );
}
