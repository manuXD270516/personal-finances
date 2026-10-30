import {
  DOCUMENTS_MAINTENANCE_JOB,
  DOCUMENT_CONTENTS_RESTORE_JOB,
  type ContentRestoreJob,
  type DocumentsRuntime,
} from '@pf/documents/interface/documents.module';
import { runWithRequestContext } from '@pf/platform/api';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import { DOCUMENT_RESTORE_QUEUE_OPTIONS } from '../documents/restore-jobs.js';

export interface DocumentsJobOptions {
  /** Cron de 5 campos en UTC (`DOCUMENT_MAINTENANCE_CRON`, cada 10 minutos por defecto) u `off`. */
  readonly cron: string;
  /** Encola además una ejecución al arrancar. */
  readonly runOnStart: boolean;
}

export interface DocumentsJobPayload {
  readonly trigger: 'cron' | 'startup' | 'manual';
}

/**
 * Job `documents.maintenance` (openspec add-document-attachments, decisión 10): expira las subidas no completadas,
 * reintenta las verificaciones atascadas, barre la cuarentena (> 24 h) y los objetos huérfanos, purga los documentos
 * sin vínculo, re-envuelve claves y vigila la deriva de la cuota. UN solo job secuencial con concurrencia 1: no agrega
 * consumidores de eventos ni conexiones al presupuesto del worker (API 22 + worker 34). Repetirlo es inocuo.
 */
export async function registerDocumentsJobs(
  queue: JobQueue,
  runtime: DocumentsRuntime,
  logger: Logger,
  options: DocumentsJobOptions,
): Promise<void> {
  await queue.work<DocumentsJobPayload>(DOCUMENTS_MAINTENANCE_JOB, { concurrency: 1 }, async (job) => {
    await runDocumentsMaintenance(runtime, logger, job.payload.trigger);
  });
  // Restauración del archivo de contenidos del export (tarea 8.3): un job por solicitud, de a uno.
  await queue.ensureQueue(DOCUMENT_CONTENTS_RESTORE_JOB, DOCUMENT_RESTORE_QUEUE_OPTIONS);
  await queue.work<ContentRestoreJob>(DOCUMENT_CONTENTS_RESTORE_JOB, { concurrency: 1 }, async (job) => {
    await runWithRequestContext(
      { actor: { type: 'USER', userId: job.payload.requestedBy }, origin: 'system' },
      async () => {
        const outcome = await runtime.contents.runRestore(job.payload);
        // Solo el resultado: nunca nombres ni ids de documentos (NFR-SEC-015).
        logger.info({ outcome }, 'document contents restore processed');
      },
    );
  });
  if (options.cron === 'off') {
    await queue.unschedule(DOCUMENTS_MAINTENANCE_JOB);
    logger.info({ 'job.queue': DOCUMENTS_MAINTENANCE_JOB }, 'documents maintenance cron disabled');
  } else {
    await queue.schedule<DocumentsJobPayload>(
      DOCUMENTS_MAINTENANCE_JOB,
      options.cron,
      { trigger: 'cron' },
      { tz: 'UTC' },
    );
  }
  if (options.runOnStart)
    await queue.send<DocumentsJobPayload>(DOCUMENTS_MAINTENANCE_JOB, { trigger: 'startup' });
}

export async function runDocumentsMaintenance(
  runtime: DocumentsRuntime,
  logger: Pick<Logger, 'info' | 'warn'>,
  trigger: 'cron' | 'startup' | 'manual',
): Promise<void> {
  await runWithRequestContext(
    { actor: { type: 'WORKER', process: DOCUMENTS_MAINTENANCE_JOB }, origin: 'system' },
    async () => {
      const reports = await runtime.maintenance.runAll();
      // Los logs llevan solo conteos (NFR-SEC-015): nunca nombres ni ids de documentos.
      logger.info(
        { trigger, jobs: reports.map((r) => ({ job: r.job, affected: r.affected, failed: r.failed })) },
        'documents maintenance finished',
      );
      const drift = await runtime.maintenance.checkUsageDrift();
      if (drift.length > 0) {
        logger.warn({ workspaces: drift.length }, 'documents storage usage drift detected');
      }
    },
  );
}
