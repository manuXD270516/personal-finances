import { AsyncLocalStorage } from 'node:async_hooks';
import { pino, type LoggerOptions } from 'pino';

export const als = new AsyncLocalStorage<{ correlationId: string }>();

// Rutas a redactar (docs/18-observability.md §3.2). censor fijo, nunca el valor.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  '*.authorization',
  '*.token',
  '*.password',
  '*.apiKey',
  '*.amount',
  '*.description',
  'body',
];

export const baseLoggerOptions = (role: string): LoggerOptions => ({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { 'service.name': process.env.OTEL_SERVICE_NAME ?? `spike-${role}`, 'process.role': role },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  // correlation_id desde AsyncLocalStorage (trace_id/span_id los inyecta instrumentation-pino)
  mixin: () => {
    const c = als.getStore();
    return c ? { correlation_id: c.correlationId } : {};
  },
});

export const createLogger = (role: string) => pino(baseLoggerOptions(role));
