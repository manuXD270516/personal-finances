import { unitOfWorkKysely } from '@pf/platform/api';
import { LocalDate } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { UnitOfWork } from '../application/ports/index.js';
import type { ReconciliationMarksQuery } from '../contracts/index.js';

/**
 * `ReconciliationMarksQuery` sobre PostgreSQL (add-financial-reports): fechas de extracto de las sesiones
 * `COMPLETED` de la cuenta en el rango, sin repetir. Lee solo el schema dueño de las conciliaciones.
 */
export class PgReconciliationMarksQuery implements ReconciliationMarksQuery {
  constructor(private readonly uow: UnitOfWork) {}

  closedStatementDates(
    input: Parameters<ReconciliationMarksQuery['closedStatementDates']>[0],
  ): Promise<readonly string[]> {
    const from = LocalDate.parse(input.from).toString();
    const to = LocalDate.parse(input.to).toString();
    return this.uow.run(input.workspaceId, async () => {
      const { rows } = await sql<{ d: string }>`
        SELECT DISTINCT statement_date::text AS d
          FROM txn.reconciliation
         WHERE workspace_id = ${input.workspaceId} AND account_id = ${input.accountId}::uuid
           AND status = 'COMPLETED' AND statement_date BETWEEN ${from}::date AND ${to}::date
         ORDER BY 1`.execute(unitOfWorkKysely());
      return rows.map((r) => r.d);
    });
  }
}
