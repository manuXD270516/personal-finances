import { PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { Instant } from '@pf/shared-kernel';
import { sql, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { WorkerUnitOfWork } from '../application/lifecycle-backfill.js';
import type { LifecycleBackfillSource, LifecycleStore } from '../application/ports/index.js';
import { isAuditOrigin } from '../domain/audit-origin.js';
import type { AuditRecord } from '../domain/audit-record.js';
import { lifecycleEntry, type LifecycleEntry } from '../domain/lifecycle-entry.js';
import { PgAuditLogStore } from './pg-audit-log.js';

/** Columnas de `audit.lifecycle_transition` (migración 20261004150000_audit_lifecycle_transition.sql). */
interface LifecycleTable {
  id: string;
  workspace_id: string;
  aggregate_type: string;
  aggregate_id: string;
  sequence: number;
  kind: 'TRANSITION' | 'ANNOTATION';
  transition: string | null;
  from_state: string | null;
  to_state: string | null;
  machine_version: number | null;
  revision_from: number | null;
  revision_to: number | null;
  aggregate_version: number | null;
  occurred_at: Date;
  actor_type: 'USER' | 'SYSTEM' | 'WORKER';
  actor_id: string | null;
  actor_process: string | null;
  origin: string;
  reason: string | null;
  correlation_id: string;
  audit_log_id: string | null;
  event_ids: string[];
  event_types: string[];
  journal_entries: { reversed: string | null; reversal: string | null; posted: string | null };
  detail_refs: Record<string, string | number>;
  changed_fields: string[];
  derived: boolean;
}

interface LifecycleDb {
  'audit.lifecycle_transition': LifecycleTable;
  'audit.audit_log': { id: string; workspace_id: string; aggregate_type: string; aggregate_id: string };
}

const db = (): Kysely<LifecycleDb> => unitOfWorkKysely<LifecycleDb>();

const lifecycleRow = (e: LifecycleEntry) => ({
  id: e.id,
  workspace_id: e.workspaceId,
  aggregate_type: e.aggregateType,
  aggregate_id: e.aggregateId,
  sequence: e.sequence,
  kind: e.kind,
  transition: e.transition,
  from_state: e.fromState,
  to_state: e.toState,
  machine_version: e.machineVersion,
  revision_from: e.revisionFrom,
  revision_to: e.revisionTo,
  aggregate_version: e.aggregateVersion,
  occurred_at: e.occurredAt.toDate(),
  actor_type: e.actor.type,
  actor_id: e.actor.userId,
  actor_process: e.actor.process,
  origin: e.origin,
  reason: e.reason,
  correlation_id: e.correlationId,
  audit_log_id: e.auditLogId,
  event_ids: sql<string[]>`${[...e.eventIds]}::uuid[]`,
  event_types: sql<string[]>`${[...e.eventTypes]}::text[]`,
  journal_entries: sql<LifecycleTable['journal_entries']>`${JSON.stringify(e.journalEntries)}::jsonb`,
  detail_refs: sql<LifecycleTable['detail_refs']>`${JSON.stringify(e.detailRefs)}::jsonb`,
  changed_fields: sql<string[]>`${[...e.changedFields]}::text[]`,
  derived: e.derived,
});

/** Filas por sentencia en la inserción masiva (27 columnas ⇒ muy por debajo del límite de parámetros). */
const INSERT_CHUNK = 500;

/**
 * Almacén de `audit.lifecycle_transition` sobre la `PgUnitOfWork` en curso (misma transacción que el comando, INV-029;
 * RLS del workspace). Solo INSERT/SELECT: la tabla rechaza UPDATE/DELETE/TRUNCATE (grants + PF003).
 */
export class PgLifecycleStore implements LifecycleStore {
  async nextSequence(workspaceId: string, aggregateType: string, aggregateId: string): Promise<number> {
    const row = await db()
      .selectFrom('audit.lifecycle_transition')
      .select(sql<number>`coalesce(max(sequence), 0) + 1`.as('next'))
      .where('workspace_id', '=', workspaceId)
      .where('aggregate_type', '=', aggregateType)
      .where('aggregate_id', '=', aggregateId)
      .executeTakeFirstOrThrow();
    return Number(row.next);
  }

  /** Siguiente `sequence` de cada agregado (una consulta para todos; misma semántica que `nextSequence`). */
  async nextSequences(
    workspaceId: string,
    aggregates: readonly { readonly aggregateType: string; readonly aggregateId: string }[],
  ): Promise<readonly number[]> {
    if (aggregates.length === 0) return [];
    const rows = await sql<{ aggregate_type: string; aggregate_id: string; last: number }>`
      SELECT aggregate_type, aggregate_id::text AS aggregate_id, max(sequence) AS last
        FROM audit.lifecycle_transition
       WHERE workspace_id = ${workspaceId}
         AND (aggregate_type, aggregate_id) IN (
           SELECT * FROM unnest(${aggregates.map((a) => a.aggregateType)}::text[],
                                ${aggregates.map((a) => a.aggregateId)}::uuid[]))
       GROUP BY aggregate_type, aggregate_id`.execute(db());
    const last = new Map(rows.rows.map((r) => [`${r.aggregate_type}|${r.aggregate_id}`, Number(r.last)]));
    return aggregates.map((a) => (last.get(`${a.aggregateType}|${a.aggregateId}`) ?? 0) + 1);
  }

  async insert(e: LifecycleEntry): Promise<void> {
    await db().insertInto('audit.lifecycle_transition').values(lifecycleRow(e)).execute();
  }

  /** Inserción multi-fila de los pasos de una operación masiva. */
  async insertMany(entries: readonly LifecycleEntry[]): Promise<void> {
    for (let i = 0; i < entries.length; i += INSERT_CHUNK) {
      await db()
        .insertInto('audit.lifecycle_transition')
        .values(entries.slice(i, i + INSERT_CHUNK).map(lifecycleRow))
        .execute();
    }
  }

  async entriesOf(
    workspaceId: string,
    aggregateType: string,
    aggregateId: string,
  ): Promise<readonly LifecycleEntry[]> {
    const rows = await db()
      .selectFrom('audit.lifecycle_transition')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('aggregate_type', '=', aggregateType)
      .where('aggregate_id', '=', aggregateId)
      .orderBy('sequence')
      .execute();
    return rows.map(toEntry);
  }
}

function toEntry(r: LifecycleTable): LifecycleEntry {
  if (!isAuditOrigin(r.origin))
    throw new Error(`origen desconocido en audit.lifecycle_transition: ${r.origin}`);
  return lifecycleEntry({
    id: r.id,
    workspaceId: r.workspace_id,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    sequence: Number(r.sequence),
    kind: r.kind,
    transition: r.transition,
    fromState: r.from_state,
    toState: r.to_state,
    machineVersion: r.machine_version,
    revisionFrom: r.revision_from,
    revisionTo: r.revision_to,
    aggregateVersion: r.aggregate_version,
    occurredAt: Instant.fromDate(r.occurred_at),
    actor:
      r.actor_type === 'USER'
        ? { type: 'USER', userId: r.actor_id ?? '', process: null }
        : { type: r.actor_type, userId: null, process: r.actor_process ?? '' },
    origin: r.origin,
    reason: r.reason,
    correlationId: r.correlation_id,
    auditLogId: r.audit_log_id,
    eventIds: r.event_ids,
    eventTypes: r.event_types,
    journalEntries: r.journal_entries,
    detailRefs: r.detail_refs,
    changedFields: r.changed_fields,
    derived: r.derived,
  });
}

/** Fuente del backfill: agregados con auditoría no respaldada por el recorrido y su auditoría cronológica. */
export class PgLifecycleBackfillSource implements LifecycleBackfillSource {
  private readonly audit = new PgAuditLogStore();

  async aggregatesWithoutLifecycle(
    input: Parameters<LifecycleBackfillSource['aggregatesWithoutLifecycle']>[0],
  ): Promise<readonly { readonly aggregateType: string; readonly aggregateId: string }[]> {
    if (input.aggregateTypes.length === 0) return [];
    const { rows } = await sql<{ aggregate_type: string; aggregate_id: string }>`
      SELECT DISTINCT a.aggregate_id::text AS aggregate_id, a.aggregate_type
        FROM audit.audit_log a
       WHERE a.workspace_id = ${input.workspaceId}
         AND a.aggregate_type = ANY(${[...input.aggregateTypes]}::text[])
         AND (${input.afterAggregateId}::uuid IS NULL OR a.aggregate_id > ${input.afterAggregateId}::uuid)
         AND NOT EXISTS (
           SELECT 1 FROM audit.lifecycle_transition t
            WHERE t.workspace_id = a.workspace_id AND t.audit_log_id = a.id)
       ORDER BY 1, 2
       LIMIT ${input.limit}`.execute(db());
    return rows.map((r) => ({ aggregateType: r.aggregate_type, aggregateId: r.aggregate_id }));
  }

  async auditOf(
    workspaceId: string,
    aggregateType: string,
    aggregateId: string,
  ): Promise<readonly AuditRecord[]> {
    const out: AuditRecord[] = [];
    let after: { occurredAt: string; id: string } | undefined;
    for (;;) {
      const page = await this.audit.page({
        workspaceId,
        entities: [{ aggregateType, aggregateId }],
        ascending: true,
        ...(after ? { after } : {}),
        limit: 500,
      });
      out.push(...page);
      if (page.length < 500) return out;
      const last = page.at(-1) as AuditRecord;
      after = { occurredAt: last.occurredAt.toString(), id: last.id };
    }
  }
}

/** Unidad de trabajo del worker (`pf_worker`) con el contexto RLS del workspace. */
export const pgWorkerUnitOfWork = (pool: Pool): WorkerUnitOfWork => {
  const uow = new PgUnitOfWork(pool);
  return { run: (workspaceId, fn) => uow.run({ userId: null, workspaceId }, fn) };
};

/** Divergencia estado del agregado ↔ última transición (decisión 6). */
export interface LifecycleDivergence {
  readonly workspaceId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly recordedState: string;
  readonly actualState: string;
}

/**
 * Chequeo de consistencia del recorrido para UN workspace (lo invoca el job diario de integridad junto con
 * `VerifyLedgerIntegrity`, FR-LEDGER-015): `audit.lifecycle_state_divergences()` con la RLS del workspace.
 */
export async function findLifecycleDivergences(
  pool: Pool,
  workspaceId: string,
): Promise<readonly LifecycleDivergence[]> {
  return new PgUnitOfWork(pool).run({ userId: null, workspaceId }, async () => {
    const { rows } = await sql<{
      aggregate_type: string;
      aggregate_id: string;
      recorded_state: string;
      actual_state: string;
    }>`SELECT aggregate_type, aggregate_id::text AS aggregate_id, recorded_state, actual_state
         FROM audit.lifecycle_state_divergences()`.execute(db());
    return rows.map((r) => ({
      workspaceId,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      recordedState: r.recorded_state,
      actualState: r.actual_state,
    }));
  });
}
