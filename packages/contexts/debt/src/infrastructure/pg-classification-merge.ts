import type {
  ClassificationMergeParticipant,
  MergeApplyResult,
  MergeParticipantInput,
  MergePreviewResult,
} from '@pf/classification/contracts';
import { unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';

/**
 * Participante de DEBT en la fusión de contrapartes (openspec add-category-and-counterparty-merge, decisión 4): el
 * prestamista de los préstamos pasa a la destino. Los montos, la tabla de amortización y los asientos no cambian.
 * Las categorías de los gastos de un préstamo son categorías de sistema (no se fusionan como origen).
 */
export class PgDebtMergeParticipant implements ClassificationMergeParticipant {
  readonly context = 'debt';

  async preview(input: MergeParticipantInput): Promise<MergePreviewResult> {
    if (input.kind !== 'COUNTERPARTY') return { counts: [], conflicts: [] };
    const r = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM debt.loan
       WHERE workspace_id = ${input.workspaceId} AND lender_counterparty_id = ${input.sourceId}`.execute(
      unitOfWorkKysely(),
    );
    return { counts: [{ key: 'LOANS', count: Number(r.rows[0]?.n ?? 0) }], conflicts: [] };
  }

  async apply(input: MergeParticipantInput & { readonly operationId: string }): Promise<MergeApplyResult> {
    if (input.kind !== 'COUNTERPARTY') return { counts: [] };
    const moved = await sql<{ id: string }>`
      UPDATE debt.loan SET lender_counterparty_id = ${input.targetId}, version = version + 1, updated_at = now()
       WHERE workspace_id = ${input.workspaceId} AND lender_counterparty_id = ${input.sourceId}
      RETURNING id`.execute(unitOfWorkKysely());
    return { counts: [{ key: 'LOANS', count: moved.rows.length }] };
  }
}
