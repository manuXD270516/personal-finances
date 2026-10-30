import {
  DOCUMENT_CONTENTS_RESTORE_JOB,
  type ContentRestoreJob,
  type ContentRestoreJobPort,
} from '@pf/documents/interface/documents.module';
import { requireSqlExecutor } from '@pf/platform/api';
import { currentCorrelation, uuidv7 } from '@pf/platform/logging';
import type { JobQueue, QueueOptions } from '@pf/platform/queue';

/**
 * Cola de la restauración del archivo de contenidos (openspec add-document-attachments, tarea 8.3). El job no se
 * reintenta a ciegas: un fallo del dominio es final (la operación queda FAILED con su código) y la restauración es
 * idempotente por documento, así que un reintento tras un corte solo completa lo pendiente.
 */
export const DOCUMENT_RESTORE_QUEUE_OPTIONS: QueueOptions = {
  retryLimit: 1,
  retryDelaySeconds: 30,
  expireInSeconds: 3600,
};

/**
 * `ContentRestoreJobPort` sobre pg-boss: el job se encola con la conexión de la transacción del comando
 * (`enqueueInTransaction`), así existe solo si el comando confirma. El id del job es el de la operación.
 */
export function documentsRestoreJobsPort(queue: JobQueue): ContentRestoreJobPort {
  let ready: Promise<void> | undefined;
  return {
    async enqueue(job: ContentRestoreJob): Promise<void> {
      ready ??= queue
        .ensureQueue(DOCUMENT_CONTENTS_RESTORE_JOB, DOCUMENT_RESTORE_QUEUE_OPTIONS)
        .catch((err: unknown) => {
          ready = undefined;
          throw err;
        });
      await ready;
      const ambient = currentCorrelation()?.correlationId;
      await queue.enqueueInTransaction(
        DOCUMENT_CONTENTS_RESTORE_JOB,
        [{ id: job.operationId, payload: job, correlationId: ambient ?? uuidv7(), traceContext: {} }],
        requireSqlExecutor(),
      );
    },
  };
}
