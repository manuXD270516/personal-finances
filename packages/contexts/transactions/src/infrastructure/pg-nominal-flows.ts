import { unitOfWorkKysely } from '@pf/platform/api';
import { Money, currency as makeCurrency, LocalDate } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { CurrencyCatalog, UnitOfWork } from '../application/ports/index.js';
import type {
  CounterpartyCategoryUsageQuery,
  NominalFlowQuery,
  NominalFlowRowDto,
} from '../contracts/index.js';

interface FlowRow {
  business_date: string;
  nature: 'INCOME' | 'EXPENSE';
  category_id: string;
  currency: string;
  amount: string;
}

/**
 * `SummarizeNominalFlows` sobre PostgreSQL (openspec add-basic-dashboard, design.md decisión 1): Σ de las porciones
 * VIGENTES (`superseded_in_revision IS NULL`) de transacciones con asiento activo (`POSTED | CLEARED | RECONCILED`,
 * INV-023), agrupado por fecha de negocio, naturaleza, categoría y moneda. Es el mismo conjunto que los postings a
 * `INCOME:*`/`EXPENSE:*` del ledger (cada posting nominal lleva el `split_id` de su porción, FR-LEDGER-008), leído en
 * el schema dueño de los splits sin joins cross-schema:
 *   INCOME → ingreso (+); EXPENSE → gasto (+); REFUND → gasto (−, en la fecha del reembolso);
 *   TRANSFER / CONVERSION → solo sus porciones de comisión (gasto +, categoría *Fees*); ADJUSTMENT no tiene porciones.
 * El principal de transferencias y conversiones, los saldos iniciales y los ajustes nunca son flujo (docs/14 §4.3).
 */
export class PgNominalFlowQuery implements NominalFlowQuery {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly currencies: CurrencyCatalog,
  ) {}

  summarizeNominalFlows(input: {
    readonly workspaceId: string;
    readonly dateFrom: string;
    readonly dateTo: string;
  }): Promise<readonly NominalFlowRowDto[]> {
    const from = LocalDate.parse(input.dateFrom).toString();
    const to = LocalDate.parse(input.dateTo).toString();
    return this.uow.run(input.workspaceId, async () => {
      const { rows } = await sql<FlowRow>`
        SELECT t.transaction_date::text AS business_date,
               CASE WHEN t.kind = 'INCOME' THEN 'INCOME' ELSE 'EXPENSE' END AS nature,
               s.category_id, s.currency,
               (SUM(CASE WHEN t.kind = 'REFUND' THEN -s.amount ELSE s.amount END))::text AS amount
          FROM txn.transaction t
          JOIN txn.transaction_split s
            ON s.workspace_id = t.workspace_id AND s.transaction_id = t.id AND s.superseded_in_revision IS NULL
         WHERE t.workspace_id = ${input.workspaceId}
           AND t.status IN ('POSTED', 'CLEARED', 'RECONCILED')
           AND t.kind IN ('INCOME', 'EXPENSE', 'REFUND', 'TRANSFER', 'CONVERSION')
           AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
         GROUP BY 1, 2, 3, 4
         ORDER BY 1, 2, 4, 3`.execute(unitOfWorkKysely());
      const scales = new Map<string, number>();
      const out: NominalFlowRowDto[] = [];
      for (const r of rows) {
        let scale = scales.get(r.currency);
        if (scale === undefined) {
          scale = (await this.currencies.scaleOf(r.currency)) ?? 18;
          scales.set(r.currency, scale);
        }
        out.push({
          businessDate: r.business_date,
          nature: r.nature,
          categoryId: r.category_id,
          amount: Money.parse(r.amount, makeCurrency(r.currency, scale)).toJSON(),
        });
      }
      return out;
    });
  }
}

/**
 * `CounterpartyCategoryUsageQuery` sobre PostgreSQL (add-classification 5.3/1.3): reemplaza el stub sin historial que
 * dejaba la sugerencia `LAST_USED` siempre en `NONE`. Lee solo el schema dueño de los splits (sin joins cross-schema).
 */
export class PgCounterpartyCategoryUsage implements CounterpartyCategoryUsageQuery {
  constructor(private readonly uow: UnitOfWork) {}

  lastCategoryUsed(input: {
    readonly workspaceId: string;
    readonly counterpartyId: string;
    readonly kind: 'EXPENSE' | 'INCOME';
  }): Promise<string | null> {
    const kinds = input.kind === 'INCOME' ? ['INCOME'] : ['EXPENSE', 'REFUND'];
    return this.uow.run(input.workspaceId, async () => {
      const { rows } = await sql<{ category_id: string }>`
        SELECT s.category_id
          FROM txn.transaction t
          JOIN txn.transaction_split s
            ON s.workspace_id = t.workspace_id AND s.transaction_id = t.id AND s.superseded_in_revision IS NULL
         WHERE t.workspace_id = ${input.workspaceId}
           AND t.status <> 'VOIDED'
           AND t.kind = ANY(${kinds}::text[])
           AND COALESCE(s.counterparty_id, t.counterparty_id) = ${input.counterpartyId}::uuid
         ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC, s.position
         LIMIT 1`.execute(unitOfWorkKysely());
      return rows[0]?.category_id ?? null;
    });
  }
}
