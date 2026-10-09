import {
  EXPORT_RETENTION_QUEUE,
  WORKSPACE_EXPORT_QUEUE,
  WORKSPACE_IMPORT_QUEUE,
} from '@pf/identity/contracts';
import type {
  ExportJob,
  ImportJob,
  WorkspaceExportService,
  WorkspaceImportService,
} from '@pf/identity/interface/identity.module';
import { runWithRequestContext } from '@pf/platform/api';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import { ensurePortabilityQueues } from '../portability/portability-wiring.js';

/** Barrido horario de exports vencidos (docs/33 D102): minuto 0 de cada hora, en UTC. */
export const EXPORT_RETENTION_CRON = '0 * * * *';

/**
 * Jobs de add-workspace-export en el worker (pool `pf_worker`): `identity.workspace-export` construye, cifra y sube el
 * archivo; `identity.workspace-import` crea el workspace nuevo en una transacción; `identity.export-retention` elimina
 * los archivos vencidos. Concurrencia 1 en los dos primeros: son pesados (el archivo vive en memoria).
 */
export async function registerPortabilityJobs(
  queue: JobQueue,
  input: {
    readonly exports: WorkspaceExportService;
    readonly imports: WorkspaceImportService;
    readonly logger: Logger;
    /** Programa el barrido de retención (por defecto sí; los tests lo desactivan y lo invocan a mano). */
    readonly scheduleCrons?: boolean;
  },
): Promise<void> {
  await ensurePortabilityQueues(queue);
  const { logger } = input;
  await queue.work<ExportJob>(WORKSPACE_EXPORT_QUEUE, { concurrency: 1 }, async (job) => {
    const log = logger.child({ 'export.id': job.payload.exportId, 'workspace.id': job.payload.workspaceId });
    await runWithRequestContext(
      { actor: { type: 'WORKER', process: WORKSPACE_EXPORT_QUEUE }, origin: 'system' },
      async () => {
        const outcome = await input.exports.run(job.payload);
        log.info({ outcome }, 'workspace export processed');
      },
    );
  });
  await queue.work<ImportJob>(WORKSPACE_IMPORT_QUEUE, { concurrency: 1 }, async (job) => {
    const log = logger.child({ 'import.id': job.payload.importId });
    await runWithRequestContext(
      { actor: { type: 'USER', userId: job.payload.requestedBy }, origin: 'system' },
      async () => {
        const outcome = await input.imports.run(job.payload);
        log.info({ outcome }, 'workspace import processed');
      },
    );
  });
  await queue.work<Record<string, never>>(EXPORT_RETENTION_QUEUE, { concurrency: 1 }, async () => {
    await runWithRequestContext(
      { actor: { type: 'WORKER', process: EXPORT_RETENTION_QUEUE }, origin: 'system' },
      async () => {
        const expired = await input.exports.expireDue();
        if (expired > 0) logger.info({ 'export.expired': expired }, 'expired workspace exports removed');
      },
    );
  });
  if (input.scheduleCrons ?? true) {
    await queue.schedule(EXPORT_RETENTION_QUEUE, EXPORT_RETENTION_CRON, {}, { tz: 'UTC' });
  }
}
