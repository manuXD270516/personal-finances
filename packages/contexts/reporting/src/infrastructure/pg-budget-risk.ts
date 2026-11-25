import { unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';
import type { BudgetOverrunNoticeRepository } from '../application/ports/budget-risk.js';

/**
 * `reporting.budget_overrun_notice` (RLS forzada por workspace; openspec add-budget-overrun-risk, decisión 7): un registro
 * técnico por línea y periodo, que hace idempotente el aviso de riesgo de presupuesto. Corre en la unidad de trabajo del
 * paso de avisos (rol del worker con el contexto del workspace).
 */
export class PgBudgetOverrunNoticeRepository implements BudgetOverrunNoticeRepository {
  async insertIfAbsent(input: {
    readonly workspaceId: string;
    readonly periodId: string;
    readonly budgetLineId: string;
    readonly level: 'LIKELY';
    readonly estimatedDate: string | null;
    readonly notifiedAt: string;
  }): Promise<boolean> {
    const { rows } = await sql<{ budget_line_id: string }>`
      INSERT INTO reporting.budget_overrun_notice
        (workspace_id, period_id, budget_line_id, level, estimated_date, notified_at)
      VALUES (${input.workspaceId}, ${input.periodId}::uuid, ${input.budgetLineId}::uuid, ${input.level},
              ${input.estimatedDate}::date, ${input.notifiedAt}::timestamptz)
      ON CONFLICT (workspace_id, period_id, budget_line_id) DO NOTHING
      RETURNING budget_line_id::text AS budget_line_id`.execute(unitOfWorkKysely());
    return rows.length === 1;
  }
}
