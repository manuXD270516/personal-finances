// Bootstrap OpenTelemetry. Se carga ANTES que la app: `node --import ./dist/otel.js dist/api/main.js`.
// Todo se configura por variables de entorno estándar OTEL_* (endpoint, protocolo, headers, sampler, resource).
import { register } from 'node:module';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

if (process.env.OTEL_SDK_DISABLED === 'true') {
  console.error('[otel] OTEL_SDK_DISABLED=true -> SDK no inicializado');
} else {
  // Nest 12 es ESM puro: sin este hook (import-in-the-middle) los módulos ESM no se parchean.
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

  const sdk = new NodeSDK({
    // service.name / deployment.environment via OTEL_SERVICE_NAME + OTEL_RESOURCE_ATTRIBUTES
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 5000),
      }),
    ],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Solo lo necesario: menos parches = menos overhead y menos superficie de fuga de datos.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          // No trazar health checks (ADR-0020)
          ignoreIncomingRequestHook: (req) => (req.url ?? '').startsWith('/health'),
        },
        // Express 5 + router generan ~30 spans de middleware por request: ruido. Nos quedamos con el
        // span HTTP (que igual recibe http.route) + spans manuales de use case.
        '@opentelemetry/instrumentation-express': {
          enabled: process.env.SPIKE_EXPRESS_SPANS === 'true',
        },
        '@opentelemetry/instrumentation-router': { enabled: process.env.SPIKE_EXPRESS_SPANS === 'true' },
        '@opentelemetry/instrumentation-pg': { enhancedDatabaseReporting: false },
        // pino: inyecta trace_id/span_id en cada línea y reenvía el log (ya redactado) como OTel LogRecord
        '@opentelemetry/instrumentation-pino': {},
      }),
    ],
  });
  sdk.start();
  const shutdown = () => sdk.shutdown().finally(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
