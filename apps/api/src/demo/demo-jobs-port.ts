import { DEMO_LOAD_QUEUE, DEMO_PURGE_QUEUE } from '@pf/identity/contracts';
import type { DemoJobPort } from '@pf/identity/interface/identity.module';
import { requireSqlExecutor } from '@pf/platform/api';
import { currentCorrelation, uuidv7 } from '@pf/platform/logging';
import type { JobQueue, QueueOptions } from '@pf/platform/queue';

/**
 * Colas de add-demo-data. La carga no reanuda (un reintento tras una caída marca FAILED, `DEMO_LOAD_INTERRUPTED`): un
 * solo reintento y expiración holgada (la carga desde la UI tiene presupuesto < 2 min). La purga reintenta con
 * backoff; agotada, el demo queda archivado e invisible (modo degradado, ADR-0026) y el log alerta.
 */
export const DEMO_QUEUE_OPTIONS: Readonly<Record<string, QueueOptions>> = {
  [DEMO_LOAD_QUEUE]: { retryLimit: 1, retryDelaySeconds: 5, expireInSeconds: 900 },
  [DEMO_PURGE_QUEUE]: {
    retryLimit: 5,
    retryDelaySeconds: 10,
    retryDelayMaxSeconds: 600,
    expireInSeconds: 600,
  },
};

export async function ensureDemoQueues(queue: JobQueue): Promise<void> {
  for (const [name, options] of Object.entries(DEMO_QUEUE_OPTIONS)) await queue.ensureQueue(name, options);
}

/**
 * `DemoJobPort` sobre pg-boss: el job se encola con la conexión de la transacción del comando
 * (`enqueueInTransaction`), así existe solo si el comando confirma (mismo patrón que el relay del outbox). El id del
 * job es el del workspace demo (un reintento del comando nunca duplica la carga ni la purga).
 */
export function demoJobsPort(queue: JobQueue): DemoJobPort {
  let ready: Promise<void> | undefined;
  const enqueue = async (name: string, id: string, payload: object) => {
    ready ??= ensureDemoQueues(queue).catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    await ready;
    const ambient = currentCorrelation()?.correlationId;
    await queue.enqueueInTransaction(
      name,
      [{ id, payload, correlationId: ambient ?? uuidv7(), traceContext: {} }],
      requireSqlExecutor(),
    );
  };
  return {
    enqueueLoad: (job) => enqueue(DEMO_LOAD_QUEUE, job.demoWorkspaceId, job),
    enqueuePurge: (job) => enqueue(DEMO_PURGE_QUEUE, job.demoWorkspaceId, job),
  };
}
