/** Clave global donde `register.ts` deja el SDK iniciado (se carga en otro grafo de módulos vía --import). */
export const OTEL_SDK_KEY = Symbol.for('pfos.platform.otel.sdk');

export interface ShutdownableSdk {
  shutdown(): Promise<void>;
}
