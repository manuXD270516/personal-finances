import { unitOfWorkKysely } from '@pf/platform/api';
import { LocalDate, Money, currency as makeCurrency } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { CategoryLookupPort, CurrencyCatalog, UnitOfWork } from '../application/ports/index.js';
import type { AccountMovementRowDto, AccountMovementsQuery } from '../contracts/index.js';
import { groupMovements, toMovementLines, type MovementLegRow } from '../domain/account-movements.js';

interface LegQueryRow {
  account_id: string;
  business_date: string;
  transaction_id: string;
  kind: string;
  nature: 'ASSET' | 'LIABILITY';
  currency: string;
  leg_amount: string;
  split_amount: string | null;
  category_id: string | null;
}

/** Códigos de categoría de sistema reconocibles por id (workspace) para `systemCategoryCode`. */
export type SystemCategoryCodes = (workspaceId: string) => Promise<ReadonlyMap<string, string>>;

/** Resuelve los códigos de sistema que expone `CategoryLookupPort` (*Uncategorized*, *Fees* y gastos de préstamo). */
export function systemCategoryCodesFrom(categories: CategoryLookupPort): SystemCategoryCodes {
  return async (workspaceId) => {
    const out = new Map<string, string>();
    const add = (id: string | null, code: string) => {
      if (id !== null) out.set(id, code);
    };
    add(await categories.uncategorized(workspaceId, 'EXPENSE'), 'UNCATEGORIZED');
    add(await categories.uncategorized(workspaceId, 'INCOME'), 'UNCATEGORIZED_INCOME');
    add(await categories.fees(workspaceId), 'FEES');
    for (const code of ['INTEREST', 'LOAN_FEES', 'INSURANCE', 'TAXES'] as const) {
      add(await categories.loanExpense(workspaceId, code), code);
    }
    return out;
  };
}

/**
 * `AccountMovementsQuery` sobre PostgreSQL (openspec add-credit-cards, decisión 12). Lee las patas VIGENTES
 * (`superseded_in_revision IS NULL`: ante reversas y revisiones cuenta solo la revisión actual) de transacciones con
 * asiento activo (`POSTED | CLEARED | RECONCILED`, INV-023: nunca `PENDING` ni `VOIDED`) por el índice
 * `(workspace_id, account_id, transaction_date)` de `txn.transaction_leg`, sin joins cross-schema. La categoría de un
 * gasto o reembolso sale de sus porciones vigentes (cada una con el signo de su pata).
 */
export class PgAccountMovementsQuery implements AccountMovementsQuery {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly currencies: CurrencyCatalog,
    private readonly codes: SystemCategoryCodes,
  ) {}

  summarizeAccountMovements(input: {
    readonly workspaceId: string;
    readonly accountIds: readonly string[];
    readonly dateFrom: string;
    readonly dateTo: string;
    readonly groupBy: 'DAY' | 'TRANSACTION';
  }): Promise<readonly AccountMovementRowDto[]> {
    const from = LocalDate.parse(input.dateFrom).toString();
    const to = LocalDate.parse(input.dateTo).toString();
    if (input.accountIds.length === 0) return Promise.resolve([]);
    return this.uow.run(input.workspaceId, async () => {
      const { rows } = await sql<LegQueryRow>`
        SELECT l.account_id, l.transaction_date::text AS business_date, t.id AS transaction_id, t.kind,
               l.account_nature AS nature, l.currency, l.amount::text AS leg_amount,
               s.amount::text AS split_amount, s.category_id
          FROM txn.transaction_leg l
          JOIN txn.transaction t ON t.workspace_id = l.workspace_id AND t.id = l.transaction_id
          LEFT JOIN txn.transaction_split s
            ON t.kind IN ('EXPENSE', 'REFUND')
           AND s.workspace_id = t.workspace_id AND s.transaction_id = t.id AND s.superseded_in_revision IS NULL
         WHERE l.workspace_id = ${input.workspaceId}
           AND l.account_id = ANY(${[...input.accountIds]}::uuid[])
           AND l.superseded_in_revision IS NULL
           AND l.transaction_date BETWEEN ${from}::date AND ${to}::date
           AND t.status IN ('POSTED', 'CLEARED', 'RECONCILED')
         ORDER BY l.transaction_date, l.account_id, t.id, s.position`.execute(unitOfWorkKysely());
      if (rows.length === 0) return [];
      const scales = new Map<string, number>();
      const money = async (amount: string, code: string): Promise<Money> => {
        let scale = scales.get(code);
        if (scale === undefined) {
          scale = (await this.currencies.scaleOf(code)) ?? 18;
          scales.set(code, scale);
        }
        return Money.parse(amount, makeCurrency(code, scale));
      };
      const legs: MovementLegRow[] = [];
      for (const r of rows) {
        legs.push({
          accountId: r.account_id,
          businessDate: r.business_date,
          transactionId: r.transaction_id,
          kind: r.kind,
          nature: r.nature,
          legAmount: await money(r.leg_amount, r.currency),
          splitAmount: r.split_amount === null ? null : await money(r.split_amount, r.currency),
          categoryId: r.category_id,
        });
      }
      const codeById = legs.some((l) => l.categoryId !== null)
        ? await this.codes(input.workspaceId)
        : new Map<string, string>();
      const lines = toMovementLines(legs, (categoryId) => codeById.get(categoryId) ?? null);
      return groupMovements(lines, input.groupBy).map((g): AccountMovementRowDto => ({
        accountId: g.accountId,
        businessDate: g.businessDate,
        movementClass: g.movementClass,
        systemCategoryCode: g.systemCategoryCode,
        transactionId: g.transactionId,
        amount: g.amount.toJSON(),
      }));
    });
  }
}
