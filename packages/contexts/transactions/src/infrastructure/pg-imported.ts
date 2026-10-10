import { unitOfWorkKysely } from '@pf/platform/api';
import { LocalDate, Money, currency as makeCurrency } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { CurrencyCatalog, ImportedRefReader, UnitOfWork } from '../application/ports/index.js';
import type {
  DuplicateCandidateDto,
  DuplicateCandidatesQuery,
  TransactionStatusQuery,
} from '../contracts/index.js';

/** Referencias externas de filas importadas (`imports.csv-row`) de transacciones no anuladas de una cuenta. */
export class PgImportedRefReader implements ImportedRefReader {
  async existingByRefs(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly namespace: string;
    readonly ids: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    if (input.ids.length === 0) return new Map();
    const { rows } = await sql<{ external_ref_id: string; id: string }>`
      SELECT t.external_ref_id, t.id
        FROM txn.transaction t
       WHERE t.workspace_id = ${input.workspaceId}
         AND t.account_id = ${input.accountId}
         AND t.external_ref_namespace = ${input.namespace}
         AND t.external_ref_id = ANY(${[...input.ids]}::text[])
         AND t.status <> 'VOIDED'`.execute(unitOfWorkKysely());
    return new Map(rows.map((r) => [r.external_ref_id, r.id]));
  }
}

interface CandidateRow {
  row_ref: string;
  transaction_id: string;
  kind: string;
  status: string;
  transaction_date: string;
  amount: string;
  currency: string;
  description: string | null;
  counterparty_id: string | null;
}

/**
 * `DuplicateCandidatesQuery.findForImport` (add-basic-csv-import, decisión 8): una sola sentencia set-based por lote
 * (`unnest` de las filas) sobre las PATAS vigentes de la cuenta —principal de gastos, ingresos, reembolsos y ajustes;
 * origen o destino de transferencias y conversiones—. La dirección sale del signo de la pata (débito +, crédito −:
 * una salida del usuario es una pata negativa) y el monto es el valor absoluto de la pata en la moneda de la cuenta.
 */
export class PgDuplicateCandidatesQuery implements DuplicateCandidatesQuery {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly currencies: CurrencyCatalog,
  ) {}

  findForImport(input: Parameters<DuplicateCandidatesQuery['findForImport']>[0]) {
    return this.uow.run(input.workspaceId, async () => {
      if (input.rows.length === 0) return [];
      const exclude = [...(input.excludeTransactionIds ?? [])];
      const refs = input.rows.map((r) => r.rowRef);
      const dates = input.rows.map((r) => LocalDate.parse(r.date).toString());
      const directions = input.rows.map((r) => r.direction);
      const amounts = input.rows.map((r) => r.amount.amount);
      const currencies = input.rows.map((r) => r.amount.currency);
      const { rows } = await sql<CandidateRow>`
        WITH probe(row_ref, probe_date, direction, amount, currency) AS (
          SELECT * FROM unnest(
            ${refs}::text[], ${dates}::date[], ${directions}::text[], ${amounts}::numeric[], ${currencies}::text[])
        )
        SELECT p.row_ref, t.id AS transaction_id, t.kind, t.status, t.transaction_date::text AS transaction_date,
               abs(l.amount)::text AS amount, l.currency, t.description, t.counterparty_id
          FROM probe p
          JOIN txn.transaction_leg l
            ON l.workspace_id = ${input.workspaceId}
           AND l.account_id = ${input.accountId}
           AND l.superseded_in_revision IS NULL
           AND l.role IN ('MAIN', 'SOURCE', 'TARGET')
           AND l.currency = p.currency
           AND abs(l.amount) = p.amount
           AND ((p.direction = 'OUT' AND l.amount < 0) OR (p.direction = 'IN' AND l.amount > 0))
           AND l.transaction_date BETWEEN p.probe_date - ${input.windowDays}::int AND p.probe_date + ${input.windowDays}::int
          JOIN txn.transaction t
            ON t.workspace_id = l.workspace_id AND t.id = l.transaction_id AND t.status <> 'VOIDED'
         WHERE NOT (t.id = ANY(${exclude}::uuid[]))
         ORDER BY p.row_ref, t.transaction_date, t.id`.execute(unitOfWorkKysely());
      const byRow = new Map<string, DuplicateCandidateDto[]>();
      for (const r of rows) {
        const scale = (await this.currencies.scaleOf(r.currency)) ?? 18;
        const list = byRow.get(r.row_ref) ?? [];
        list.push({
          transactionId: r.transaction_id,
          kind: r.kind,
          status: r.status,
          date: r.transaction_date,
          amount: Money.parse(r.amount, makeCurrency(r.currency, scale)).toJSON(),
          description: r.description,
          counterpartyId: r.counterparty_id,
        });
        byRow.set(r.row_ref, list);
      }
      return refs.map((rowRef) => ({ rowRef, candidates: byRow.get(rowRef) ?? [] }));
    });
  }
}

/** `TransactionStatusQuery`: estado actual por id (lectura sin bloqueo). */
export class PgTransactionStatusQuery implements TransactionStatusQuery {
  constructor(private readonly uow: UnitOfWork) {}

  statusOf(input: { readonly workspaceId: string; readonly transactionIds: readonly string[] }) {
    return this.uow.run(input.workspaceId, async () => {
      if (input.transactionIds.length === 0) return [];
      const { rows } = await sql<{ id: string; status: string }>`
        SELECT t.id, t.status FROM txn.transaction t
         WHERE t.workspace_id = ${input.workspaceId} AND t.id = ANY(${[...input.transactionIds]}::uuid[])
         ORDER BY t.id`.execute(unitOfWorkKysely());
      return rows.map((r) => ({ transactionId: r.id, status: r.status }));
    });
  }
}
