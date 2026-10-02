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
