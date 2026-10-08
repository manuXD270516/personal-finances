import { unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';
import type { LedgerActivityRangeQuery } from '../contracts/index.js';

/**
 * `LedgerActivityRangeQuery` (openspec add-financial-periods, tarea 4.3): fecha de negocio mínima y máxima de los
 * asientos del workspace por el índice `journal_entry_date_ix (workspace_id, entry_date)`, en la unidad de trabajo del
 * llamador (RLS del workspace; `pf_app` o `pf_worker`). Fechas como texto (sin el parser `date` → `Date` de `pg`).
 */
export class PgLedgerActivityRangeQuery implements LedgerActivityRangeQuery {
  async getActivityRange(
    workspaceId: string,
  ): Promise<{ readonly minEntryDate: string; readonly maxEntryDate: string } | null> {
    const { rows } = await sql<{ min_date: string | null; max_date: string | null }>`
      SELECT (SELECT entry_date::text FROM ledger.journal_entry
               WHERE workspace_id = ${workspaceId} ORDER BY entry_date ASC LIMIT 1) AS min_date,
             (SELECT entry_date::text FROM ledger.journal_entry
               WHERE workspace_id = ${workspaceId} ORDER BY entry_date DESC LIMIT 1) AS max_date`.execute(
      unitOfWorkKysely(),
    );
    const row = rows[0];
    if (!row?.min_date || !row.max_date) return null;
    return { minEntryDate: row.min_date, maxEntryDate: row.max_date };
  }
}
