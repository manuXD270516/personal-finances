import type { Logger } from '../logging/index.js';

export interface GracefulShutdownOptions {
  readonly logger: Logger;
  /** Plazo total antes de forzar la salida con código 1. Debe ser menor que `stop_grace_period`. */
  readonly timeoutMs: number;
  /** Señales a escuchar. Por defecto SIGTERM y SIGINT (+ SIGBREAK en Windows). */
  readonly signals?: readonly NodeJS.Signals[];
  /** Inyectable en tests. Por defecto `process.exit`. */
  readonly exit?: (code: number) => void;
}

export type ShutdownTask = (reason: string) => Promise<void>;

/**
 * Apagado ordenado (SPIKE-08/SPIKE-05): ante la primera señal deja de aceptar trabajo nuevo, espera lo que está
 * en curso y cierra recursos (la `task`), luego sale con 0. Señales repetidas se ignoran; si se supera el
 * plazo, sale con 1. En contenedores requiere `init: true` y ENTRYPOINT en forma exec.
 *
 * Devuelve la función de disparo (útil para tests sin señales reales).
 */
export function installGracefulShutdown(task: ShutdownTask, options: GracefulShutdownOptions): ShutdownTask {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const signals =
    options.signals ??
    (process.platform === 'win32'
      ? (['SIGTERM', 'SIGINT', 'SIGBREAK'] as NodeJS.Signals[])
      : (['SIGTERM', 'SIGINT'] as NodeJS.Signals[]));
  let running: Promise<void> | undefined;

  const trigger: ShutdownTask = (reason) => {
    if (running) return running;
    const started = Date.now();
    options.logger.info({ reason }, 'shutdown started');
    const timer = setTimeout(() => {
      options.logger.fatal({ reason, timeout_ms: options.timeoutMs }, 'shutdown timed out');
      exit(1);
    }, options.timeoutMs);
    timer.unref();
    running = task(reason).then(
      () => {
        clearTimeout(timer);
        options.logger.info({ reason, duration_ms: Date.now() - started }, 'shutdown completed');
        exit(0);
      },
      (err: unknown) => {
        clearTimeout(timer);
        options.logger.error({ reason, err }, 'shutdown failed');
        exit(1);
      },
    );
    return running;
  };

  for (const signal of signals) process.on(signal, () => void trigger(signal));
  return trigger;
}
