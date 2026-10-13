import { unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';
import type { FirstBalanceDateQuery } from '../contracts/index.js';

/**
 * `FirstBalanceDateQuery` (openspec add-crypto-rate-providers, decisión 6): fecha de negocio mínima de los postings
 * sobre cuentas del usuario (ASSET/LIABILITY) agrupada por moneda, en la unidad de trabajo del llamador (RLS del
 * workspace; `pf_app` o `pf_worker`). Fechas como texto (sin el parser `date` → `Date` de `pg`).
 */
export class PgFirstBalanceDateQuery implements FirstBalanceDateQuery {
  async byCurrency(input: {
    readonly workspaceId: string;
  }): Promise<readonly { readonly currency: string; readonly firstDate: string }[]> {
    const { rows } = await sql<{ currency: string; first_date: string }>`
      SELECT p.currency, min(p.entry_date)::text AS first_date
        FROM ledger.posting p
       WHERE p.workspace_id = ${input.workspaceId}
         AND p.account_type IN ('ASSET', 'LIABILITY')
       GROUP BY p.currency
       ORDER BY p.currency`.execute(unitOfWorkKysely());
    return rows.map((r) => ({ currency: r.currency, firstDate: r.first_date }));
  }
}
