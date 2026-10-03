import { metrics, type Counter } from '@opentelemetry/api';
import { OTEL_SDK_KEY, type ShutdownableSdk } from './state.js';

const sdk = (): ShutdownableSdk | undefined =>
  (globalThis as Record<symbol, ShutdownableSdk | undefined>)[OTEL_SDK_KEY];

/** true si el proceso arrancó con `--import @pf/platform/otel/register` y OTEL_ENABLED=true. */
export function isTelemetryActive(): boolean {
  return sdk() !== undefined;
}

/**
 * Vacía y cierra exporters. Lo llama el apagado ordenado de la app como ÚLTIMO paso (el SDK no instala sus
 * propios handlers de señales, para no competir con el graceful shutdown).
 */
export async function shutdownTelemetry(): Promise<void> {
  const instance = sdk();
  if (!instance) return;
  try {
    await instance.shutdown();
  } catch {
    // Exportar es best-effort al apagar.
  }
}

/** Contador genérico sobre la API de métricas de OpenTelemetry (no-op si el SDK no está activo). */
export interface CounterMetrics {
  increment(name: string, labels: Readonly<Record<string, string>>, value?: number): void;
}

/** Crea los contadores bajo demanda (uno por nombre) con el meter `meterName`. */
export function otelCounters(meterName: string): CounterMetrics {
  const meter = metrics.getMeter(meterName);
  const counters = new Map<string, Counter>();
  return {
    increment(name, labels, value = 1) {
      let counter = counters.get(name);
      if (!counter) {
        counter = meter.createCounter(name);
        counters.set(name, counter);
      }
      counter.add(value, labels);
    },
  };
}
