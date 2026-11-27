import type {
  ClassificationMergeParticipant,
  MergeApplyResult,
  MergeConflict,
  MergeParticipantInput,
  MergePreviewResult,
} from '@pf/classification/contracts';
import { unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';

interface LineRow {
  readonly id: string;
  readonly label: string;
  /** Línea de la destino en el mismo plan o versión (`null` si no hay conflicto). */
  readonly other_id: string | null;
}

interface TemplateRow {
  readonly template_id: string;
  readonly template_name: string;
  readonly version_no: number;
  readonly version_id: string;
  readonly line_id: string;
  readonly other_id: string | null;
}

/**
 * Participante de PLANNING en la fusión de categorías (openspec add-category-and-counterparty-merge, decisión 4;
 * D494 y D495). Las contrapartes no tienen referencias en PLANNING.
 *
 * - Líneas de planes de periodos NO cerrados (`DRAFT`, `ACTIVE`, `REOPENED`): la línea de la origen pasa a la destino;
 *   si el plan ya tiene una línea de la destino ⇒ conflicto `BUDGET_LINE_EXISTS`. Los planes de periodos cerrados no
 *   cambian (sus reportes y snapshots tampoco).
 * - Templates activos cuya versión vigente tiene una línea de la origen: versión NUEVA con la línea retargeteada (las
 *   versiones son inmutables); si la versión vigente ya tiene la destino ⇒ conflicto `TEMPLATE_LINE_EXISTS`.
 *
 * Actualizaciones por conjunto, en la unidad de trabajo de la fusión.
 */
export class PgPlanningMergeParticipant implements ClassificationMergeParticipant {
  readonly context = 'planning';

  private async openLines(input: MergeParticipantInput): Promise<LineRow[]> {
    const r = await sql<LineRow>`
      SELECT bl.id::text AS id, p.label, o.id::text AS other_id
        FROM planning.budget_line bl
        JOIN planning.budget b ON b.workspace_id = bl.workspace_id AND b.id = bl.budget_id
        JOIN planning.financial_period p ON p.workspace_id = b.workspace_id AND p.id = b.period_id
        LEFT JOIN planning.budget_line o
               ON o.workspace_id = bl.workspace_id AND o.budget_id = bl.budget_id
              AND o.target_kind = 'CATEGORY' AND o.target_id = ${input.targetId}
       WHERE bl.workspace_id = ${input.workspaceId} AND bl.target_kind = 'CATEGORY'
         AND bl.target_id = ${input.sourceId} AND p.status <> 'CLOSED'
       ORDER BY p.label, bl.id`.execute(unitOfWorkKysely());
    return r.rows;
  }

  private async templates(input: MergeParticipantInput): Promise<TemplateRow[]> {
    const r = await sql<TemplateRow>`
      SELECT t.id::text AS template_id, t.name AS template_name, t.current_version_no AS version_no,
             v.id::text AS version_id, l.id::text AS line_id, o.id::text AS other_id
        FROM planning.budget_template t
        JOIN planning.budget_template_version v
          ON v.workspace_id = t.workspace_id AND v.template_id = t.id AND v.version_no = t.current_version_no
        JOIN planning.budget_template_line l
          ON l.workspace_id = v.workspace_id AND l.template_version_id = v.id
         AND l.target_kind = 'CATEGORY' AND l.target_id = ${input.sourceId}
        LEFT JOIN planning.budget_template_line o
               ON o.workspace_id = v.workspace_id AND o.template_version_id = v.id
              AND o.target_kind = 'CATEGORY' AND o.target_id = ${input.targetId}
       WHERE t.workspace_id = ${input.workspaceId} AND t.status = 'ACTIVE'
       ORDER BY t.name, t.id`.execute(unitOfWorkKysely());
    return r.rows;
  }

  async preview(input: MergeParticipantInput): Promise<MergePreviewResult> {
    if (input.kind !== 'CATEGORY') return { counts: [], conflicts: [] };
    const lines = await this.openLines(input);
    const templates = await this.templates(input);
    const conflicts: MergeConflict[] = [
      ...lines.flatMap((l) =>
        l.other_id === null
          ? []
          : [
              {
                reason: 'BUDGET_LINE_EXISTS',
                refs: [
                  { kind: 'BUDGET_LINE', id: l.id, label: l.label },
                  { kind: 'BUDGET_LINE', id: l.other_id, label: l.label },
                ],
              },
            ],
      ),
      ...templates.flatMap((t) =>
        t.other_id === null
          ? []
          : [
              {
                reason: 'TEMPLATE_LINE_EXISTS',
                refs: [
                  { kind: 'BUDGET_TEMPLATE_LINE', id: t.line_id, label: t.template_name },
                  { kind: 'BUDGET_TEMPLATE_LINE', id: t.other_id, label: t.template_name },
                ],
              },
            ],
      ),
    ];
    return {
      counts: [
        { key: 'BUDGET_LINES', count: lines.length },
        { key: 'TEMPLATES', count: templates.length },
      ],
      conflicts,
    };
  }

  async apply(input: MergeParticipantInput & { readonly operationId: string }): Promise<MergeApplyResult> {
    if (input.kind !== 'CATEGORY') return { counts: [] };
    const db = unitOfWorkKysely();
    const { workspaceId, sourceId, targetId, userId } = input;
    const lines = await sql<{ id: string }>`
      UPDATE planning.budget_line bl SET target_id = ${targetId}, version = bl.version + 1, updated_at = now()
        FROM planning.budget b, planning.financial_period p
       WHERE bl.workspace_id = ${workspaceId} AND bl.target_kind = 'CATEGORY' AND bl.target_id = ${sourceId}
         AND b.workspace_id = bl.workspace_id AND b.id = bl.budget_id
         AND p.workspace_id = b.workspace_id AND p.id = b.period_id AND p.status <> 'CLOSED'
      RETURNING bl.id`.execute(db);
    const templates = await this.templates(input);
    for (const t of templates) {
      const next = t.version_no + 1;
      const created = await sql<{ id: string }>`
        INSERT INTO planning.budget_template_version
          (id, workspace_id, template_id, version_no, based_on_version_no, change_note, created_by)
        VALUES (uuidv7(), ${workspaceId}, ${t.template_id}, ${next}, ${t.version_no},
                ${'Fusión de categorías'}, ${userId})
        RETURNING id::text AS id`.execute(db);
      const versionId = (created.rows[0] as { id: string }).id;
      await sql`
        INSERT INTO planning.budget_template_line
          (id, workspace_id, template_version_id, target_kind, target_id, nature, kind, planned_amount, min_amount,
           max_amount, percent, income_basis, rollover_policy, rollover_cap, thresholds, currency)
        SELECT uuidv7(), l.workspace_id, ${versionId}::uuid, l.target_kind,
               CASE WHEN l.target_kind = 'CATEGORY' AND l.target_id = ${sourceId} THEN ${targetId}::uuid
                    ELSE l.target_id END,
               l.nature, l.kind, l.planned_amount, l.min_amount, l.max_amount, l.percent, l.income_basis,
               l.rollover_policy, l.rollover_cap, l.thresholds, l.currency
          FROM planning.budget_template_line l
         WHERE l.workspace_id = ${workspaceId} AND l.template_version_id = ${t.version_id}::uuid`.execute(db);
      await sql`
        UPDATE planning.budget_template
           SET current_version_no = ${next}, version = version + 1, updated_at = now(), updated_by = ${userId}
         WHERE workspace_id = ${workspaceId} AND id = ${t.template_id}::uuid`.execute(db);
    }
    return {
      counts: [
        { key: 'BUDGET_LINES', count: lines.rows.length },
        { key: 'TEMPLATES', count: templates.length },
      ],
    };
  }
}
