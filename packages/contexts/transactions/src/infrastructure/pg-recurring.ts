import { unitOfWorkKysely } from '@pf/platform/api';
import { LocalDate, Money, currency as makeCurrency } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { CurrencyCatalog, UnitOfWork } from '../application/ports/index.js';
import type {
  PendingFlowQuery,
  PendingFlowRowDto,
  TransactionLinkDto,
  TransactionLinkQuery,
} from '../contracts/index.js';

interface LinkRow {
  id: string;
  kind: string;
  status: string;
  business_date: string;
  amount: string;
  currency: string;
  account_id: string;
  to_account_id: string | null;
  counterparty_id: string | null;
  source: string;
  external_ref_namespace: string | null;
  external_ref_id: string | null;
}

const LINK_COLUMNS = sql`
  t.id, t.kind, t.status, t.transaction_date::text AS business_date, t.amount::text AS amount,
  t.currency, t.account_id, t.counterparty_id, t.source, t.external_ref_namespace, t.external_ref_id,
  (SELECT l.account_id FROM txn.transaction_leg l
    WHERE l.workspace_id = t.workspace_id AND l.transaction_id = t.id
      AND l.role = 'TARGET' AND l.superseded_in_revision IS NULL LIMIT 1) AS to_account_id`;

const ref = (r: { external_ref_namespace: string | null; external_ref_id: string | null }) =>
  r.external_ref_namespace !== null && r.external_ref_id !== null
    ? { namespace: r.external_ref_namespace, id: r.external_ref_id }
    : null;

async function money(currencies: CurrencyCatalog, amount: string, code: string) {
  const scale = (await currencies.scaleOf(code)) ?? 18;
  return Money.parse(amount, makeCurrency(code, scale)).toJSON();
}

/**
 * `TransactionLinkQuery` (add-recurrence-engine, decisión 10): lee la transacción con `FOR SHARE` de su fila, así que
 * una anulación concurrente (`FOR UPDATE`) espera a que termine el vínculo. La cuenta destino de una transferencia sale
 * de su pata `TARGET` vigente.
 */
export class PgTransactionLinkQuery implements TransactionLinkQuery {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly currencies: CurrencyCatalog,
  ) {}

  getForLink(input: { readonly workspaceId: string; readonly transactionId: string }) {
    return this.uow.run(input.workspaceId, async (): Promise<TransactionLinkDto | null> => {
      const [first] = await this.read(input.workspaceId, [input.transactionId], true);
      return first ?? null;
    });
  }

  getManyForLink(input: { readonly workspaceId: string; readonly transactionIds: readonly string[] }) {
    return this.uow.run(input.workspaceId, async (): Promise<readonly TransactionLinkDto[]> => {
      if (input.transactionIds.length === 0) return [];
      return this.read(input.workspaceId, input.transactionIds, false);
    });
  }

  listLinkCandidates(input: {
    readonly workspaceId: string;
    readonly accountIds: readonly string[];
    readonly from: string;
    readonly to: string;
  }) {
    const from = LocalDate.parse(input.from).toString();
    const to = LocalDate.parse(input.to).toString();
    return this.uow.run(input.workspaceId, async (): Promise<readonly TransactionLinkDto[]> => {
      if (input.accountIds.length === 0) return [];
      const { rows } = await sql<LinkRow>`
        SELECT ${LINK_COLUMNS}
          FROM txn.transaction t
         WHERE t.workspace_id = ${input.workspaceId}
           AND t.account_id = ANY(${[...input.accountIds]}::uuid[])
           AND t.status <> 'VOIDED'
           AND t.kind IN ('INCOME', 'EXPENSE', 'TRANSFER')
           AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
         ORDER BY t.transaction_date, t.id`.execute(unitOfWorkKysely());
      return this.toDtos(rows);
    });
  }

  private async read(
    workspaceId: string,
    ids: readonly string[],
    lock: boolean,
  ): Promise<TransactionLinkDto[]> {
    const { rows } = await sql<LinkRow>`
      SELECT ${LINK_COLUMNS}
        FROM txn.transaction t
       WHERE t.workspace_id = ${workspaceId} AND t.id = ANY(${[...ids]}::uuid[])
       ORDER BY t.id
       ${lock ? sql`FOR SHARE OF t` : sql``}`.execute(unitOfWorkKysely());
    return this.toDtos(rows);
  }

  private async toDtos(rows: readonly LinkRow[]): Promise<TransactionLinkDto[]> {
    const out: TransactionLinkDto[] = [];
    for (const r of rows) {
      out.push({
        transactionId: r.id,
        kind: r.kind,
        status: r.status,
        businessDate: r.business_date,
        amount: await money(this.currencies, r.amount, r.currency),
        accountId: r.account_id,
        toAccountId: r.kind === 'TRANSFER' ? r.to_account_id : null,
        counterpartyId: r.counterparty_id,
        source: r.source,
        externalRef: ref(r),
      });
    }
    return out;
  }
}

interface PendingRow extends LinkRow {
  description: string | null;
}

/** `PendingFlowQuery`: transacciones `PENDING` de ingreso, gasto y transferencia del workspace (sin asiento). */
export class PgPendingFlowQuery implements PendingFlowQuery {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly currencies: CurrencyCatalog,
  ) {}

  listPending(input: {
    readonly workspaceId: string;
    readonly accountIds?: readonly string[];
    readonly dateFrom?: string;
    readonly dateTo?: string;
  }) {
    const from = input.dateFrom ? LocalDate.parse(input.dateFrom).toString() : null;
    const to = input.dateTo ? LocalDate.parse(input.dateTo).toString() : null;
    const accounts = input.accountIds ? [...input.accountIds] : null;
    return this.uow.run(input.workspaceId, async (): Promise<readonly PendingFlowRowDto[]> => {
      const { rows } = await sql<PendingRow>`
        SELECT t.id, t.kind, t.status, t.transaction_date::text AS business_date, t.amount::text AS amount,
               t.currency, t.account_id, t.counterparty_id, t.source, t.description,
               t.external_ref_namespace, t.external_ref_id,
               (SELECT l.account_id FROM txn.transaction_leg l
                 WHERE l.workspace_id = t.workspace_id AND l.transaction_id = t.id
                   AND l.role = 'TARGET' AND l.superseded_in_revision IS NULL LIMIT 1) AS to_account_id
          FROM txn.transaction t
         WHERE t.workspace_id = ${input.workspaceId}
           AND t.status = 'PENDING'
           AND t.kind IN ('INCOME', 'EXPENSE', 'TRANSFER')
           AND (${from}::date IS NULL OR t.transaction_date >= ${from}::date)
           AND (${to}::date IS NULL OR t.transaction_date <= ${to}::date)
           AND (${accounts}::uuid[] IS NULL OR t.account_id = ANY(${accounts}::uuid[]))
         ORDER BY t.transaction_date, t.id`.execute(unitOfWorkKysely());
      const out: PendingFlowRowDto[] = [];
      for (const r of rows) {
        out.push({
          transactionId: r.id,
          kind: r.kind,
          businessDate: r.business_date,
          accountId: r.account_id,
          toAccountId: r.kind === 'TRANSFER' ? r.to_account_id : null,
          direction: r.kind === 'INCOME' ? 'IN' : 'OUT',
          amount: await money(this.currencies, r.amount, r.currency),
          description: r.description,
          source: r.source,
          externalRef: ref(r),
        });
      }
      return out;
    });
  }
}
