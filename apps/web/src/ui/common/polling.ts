/**
 * Consultas periódicas en pausa con la pestaña oculta (change refine-perceived-performance, M-31).
 *
 * `createVisiblePoller` generaliza el sondeo de la campana (`createUnreadPoller`): no consulta mientras la página está
 * oculta, consulta de inmediato al volver a ser visible y no arranca si la página nace oculta. Solo usa
 * `document.hidden` y `visibilitychange` (Widely); las entradas de rendimiento de visibilidad son Limited y no se usan
 * (D500). No solapa consultas: si la anterior sigue en vuelo, el siguiente ciclo la espera. Tras `stop()` no vuelve a
 * llamar a `run`; el llamador descarta las respuestas tardías con su propio indicador de cancelación.
 */

/** Superficie mínima de `document` que necesita el sondeo (inyectable en tests). */
export interface PollDocument {
  readonly hidden: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface VisiblePollerOptions {
  readonly intervalMs: number;
  /** Una consulta. Devolver `false` detiene el sondeo; lanzar se ignora y se reintenta en el siguiente ciclo. */
  readonly run: () => Promise<boolean | void> | boolean | void;
  readonly doc?: PollDocument;
}

export function createVisiblePoller(options: VisiblePollerOptions): { start(): void; stop(): void } {
  const doc = options.doc ?? document;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let inFlight = false;

  const poll = () => {
    if (!running || doc.hidden || inFlight) return;
    inFlight = true;
    let pending: Promise<boolean | void>;
    try {
      pending = Promise.resolve(options.run());
    } catch {
      pending = Promise.reject(new Error('run'));
    }
    void pending
      .then(
        (result) => {
          if (result === false) stop();
        },
        () => undefined,
      )
      .finally(() => {
        inFlight = false;
      });
  };
  const onVisibility = () => {
    if (!doc.hidden) poll();
  };
  function stop() {
    running = false;
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    doc.removeEventListener('visibilitychange', onVisibility);
  }

  return {
    start() {
      if (running) return;
      running = true;
      timer = setInterval(poll, options.intervalMs);
      doc.addEventListener('visibilitychange', onVisibility);
    },
    stop,
  };
}
