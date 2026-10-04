import { DEMO_LOAD_QUEUE, DEMO_PURGE_QUEUE } from '@pf/identity/contracts';
import type { DemoDataService, DemoLoadJob, DemoPurgeJob } from '@pf/identity/interface/identity.module';
import { runWithRequestContext } from '@pf/platform/api';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import type { DemoDataLoader } from '../demo/demo-data-loader.js';
import { ensureDemoQueues } from '../demo/demo-jobs-port.js';

/**
 * Jobs de add-demo-data en el worker (pool `pf_worker`): `demo.load` ejecuta el `DemoDataLoader` y `demo.purge`
 * invoca la purga física acotada (`platform.purge_demo_workspace`, EXECUTE solo `pf_worker`) y audita en el origen.
 * Concurrencia 1: la carga es pesada y la purga toma el lock del workspace.
 */
export async function registerDemoJobs(
  queue: JobQueue,
  input: { readonly loader: DemoDataLoader; readonly demo: DemoDataService; readonly logger: Logger },
): Promise<void> {
  await ensureDemoQueues(queue);
  await queue.work<DemoLoadJob>(DEMO_LOAD_QUEUE, { concurrency: 1 }, async (job) => {
    await input.loader.load(job.payload);
  });
  await queue.work<DemoPurgeJob>(DEMO_PURGE_QUEUE, { concurrency: 1 }, (job) =>
    runDemoPurge(input.demo, job.payload, input.logger, job.attempt),
  );
}

export async function runDemoPurge(
  demo: DemoDataService,
  payload: DemoPurgeJob,
  logger: Logger,
  attempt = 1,
): Promise<void> {
  const log = logger.child({ 'demo.workspace_id': payload.demoWorkspaceId });
  try {
    const rows = await runWithRequestContext(
      { actor: { type: 'WORKER', process: DEMO_PURGE_QUEUE }, origin: 'system' },
      () => demo.purgeDemoWorkspace(payload),
    );
    log.info(
      { 'demo.rows_deleted': Object.values(rows).reduce((a, b) => a + b, 0) },
      'demo workspace purged',
    );
  } catch (err) {
    // Alerta (pfos_demo_purge_failures_total en la vista de logs): el demo sigue archivado e invisible (modo degradado).
    log.error(
      {
        alert: 'demo.purge_failed',
        attempt,
        err: { type: err instanceof Error ? err.name : typeof err, message: String((err as Error)?.message) },
      },
      'demo workspace purge failed',
    );
    throw err;
  }
}
