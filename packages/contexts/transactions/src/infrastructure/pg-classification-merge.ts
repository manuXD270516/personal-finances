import type { AuditEntry, LifecyclePort, LifecycleStepInput } from '@pf/audit/contracts';
import type {
  ClassificationMergeParticipant,
  ClosedDateRange,
  MergeApplyResult,
  MergeCount,
  MergeParticipantInput,
  MergePreviewResult,
} from '@pf/classification/contracts';
import { unitOfWorkKysely } from '@pf/platform/api';
import { sql, type RawBuilder } from 'kysely';

/**
 * Participante de TRANSACTIONS en la fusión de categorías y contrapartes (openspec add-category-and-counterparty-merge,
 * decisiones 1, 3 y 4; D494). Reasigna con actualizaciones por conjunto, en la unidad de trabajo de la fusión, solo
 * las porciones y transacciones cuya fecha de negocio NO cae en un periodo cerrado (mismo criterio de rango que
 * `PERIOD_CLOSED`: extremos inclusivos); las de periodos cerrados conservan la origen. No toca el ledger (INV-021): ni
 * asientos ni montos cambian. Solo las porciones vigentes (`superseded_in_revision IS NULL`); las revisiones
 * anteriores son historia. Cada transacción reasignada recibe una anotación en su recorrido con el `operationId`
 * (como la edición masiva) y sube su `version`.
 */
export class PgTransactionsMergeParticipant implements ClassificationMergeParticipant {
  readonly context = 'transactions';

  constructor(private readonly lifecycle: LifecyclePort) {}

  /** `true` si la fecha de `alias.transaction_date` cae en alguno de los rangos cerrados. */
  private closed(alias: string, ranges: readonly ClosedDateRange[]): RawBuilder<boolean> {
    if (ranges.length === 0) return sql<boolean>`false`;
    const from = ranges.map((r) => r.from);
    const to = ranges.map((r) => r.to);
    return sql<boolean>`EXISTS (
      SELECT 1 FROM unnest(${from}::date[], ${to}::date[]) AS r(f, t)
       WHERE ${sql.ref(`${alias}.transaction_date`)} BETWEEN r.f AND r.t)`;
  }

  async preview(input: MergeParticipantInput): Promise<MergePreviewResult> {
    const db = unitOfWorkKysely();
    const { workspaceId, sourceId, closedRanges } = input;
    if (input.kind === 'CATEGORY') {
      const r = await sql<{ open: string; kept: string }>`
        SELECT count(*) FILTER (WHERE NOT ${this.closed('t', closedRanges)})::text AS open,
               count(*) FILTER (WHERE ${this.closed('t', closedRanges)})::text AS kept
          FROM txn.transaction_split s
          JOIN txn.transaction t ON t.workspace_id = s.workspace_id AND t.id = s.transaction_id
         WHERE s.workspace_id = ${workspaceId} AND s.category_id = ${sourceId}
           AND s.superseded_in_revision IS NULL`.execute(db);
      const row = r.rows[0];
      return {
        counts: [
          { key: 'SPLITS_OPEN', count: Number(row?.open ?? 0) },
          { key: 'SPLITS_CLOSED_KEPT', count: Number(row?.kept ?? 0) },
        ],
        conflicts: [],
      };
    }
    const tx = await sql<{ open: string; kept: string }>`
      SELECT count(*) FILTER (WHERE NOT ${this.closed('t', closedRanges)})::text AS open,
             count(*) FILTER (WHERE ${this.closed('t', closedRanges)})::text AS kept
        FROM txn.transaction t
       WHERE t.workspace_id = ${workspaceId}
         AND (t.counterparty_id = ${sourceId}
              OR EXISTS (SELECT 1 FROM txn.transaction_split s
                          WHERE s.workspace_id = t.workspace_id AND s.transaction_id = t.id
                            AND s.superseded_in_revision IS NULL AND s.counterparty_id = ${sourceId}))`.execute(
      db,
    );
    const conv = await sql<{ n: string }>`
      SELECT count(DISTINCT transaction_id)::text AS n FROM txn.conversion_detail
       WHERE workspace_id = ${workspaceId} AND provider_counterparty_id = ${sourceId}`.execute(db);
    const row = tx.rows[0];
    return {
      counts: [
        { key: 'TRANSACTIONS_OPEN', count: Number(row?.open ?? 0) },
        { key: 'TRANSACTIONS_CLOSED_KEPT', count: Number(row?.kept ?? 0) },
        { key: 'CONVERSIONS', count: Number(conv.rows[0]?.n ?? 0) },
      ],
      conflicts: [],
    };
  }

  async apply(input: MergeParticipantInput & { readonly operationId: string }): Promise<MergeApplyResult> {
    const db = unitOfWorkKysely();
    const { workspaceId, sourceId, targetId, closedRanges, operationId } = input;
    const field = input.kind === 'CATEGORY' ? 'categoryId' : 'counterpartyId';
    let counts: MergeCount[];
    let affected: string[];
    if (input.kind === 'CATEGORY') {
      const moved = await sql<{ transaction_id: string }>`
        UPDATE txn.transaction_split s SET category_id = ${targetId}
          FROM txn.transaction t
         WHERE s.workspace_id = ${workspaceId} AND s.category_id = ${sourceId}
           AND s.superseded_in_revision IS NULL
           AND t.workspace_id = s.workspace_id AND t.id = s.transaction_id
           AND NOT ${this.closed('t', closedRanges)}
        RETURNING s.transaction_id`.execute(db);
      affected = [...new Set(moved.rows.map((r) => r.transaction_id))];
      const kept = await this.preview({ ...input, closedRanges });
      counts = [
        { key: 'SPLITS_OPEN', count: moved.rows.length },
        {
          key: 'SPLITS_CLOSED_KEPT',
          count: kept.counts.find((c) => c.key === 'SPLITS_CLOSED_KEPT')?.count ?? 0,
        },
      ];
    } else {
      const splits = await sql<{ transaction_id: string }>`
        UPDATE txn.transaction_split s SET counterparty_id = ${targetId}
          FROM txn.transaction t
         WHERE s.workspace_id = ${workspaceId} AND s.counterparty_id = ${sourceId}
           AND s.superseded_in_revision IS NULL
           AND t.workspace_id = s.workspace_id AND t.id = s.transaction_id
           AND NOT ${this.closed('t', closedRanges)}
        RETURNING s.transaction_id`.execute(db);
      const headers = await sql<{ id: string }>`
        UPDATE txn.transaction t SET counterparty_id = ${targetId}
         WHERE t.workspace_id = ${workspaceId} AND t.counterparty_id = ${sourceId}
           AND NOT ${this.closed('t', closedRanges)}
        RETURNING t.id`.execute(db);
      affected = [
        ...new Set([...splits.rows.map((r) => r.transaction_id), ...headers.rows.map((r) => r.id)]),
      ];
      // El proveedor de las conversiones es un dato descriptivo: pasa en todas las revisiones, también las cerradas.
      const conv = await sql<{ transaction_id: string }>`
        UPDATE txn.conversion_detail SET provider_counterparty_id = ${targetId}
         WHERE workspace_id = ${workspaceId} AND provider_counterparty_id = ${sourceId}
        RETURNING transaction_id`.execute(db);
      const kept = await sql<{ n: string }>`
        SELECT count(*)::text AS n
          FROM txn.transaction t
         WHERE t.workspace_id = ${workspaceId}
           AND (t.counterparty_id = ${sourceId}
                OR EXISTS (SELECT 1 FROM txn.transaction_split s
                            WHERE s.workspace_id = t.workspace_id AND s.transaction_id = t.id
                              AND s.superseded_in_revision IS NULL AND s.counterparty_id = ${sourceId}))`.execute(
        db,
      );
      counts = [
        { key: 'TRANSACTIONS_OPEN', count: affected.length },
        { key: 'TRANSACTIONS_CLOSED_KEPT', count: Number(kept.rows[0]?.n ?? 0) },
        { key: 'CONVERSIONS', count: new Set(conv.rows.map((r) => r.transaction_id)).size },
      ];
    }
    if (affected.length === 0) return { counts };
    const bumped = await sql<{ id: string; version: number }>`
      UPDATE txn.transaction SET version = version + 1, updated_at = now()
       WHERE workspace_id = ${workspaceId} AND id = ANY(${affected}::uuid[])
      RETURNING id, version`.execute(db);
    const items = bumped.rows.map((t) => {
      const entry: AuditEntry = {
        workspaceId,
        action: 'transactions.transaction.merge_reassigned',
        aggregateType: 'Transaction',
        aggregateId: t.id,
        aggregateVersion: t.version,
        correlationId: operationId,
        actor: { type: 'USER', userId: input.userId },
        changes: [
          { field, before: sourceId, after: targetId },
          { field: 'mergeOperationId', before: null, after: operationId },
        ],
      };
      const steps: LifecycleStepInput[] = [
        { kind: 'ANNOTATION', changedFields: [field], detailRefs: { mergeOperationId: operationId } },
      ];
      return { entry, steps };
    });
    if (this.lifecycle.recordMany) await this.lifecycle.recordMany(items);
    else for (const i of items) await this.lifecycle.record(i.entry, i.steps);
    return { counts };
  }
}
