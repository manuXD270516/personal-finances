import {
  LIFECYCLE_BACKFILL_JOB,
  findLifecycleDivergences,
  type LifecycleBackfill,
  type LifecycleDivergence,
} from '@pf/audit/interface/audit.module';
import { runWithRequestContext } from '@pf/platform/api';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import type { Pool } from 'pg';

/** Métrica de divergencias estado ↔ última transición (add-lifecycle-timeline decisión 6; alerta, nunca corrige). */
export const LIFECYCLE_DIVERGENCES_METRIC = 'lifecycle_state_divergences_total';

export interface ActiveWorkspaces {
  list(): Promise<readonly { readonly workspaceId: string }[]>;
}

export interface CounterPort {
  increment(name: string, labels: Record<string, string>, value?: number): void;
}

export interface LifecycleBackfillPayload {
  readonly trigger: 'startup' | 'manual';
}

/**
 * Job `audit.lifecycle-backfill` (add-lifecycle-timeline decisión 8, tarea 3.3): reconstruye desde `audit.audit_log` el
 * recorrido de los agregados con auditoría aún no respaldada (`derived = true`), workspace por workspace. Idempotente y
 * reanudable: se encola al arrancar (una vez por despliegue) y puede reencolarse a mano sin duplicar filas.
 */
export async function registerLifecycleBackfillJob(
  queue: JobQueue,
  backfill: LifecycleBackfill,
  workspaces: ActiveWorkspaces,
  logger: Logger,
  options: { readonly runOnStart: boolean },
): Promise<void> {
  await queue.work<LifecycleBackfillPayload>(LIFECYCLE_BACKFILL_JOB, { concurrency: 1 }, async (job) => {
    await runLifecycleBackfill(backfill, workspaces, logger, job.payload.trigger);
  });
  if (options.runOnStart) {
    await queue.send<LifecycleBackfillPayload>(LIFECYCLE_BACKFILL_JOB, { trigger: 'startup' });
  }
}

export function runLifecycleBackfill(
  backfill: LifecycleBackfill,
  workspaces: ActiveWorkspaces,
  logger: Logger,
  trigger: LifecycleBackfillPayload['trigger'],
): Promise<{ readonly aggregates: number; readonly derived: number }> {
  return runWithRequestContext(
    { actor: { type: 'WORKER', process: `${LIFECYCLE_BACKFILL_JOB}:${trigger}` }, origin: 'system' },
    async () => {
      let aggregates = 0;
      let derived = 0;
      for (const { workspaceId } of await workspaces.list()) {
        const result = await backfill.run(workspaceId);
        aggregates += result.aggregates;
        derived += result.derived;
        if (result.derived > 0) logger.info({ workspaceId, ...result }, 'lifecycle backfilled');
      }
      logger.info({ job: LIFECYCLE_BACKFILL_JOB, aggregates, derived }, 'lifecycle backfill finished');
      return { aggregates, derived };
    },
  );
}

/**
 * Chequeo de consistencia del recorrido (decisión 6, tarea 3.4): junto con `VerifyLedgerIntegrity` (FR-LEDGER-015), cada
 * agregado cuyo estado difiere del destino de su última transición emite log `error` + métrica por tipo de agregado.
 */
export async function verifyLifecycleConsistency(
  pool: Pool,
  workspaces: ActiveWorkspaces,
  logger: Logger,
  metrics: CounterPort,
): Promise<readonly LifecycleDivergence[]> {
  const found: LifecycleDivergence[] = [];
  for (const { workspaceId } of await workspaces.list()) {
    for (const d of await findLifecycleDivergences(pool, workspaceId)) {
      found.push(d);
      metrics.increment(LIFECYCLE_DIVERGENCES_METRIC, { aggregateType: d.aggregateType });
      logger.error(
        { alert: 'lifecycle.state_divergence', severity: 'high', ...d },
        'lifecycle state diverges from its last transition',
      );
    }
  }
  logger.info({ command: 'VerifyLifecycleConsistency', divergences: found.length }, 'lifecycle verified');
  return found;
}
