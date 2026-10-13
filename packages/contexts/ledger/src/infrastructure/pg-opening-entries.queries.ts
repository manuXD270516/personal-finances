import { unitOfWorkKysely } from '@pf/platform/api';
import { canonicalDecimal } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { LedgerOpeningEntriesQuery, OpeningEntryDto } from '../contracts/index.js';

/**
 * `LedgerOpeningEntriesQuery` (openspec fix-phase-4-gaps, tarea 4.1): postings de los asientos de apertura (`OPENING`)
 * sobre la cuenta contable 1:1 de cada cuenta del usuario, con fecha en el rango, agrupados por cuenta, fecha y moneda.
 * El signo es el PRESENTADO (activo tal cual; pasivo negado, FR-LEDGER-012). En la unidad de trabajo del llamador.
 */
export class PgLedgerOpeningEntriesQuery implements LedgerOpeningEntriesQuery {
  async listOpeningEntries(input: {
    readonly workspaceId: string;
    readonly accountIds: readonly string[];
    readonly from: string;
    readonly to: string;
  }): Promise<readonly OpeningEntryDto[]> {
    if (input.accountIds.length === 0) return [];
    const { rows } = await sql<{ account_id: string; entry_date: string; currency: string; total: string }>`
      SELECT la.source_account_id AS account_id, je.entry_date::text AS entry_date, p.currency,
             SUM(CASE WHEN la.type IN ('ASSET', 'EXPENSE') THEN p.amount ELSE -p.amount END)::text AS total
        FROM ledger.ledger_account la
        JOIN ledger.posting p
          ON p.workspace_id = la.workspace_id AND p.ledger_account_id = la.id
        JOIN ledger.journal_entry je
          ON je.workspace_id = p.workspace_id AND je.id = p.journal_entry_id
       WHERE la.workspace_id = ${input.workspaceId}
         AND la.source_account_id = ANY(${[...input.accountIds]}::uuid[])
         AND je.entry_type = 'OPENING'
         AND je.entry_date BETWEEN ${input.from}::date AND ${input.to}::date
       GROUP BY la.source_account_id, je.entry_date, p.currency
       ORDER BY je.entry_date, la.source_account_id`.execute(unitOfWorkKysely());
    return rows.map((r) => ({
      accountId: r.account_id,
      entryDate: r.entry_date,
      amount: { amount: canonicalDecimal(r.total), currency: r.currency },
    }));
  }
}
