/**
 * Coalescencia por workspace de una evaluación idempotente que lee TODO el workspace (openspec add-basic-csv-import,
 * decisión 11; docs/35 D112): el consumidor `planning.budget-thresholds` reevalúa los planes completos ante cada hecho de
 * gasto, así que una ráfaga de miles de transacciones (un import) repetiría la misma lectura miles de veces.
 *
 * "Single-flight con repetición": mientras una evaluación del workspace está en curso, los hechos que llegan NO lanzan
 * otra; esperan a la que corre y marcan que hace falta UNA más (las que llegaron durante la primera pueden no haber
 * sido vistas por ella). Garantía: el handler de cada hecho solo termina después de una evaluación que EMPEZÓ después de
 * que el hecho llegó (ya confirmado en la base), así que ningún cruce de umbral se pierde. Un fallo de la evaluación lo
 * ven todos los que esperaban (cada uno reintenta con el backoff de la cola). La evaluación del dueño corre en su propia
 * transacción; los que esperan solo escriben su fila de inbox.
 */
export class WorkspaceCoalescer {
  private readonly inFlight = new Map<string, { dirty: boolean; done: Promise<void> }>();

  /** Evaluaciones realmente ejecutadas (métrica de coalescencia y pruebas). */
  executions = 0;

  async run(workspaceId: string, evaluate: () => Promise<unknown>): Promise<void> {
    const current = this.inFlight.get(workspaceId);
    if (current) {
      current.dirty = true;
      await current.done;
      return;
    }
    const entry: { dirty: boolean; done: Promise<void> } = { dirty: false, done: Promise.resolve() };
    entry.done = (async () => {
      try {
        do {
          entry.dirty = false;
          this.executions += 1;
          await evaluate();
        } while (entry.dirty);
      } finally {
        this.inFlight.delete(workspaceId);
      }
    })();
    this.inFlight.set(workspaceId, entry);
    await entry.done;
  }
}
