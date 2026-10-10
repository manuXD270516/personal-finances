import {
  IMPORTS_EXPIRE_JOB,
  IMPORTS_PURGE_JOB,
  runImportsExpire,
  runImportsPurge,
  type ActiveWorkspaceDirectory,
  type ImportsMaintenanceService,
} from '@pf/imports/interface/imports.module';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';

export interface ImportsJobOptions {
  /** Cron de 5 campos en UTC (`IMPORT_MAINTENANCE_CRON`, por defecto `40 3 * * *`) u `off`. */
  readonly cron: string;
  /** Encola además una ejecución al arrancar (expira y purga lo vencido sin esperar al cron). */
  readonly runOnStart: boolean;
}

export interface ImportsJobPayload {
  readonly trigger: 'cron' | 'startup' | 'manual';
}

/**
 * Jobs diarios `imports.expire-reviews` (cancela las importaciones sin aprobar vencidas, actor `SYSTEM`) e
 * `imports.purge-staging` (borra las celdas crudas de las terminadas hace más de `IMPORT_STAGING_RETENTION`), openspec
 * add-basic-csv-import decisión 15. Concurrencia 1; repetirlos o ejecutarlos en paralelo es inocuo.
 */
export async function registerImportsJobs(
  queue: JobQueue,
  service: ImportsMaintenanceService,
  workspaces: ActiveWorkspaceDirectory,
  logger: Logger,
  options: ImportsJobOptions,
): Promise<void> {
  const jobs = [
    [IMPORTS_EXPIRE_JOB, runImportsExpire],
    [IMPORTS_PURGE_JOB, runImportsPurge],
  ] as const;
  for (const [name, run] of jobs) {
    await queue.work<ImportsJobPayload>(name, { concurrency: 1 }, async (job) => {
      await run(service, workspaces, logger, job.payload.trigger);
    });
    if (options.cron === 'off') {
      await queue.unschedule(name);
      logger.info({ 'job.queue': name }, 'imports cron disabled');
    } else {
      await queue.schedule<ImportsJobPayload>(name, options.cron, { trigger: 'cron' }, { tz: 'UTC' });
    }
    if (options.runOnStart) await queue.send<ImportsJobPayload>(name, { trigger: 'startup' });
  }
}
