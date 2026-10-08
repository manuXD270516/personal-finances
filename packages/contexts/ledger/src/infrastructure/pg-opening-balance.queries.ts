import { unitOfWorkKysely } from '@pf/platform/api';
import { canonicalDecimal } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { LedgerOpeningBalanceQuery, MoneyDto } from '../contracts/index.js';

/**
 * `LedgerOpeningBalanceQuery` (openspec add-reconciliation, tarea 4.2): Σ de los postings de los asientos de apertura
 * (`OPENING`) sobre la cuenta contable 1:1 de la cuenta del usuario, con fecha ≤ `asOf`, por el índice
 * `posting_balance_ix` y `journal_entry_source_ix`, en la unidad de trabajo del llamador (RLS del workspace).
 * Devuelve el monto con signo contable (débito +, crédito −) en la forma decimal canónica.
 */
export class PgLedgerOpeningBalanceQuery implements LedgerOpeningBalanceQuery {
  async getOpeningBalance(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly asOf: string;
  }): Promise<MoneyDto | null> {
    const { rows } = await sql<{ currency: string; total: string }>`
      SELECT p.currency, SUM(p.amount)::text AS total
        FROM ledger.ledger_account la
        JOIN ledger.posting p
          ON p.workspace_id = la.workspace_id AND p.ledger_account_id = la.id
        JOIN ledger.journal_entry je
          ON je.workspace_id = p.workspace_id AND je.id = p.journal_entry_id
       WHERE la.workspace_id = ${input.workspaceId}
         AND la.source_account_id = ${input.accountId}
         AND je.entry_type = 'OPENING'
         AND je.entry_date <= ${input.asOf}::date
       GROUP BY p.currency`.execute(unitOfWorkKysely());
    const row = rows[0];
    return row ? { amount: canonicalDecimal(row.total), currency: row.currency } : null;
  }
}
