import type {
  ClassificationMergeParticipant,
  MergeApplyResult,
  MergeParticipantInput,
  MergePreviewResult,
} from '@pf/classification/contracts';
import { unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';

/**
 * Participante de REPORTING en la fusión de categorías (openspec add-category-and-counterparty-merge, decisión 4):
 * las categorías esenciales del disponible reemplazan la origen por la destino sin repetirla (si la lista ya tiene la
 * destino, la origen simplemente sale). REPORTING lee directo de las transacciones, así que no hay caché que invalidar.
 * Las contrapartes no se usan en esta lista.
 */
export class PgReportingMergeParticipant implements ClassificationMergeParticipant {
  readonly context = 'reporting';

  async preview(input: MergeParticipantInput): Promise<MergePreviewResult> {
    if (input.kind !== 'CATEGORY') return { counts: [], conflicts: [] };
    const r = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM reporting.spendable_essential_category
       WHERE workspace_id = ${input.workspaceId} AND category_id = ${input.sourceId}`.execute(
      unitOfWorkKysely(),
    );
    return { counts: [{ key: 'ESSENTIALS', count: Number(r.rows[0]?.n ?? 0) }], conflicts: [] };
  }

  async apply(input: MergeParticipantInput & { readonly operationId: string }): Promise<MergeApplyResult> {
    if (input.kind !== 'CATEGORY') return { counts: [] };
    const db = unitOfWorkKysely();
    const { workspaceId, sourceId, targetId } = input;
    const had = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM reporting.spendable_essential_category
       WHERE workspace_id = ${workspaceId} AND category_id = ${sourceId}`.execute(db);
    const count = Number(had.rows[0]?.n ?? 0);
    if (count > 0) {
      await sql`
        INSERT INTO reporting.spendable_essential_category (workspace_id, category_id)
        VALUES (${workspaceId}, ${targetId})
        ON CONFLICT (workspace_id, category_id) DO NOTHING`.execute(db);
      await sql`
        DELETE FROM reporting.spendable_essential_category
         WHERE workspace_id = ${workspaceId} AND category_id = ${sourceId}`.execute(db);
    }
    return { counts: [{ key: 'ESSENTIALS', count }] };
  }
}
