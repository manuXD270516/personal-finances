import type {
  ClassificationMergeParticipant,
  MergeApplyResult,
  MergeCount,
  MergeParticipantInput,
  MergePreviewResult,
} from '@pf/classification/contracts';
import { unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';

/**
 * Participante de COMMITMENTS en la fusión de categorías y contrapartes (openspec add-category-and-counterparty-merge,
 * decisión 4). Definiciones recurrentes `ACTIVE` o `PAUSED`: la categoría (o la contraparte) de su versión vigente pasa a
 * la destino como ANOTACIÓN: no crea versión, no cambia ocurrencias, montos ni cadencia (la migración
 * `commitments_definition_version_merge_update` solo deja actualizar esas dos columnas). Suscripciones no canceladas:
 * su contraparte pasa a la destino; el precio y su historial no cambian. Las definiciones terminadas y las
 * suscripciones canceladas son historia y conservan la origen (archivada, «fusionada en»).
 */
export class PgCommitmentsMergeParticipant implements ClassificationMergeParticipant {
  readonly context = 'commitments';

  private column(kind: MergeParticipantInput['kind']) {
    return kind === 'CATEGORY' ? sql.ref('v.category_id') : sql.ref('v.counterparty_id');
  }

  async preview(input: MergeParticipantInput): Promise<MergePreviewResult> {
    const db = unitOfWorkKysely();
    const { workspaceId, sourceId } = input;
    const defs = await sql<{ n: string }>`
      SELECT count(*)::text AS n
        FROM commitments.recurring_definition d
        JOIN commitments.recurring_definition_version v
          ON v.workspace_id = d.workspace_id AND v.definition_id = d.id AND v.version_no = d.current_version_no
       WHERE d.workspace_id = ${workspaceId} AND d.status IN ('ACTIVE', 'PAUSED')
         AND ${this.column(input.kind)} = ${sourceId}`.execute(db);
    const counts: MergeCount[] = [{ key: 'RECURRING_DEFINITIONS', count: Number(defs.rows[0]?.n ?? 0) }];
    if (input.kind === 'COUNTERPARTY') {
      const subs = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM commitments.subscription
         WHERE workspace_id = ${workspaceId} AND counterparty_id = ${sourceId} AND status <> 'CANCELLED'`.execute(
        db,
      );
      counts.push({ key: 'SUBSCRIPTIONS', count: Number(subs.rows[0]?.n ?? 0) });
    }
    return { counts, conflicts: [] };
  }

  async apply(input: MergeParticipantInput & { readonly operationId: string }): Promise<MergeApplyResult> {
    const db = unitOfWorkKysely();
    const { workspaceId, sourceId, targetId } = input;
    const set =
      input.kind === 'CATEGORY'
        ? sql`category_id = ${targetId}::uuid`
        : sql`counterparty_id = ${targetId}::uuid`;
    const moved = await sql<{ definition_id: string }>`
      UPDATE commitments.recurring_definition_version v SET ${set}
        FROM commitments.recurring_definition d
       WHERE d.workspace_id = ${workspaceId} AND d.status IN ('ACTIVE', 'PAUSED')
         AND v.workspace_id = d.workspace_id AND v.definition_id = d.id AND v.version_no = d.current_version_no
         AND ${this.column(input.kind)} = ${sourceId}
      RETURNING v.definition_id`.execute(db);
    if (moved.rows.length > 0) {
      await sql`
        UPDATE commitments.recurring_definition SET version = version + 1, updated_at = now()
         WHERE workspace_id = ${workspaceId} AND id = ANY(${moved.rows.map((r) => r.definition_id)}::uuid[])`.execute(
        db,
      );
    }
    const counts: MergeCount[] = [{ key: 'RECURRING_DEFINITIONS', count: moved.rows.length }];
    if (input.kind === 'COUNTERPARTY') {
      const subs = await sql<{ id: string }>`
        UPDATE commitments.subscription SET counterparty_id = ${targetId}, version = version + 1, updated_at = now()
         WHERE workspace_id = ${workspaceId} AND counterparty_id = ${sourceId} AND status <> 'CANCELLED'
        RETURNING id`.execute(db);
      counts.push({ key: 'SUBSCRIPTIONS', count: subs.rows.length });
    }
    return { counts };
  }
}
