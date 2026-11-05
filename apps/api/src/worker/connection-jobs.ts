import {
  CONNECTION_SYNC_JOB,
  CONNECTION_VERIFY_JOB,
  CREDENTIALS_REWRAP_JOB,
  type ActiveWorkspaceDirectory,
  type ConnectionJobPayload,
  type ImportsRuntime,
} from '@pf/imports/interface/imports.module';
import { runWithRequestContext } from '@pf/platform/api';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import { CONNECTION_QUEUE_OPTIONS } from '../imports/banking-wiring.js';

export interface ConnectionSyncPayload extends ConnectionJobPayload {
  readonly importJobId: string;
}

export interface RewrapPayload {
  readonly trigger: 'startup' | 'manual';
}

/**
 * Jobs de las conexiones (openspec add-banking-providers decisión 6, D249): `imports.connection-verify`,
 * `imports.connection-sync` e `imports.credentials-rewrap` en la `JobQueue` EXISTENTE, con concurrencia 1 cada uno. No
 * son consumidores de eventos ni colas pg-boss nuevas, y ocupan una conexión del pool del worker solo durante sus
 * escrituras cortas (el presupuesto de conexiones no cambia). Solo se registran los handlers de verificación y
 * sincronización si este worker tiene las claves privadas (D342); sin ellas los jobs esperan a uno que sí.
 * Los logs llevan solo resultados y conteos: nunca la credencial, su huella ni datos de las filas (NFR-SEC-015).
 */
export async function registerConnectionJobs(
  queue: JobQueue,
  imports: Pick<ImportsRuntime, 'connectionJobs' | 'canDecryptCredentials'>,
  workspaces: ActiveWorkspaceDirectory,
  logger: Logger,
  options: { readonly rewrapOnStart: boolean },
): Promise<void> {
  if (!imports.canDecryptCredentials) {
    logger.info('connection jobs disabled: no credential private keys in this worker');
    return;
  }
  const jobs = imports.connectionJobs;
  await queue.ensureQueue(CONNECTION_VERIFY_JOB, CONNECTION_QUEUE_OPTIONS);
  await queue.ensureQueue(CONNECTION_SYNC_JOB, CONNECTION_QUEUE_OPTIONS);
  await queue.ensureQueue(CREDENTIALS_REWRAP_JOB, {
    retryLimit: 1,
    retryDelaySeconds: 60,
    expireInSeconds: 3600,
  });

  await queue.work<ConnectionJobPayload>(CONNECTION_VERIFY_JOB, { concurrency: 1 }, async (job) => {
    await runWithRequestContext(
      { actor: { type: 'WORKER', process: CONNECTION_VERIFY_JOB }, origin: 'system' },
      async () => {
        const outcome = await jobs.verify({
          workspaceId: job.payload.workspaceId,
          connectionId: job.payload.connectionId,
        });
        logger.info({ outcome }, 'connection verification processed');
      },
    );
  });

  await queue.work<ConnectionSyncPayload>(CONNECTION_SYNC_JOB, { concurrency: 1 }, async (job) => {
    await runWithRequestContext(
      { actor: { type: 'WORKER', process: CONNECTION_SYNC_JOB }, origin: 'system' },
      async () => {
        const outcome = await jobs.sync({
          workspaceId: job.payload.workspaceId,
          connectionId: job.payload.connectionId,
          importJobId: job.payload.importJobId,
          attempt: job.attempt,
        });
        logger.info({ outcome }, 'connection synchronization processed');
      },
    );
  });

  await queue.work<RewrapPayload>(CREDENTIALS_REWRAP_JOB, { concurrency: 1 }, async (job) => {
    await runWithRequestContext(
      { actor: { type: 'WORKER', process: CREDENTIALS_REWRAP_JOB }, origin: 'system' },
      async () => {
        let rewrapped = 0;
        let flagged = 0;
        let failed = 0;
        for (const { workspaceId } of await workspaces.list()) {
          try {
            const r = await jobs.rewrap({ workspaceId });
            rewrapped += r.rewrapped;
            flagged += r.flagged;
          } catch {
            // Un workspace que falla no detiene a los demás; la siguiente ejecución lo reintenta.
            failed += 1;
          }
        }
        logger.info(
          { trigger: job.payload.trigger, rewrapped, flagged, failed },
          'credentials rewrap finished',
        );
      },
    );
  });
  if (options.rewrapOnStart) await queue.send<RewrapPayload>(CREDENTIALS_REWRAP_JOB, { trigger: 'startup' });
}
