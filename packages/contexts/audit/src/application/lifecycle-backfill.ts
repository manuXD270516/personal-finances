import { DERIVABLE_AGGREGATE_TYPES, deriveLifecycleSteps } from '../domain/lifecycle-derivation.js';
import { lifecycleEntry } from '../domain/lifecycle-entry.js';
import type { IdGenerator, LifecycleBackfillSource, LifecycleStore } from './ports/index.js';

/** Unidad de trabajo del worker con el contexto RLS de UN workspace (rol pf_worker). */
export interface WorkerUnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

export interface LifecycleBackfillDeps {
  readonly uow: WorkerUnitOfWork;
  readonly source: LifecycleBackfillSource;
  readonly store: LifecycleStore;
  readonly ids: IdGenerator;
  /** Agregados por transacción de BD (reanudable: cada lote confirma lo suyo). */
  readonly batchSize?: number;
}

export interface LifecycleBackfillResult {
  readonly aggregates: number;
  readonly derived: number;
}

/** Nombre del job del worker (decisión 8). */
export const LIFECYCLE_BACKFILL_JOB = 'audit.lifecycle-backfill';

/**
 * Job `audit.lifecycle-backfill` (add-lifecycle-timeline decisión 8, FR-AUDIT-012): para cada agregado con registros de
 * auditoría que todavía no respaldan ninguna fila del recorrido, reconstruye sus pasos (`derived = true`) desde
 * `audit.audit_log`. Idempotente (un registro ya respaldado nunca se vuelve a derivar) y reanudable (lotes por
 * transacción, en orden de id). Nunca crea transiciones sin un registro de auditoría que las respalde.
 */
export class LifecycleBackfill {
  constructor(private readonly deps: LifecycleBackfillDeps) {}

  async run(workspaceId: string): Promise<LifecycleBackfillResult> {
    const limit = this.deps.batchSize ?? 200;
    let after: string | null = null;
    let aggregates = 0;
    let derived = 0;
    for (;;) {
      const batch = await this.deps.uow.run(workspaceId, async () => {
        const page = await this.deps.source.aggregatesWithoutLifecycle({
          workspaceId,
          aggregateTypes: DERIVABLE_AGGREGATE_TYPES,
          afterAggregateId: after,
          limit,
        });
        let written = 0;
        for (const agg of page) written += await this.backfillAggregate(workspaceId, agg);
        return { page, written };
      });
      aggregates += batch.page.length;
      derived += batch.written;
      if (batch.page.length < limit) break;
      after = batch.page.at(-1)?.aggregateId ?? null;
    }
    return { aggregates, derived };
  }

  private async backfillAggregate(
    workspaceId: string,
    agg: { readonly aggregateType: string; readonly aggregateId: string },
  ): Promise<number> {
    const { source, store, ids } = this.deps;
    const records = await source.auditOf(workspaceId, agg.aggregateType, agg.aggregateId);
    const existing = await store.entriesOf(workspaceId, agg.aggregateType, agg.aggregateId);
    const covered = new Map<string, string | null>();
    for (const e of existing) {
      if (e.auditLogId !== null && (e.toState !== null || !covered.has(e.auditLogId))) {
        covered.set(e.auditLogId, e.toState);
      }
    }
    const steps = deriveLifecycleSteps(records, covered);
    const byId = new Map(records.map((r) => [r.id, r]));
    for (const step of steps) {
      const r = byId.get(step.auditLogId);
      if (!r) continue;
      const sequence = await store.nextSequence(workspaceId, agg.aggregateType, step.aggregateId);
      await store.insert(
        lifecycleEntry({
          id: ids.next(),
          workspaceId,
          aggregateType: agg.aggregateType,
          aggregateId: step.aggregateId,
          sequence,
          kind: step.kind,
          transition: step.transition,
          fromState: step.fromState,
          toState: step.toState,
          machineVersion: step.kind === 'TRANSITION' ? 1 : null,
          revisionFrom: step.revisionFrom,
          revisionTo: step.revisionTo,
          aggregateVersion: step.aggregateId === r.aggregateId ? r.aggregateVersion : null,
          occurredAt: r.occurredAt,
          actor: r.actor,
          origin: r.origin,
          reason: step.kind === 'TRANSITION' ? step.reason : null,
          correlationId: r.correlationId,
          auditLogId: r.id,
          eventIds: [],
          eventTypes: [],
          journalEntries: step.journalEntries,
          detailRefs: step.detailRefs,
          changedFields: step.changedFields,
          derived: true,
        }),
      );
    }
    return steps.length;
  }
}
