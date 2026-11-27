import type {
  ClassificationMergeParticipant,
  MergeApplyResult,
  MergeParticipantInput,
  MergePreviewResult,
} from '@pf/classification/contracts';
import { unitOfWorkKysely } from '@pf/platform/api';
import { sql, type RawBuilder } from 'kysely';

const OPEN = ['AWAITING_MAPPING', 'AWAITING_REVIEW'];

interface Paths {
  /** Ruta JSON del valor dentro de `proposal` (arreglo de Postgres). */
  readonly proposalPath: string;
  readonly proposalKey: string;
  readonly proposalOf: RawBuilder<string | null>;
  readonly edit: string;
  readonly suggested: string;
}

/**
 * Participante de IMPORTS en la fusión de categorías y contrapartes (openspec add-category-and-counterparty-merge,
 * decisión 4): las filas de importaciones todavía no persistidas (`AWAITING_MAPPING` o `AWAITING_REVIEW`) que
 * tienen la origen en su propuesta de clasificación, en las ediciones del usuario o en la sugerencia por historial pasan
 * a la destino; al aprobar la importación el gasto se registra en la destino. Las importaciones terminadas son historia.
 */
export class PgImportsMergeParticipant implements ClassificationMergeParticipant {
  readonly context = 'imports';

  private paths(kind: MergeParticipantInput['kind']): Paths {
    return kind === 'CATEGORY'
      ? {
          proposalPath: '{category,value}',
          proposalKey: 'category',
          proposalOf: sql<string | null>`s.proposal->'category'->>'value'`,
          edit: 'categoryId',
          suggested: 'categoryId',
        }
      : {
          proposalPath: '{counterparty,value}',
          proposalKey: 'counterparty',
          proposalOf: sql<string | null>`s.proposal->'counterparty'->>'value'`,
          edit: 'counterpartyId',
          suggested: 'counterpartyId',
        };
  }

  private matches(input: MergeParticipantInput, p: Paths): RawBuilder<boolean> {
    return sql<boolean>`(${p.proposalOf} = ${input.sourceId}
      OR s.edits->>${p.edit} = ${input.sourceId}
      OR s.suggested_category->>${p.suggested} = ${input.sourceId})`;
  }

  async preview(input: MergeParticipantInput): Promise<MergePreviewResult> {
    const p = this.paths(input.kind);
    const r = await sql<{ n: string }>`
      SELECT count(*)::text AS n
        FROM imports.staged_transaction s
        JOIN imports.import_job j ON j.workspace_id = s.workspace_id AND j.id = s.import_job_id
       WHERE s.workspace_id = ${input.workspaceId} AND j.status = ANY(${OPEN}::text[])
         AND ${this.matches(input, p)}`.execute(unitOfWorkKysely());
    return { counts: [{ key: 'IMPORT_ROWS', count: Number(r.rows[0]?.n ?? 0) }], conflicts: [] };
  }

  async apply(input: MergeParticipantInput & { readonly operationId: string }): Promise<MergeApplyResult> {
    const p = this.paths(input.kind);
    const to = JSON.stringify(input.targetId);
    const moved = await sql<{ id: string }>`
      UPDATE imports.staged_transaction s SET
        proposal = CASE WHEN ${p.proposalOf} = ${input.sourceId}
                        THEN jsonb_set(s.proposal, ${p.proposalPath}::text[], ${to}::jsonb) ELSE s.proposal END,
        edits = CASE WHEN s.edits->>${p.edit} = ${input.sourceId}
                     THEN jsonb_set(s.edits, ARRAY[${p.edit}]::text[], ${to}::jsonb) ELSE s.edits END,
        suggested_category = CASE WHEN s.suggested_category->>${p.suggested} = ${input.sourceId}
                                  THEN jsonb_set(s.suggested_category, ARRAY[${p.suggested}]::text[], ${to}::jsonb)
                                  ELSE s.suggested_category END
        FROM imports.import_job j
       WHERE s.workspace_id = ${input.workspaceId} AND j.workspace_id = s.workspace_id AND j.id = s.import_job_id
         AND j.status = ANY(${OPEN}::text[]) AND ${this.matches(input, p)}
      RETURNING s.id`.execute(unitOfWorkKysely());
    return { counts: [{ key: 'IMPORT_ROWS', count: moved.rows.length }] };
  }
}
