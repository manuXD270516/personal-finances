// Bootstrap de OpenTelemetry (ADR-0020, SPIKE-10). Se carga ANTES que la aplicación:
//   node --import @pf/platform/otel/register dist/main.api.js
// Si OTEL_ENABLED no es "true" no hace nada (default: deshabilitado, también en tests).
// El resto de la configuración son variables OTEL_* estándar que lee el propio SDK (endpoint, protocolo,
// headers, sampler, resource attributes, exporters).
import { register } from 'node:module';
import { basename } from 'node:path';
import { VARIABLES } from '../config/variables.js';
import { OTEL_SDK_KEY, type ShutdownableSdk } from './state.js';

function fail(message: string): never {
  process.stderr.write(
    JSON.stringify({ level: 'fatal', time: new Date().toISOString(), msg: message }) + '\n',
  );
  process.exit(78);
}

const enabledParse = VARIABLES.OTEL_ENABLED.schema.safeParse(process.env['OTEL_ENABLED'] || 'false');
if (!enabledParse.success) fail('invalid configuration: OTEL_ENABLED');

if (enabledParse.data) {
  // Obligatorio (SPIKE-10 hallazgo 5): los detectores por defecto filtran usuario de SO, hostname y argumentos.
  process.env['OTEL_NODE_RESOURCE_DETECTORS'] ||= VARIABLES.OTEL_NODE_RESOURCE_DETECTORS.doc.default;
  const detectors = VARIABLES.OTEL_NODE_RESOURCE_DETECTORS.schema.safeParse(
    process.env['OTEL_NODE_RESOURCE_DETECTORS'],
  );
  if (!detectors.success) fail('invalid configuration: OTEL_NODE_RESOURCE_DETECTORS');
  // Métrica estable `http.server.request.duration` (docs/18 §5.1).
  process.env['OTEL_SEMCONV_STABILITY_OPT_IN'] ||= 'http';
  // finance-api / finance-worker según el entrypoint, salvo que se fije OTEL_SERVICE_NAME.
  if (!process.env['OTEL_SERVICE_NAME']) {
    const entry = basename(process.argv[1] ?? '');
    process.env['OTEL_SERVICE_NAME'] = entry.includes('worker') ? 'finance-worker' : 'finance-api';
  }

  // Nest 12 es ESM puro: sin este hook (import-in-the-middle) no se parchea nada de lo importado como ESM.
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');

  const sdk = new NodeSDK({
    // Sin exporters explícitos: el SDK los elige por OTEL_TRACES_EXPORTER / OTEL_METRICS_EXPORTER /
    // OTEL_LOGS_EXPORTER (default otlp) → cambiar de backend es solo cambiar variables.
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        // Express 5 + router generan ~30 spans de middleware por request (ruido). http.route lo fija el
        // interceptor de @pf/platform/nest.
        '@opentelemetry/instrumentation-express': { enabled: false },
        '@opentelemetry/instrumentation-router': { enabled: false },
        // No soporta Nest 12 (supportedVersions <12).
        '@opentelemetry/instrumentation-nestjs-core': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => (req.url ?? '').startsWith('/health'),
        },
        '@opentelemetry/instrumentation-pg': { enhancedDatabaseReporting: false },
        // trace_id/span_id los añade el mixin de nuestro logger; la instrumentación solo reenvía el log
        // (ya redactado) como LogRecord OTLP.
        '@opentelemetry/instrumentation-pino': { disableLogCorrelation: true },
      }),
    ],
  });
  sdk.start();
  (globalThis as Record<symbol, ShutdownableSdk | undefined>)[OTEL_SDK_KEY] = sdk;
}
