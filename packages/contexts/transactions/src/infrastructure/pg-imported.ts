import { unitOfWorkKysely } from '@pf/platform/api';
import { LocalDate, Money, currency as makeCurrency } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { CurrencyCatalog, ImportedRefReader, UnitOfWork } from '../application/ports/index.js';
import type {
  DuplicateCandidateDto,
  DuplicateCandidatesQuery,
  TransactionStatusQuery,
} from '../contracts/index.js';
import { scoreToUnits } from '../contracts/duplicate-confidence.js';
import { daysBetween } from '../domain/duplicate-detector.js';
import { DuplicateScore } from '../domain/duplicate-score.js';

/** Referencias externas de filas importadas (`imports.csv-row`) de transacciones no anuladas de una cuenta. */
export class PgImportedRefReader implements ImportedRefReader {
  async lockAccount(input: { readonly workspaceId: string; readonly accountId: string }): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'txn.import:' + input.workspaceId + ':' + input.accountId}, 0))`.execute(
      unitOfWorkKysely(),
    );
  }

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
         AND (t.account_id = ${input.accountId}
              OR EXISTS (SELECT 1 FROM txn.transaction_leg l
                          WHERE l.workspace_id = t.workspace_id AND l.transaction_id = t.id
                            AND l.account_id = ${input.accountId} AND l.superseded_in_revision IS NULL))
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
  external_ref_namespace: string | null;
  external_ref_id: string | null;
}

/** Referencias que identifican el movimiento ante el banco o un proveedor (no las huellas de fila CSV). */
const isBankNamespace = (namespace: string | null): boolean =>
  namespace !== null && (namespace.startsWith('imports.ext:') || namespace.startsWith('imports.provider:'));

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
               abs(l.amount)::text AS amount, l.currency, t.description, t.counterparty_id,
               t.external_ref_namespace, t.external_ref_id
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
      const scoringOf = new Map(
        input.rows.map((r) => [
          r.rowRef,
          r.scoring === true ||
          r.description !== undefined ||
          r.counterpartyId !== undefined ||
          r.externalId !== undefined
            ? r
            : null,
        ]),
      );
      const scales = new Map<string, number>();
      const byRow = new Map<string, DuplicateCandidateDto[]>();
      for (const r of rows) {
        let scale = scales.get(r.currency);
        if (scale === undefined) {
          scale = (await this.currencies.scaleOf(r.currency)) ?? 18;
          scales.set(r.currency, scale);
        }
        const list = byRow.get(r.row_ref) ?? [];
        const bank = isBankNamespace(r.external_ref_namespace);
        const base: DuplicateCandidateDto = {
          transactionId: r.transaction_id,
          kind: r.kind,
          status: r.status,
          date: r.transaction_date,
          amount: Money.parse(r.amount, makeCurrency(r.currency, scale)).toJSON(),
          description: r.description,
          counterpartyId: r.counterparty_id,
        };
        const probe = scoringOf.get(r.row_ref);
        if (probe) {
          const rowDate = LocalDate.parse(probe.date).toString();
          const scored = DuplicateScore.of(
            {
              date: rowDate,
              description: probe.description ?? null,
              counterpartyId: probe.counterpartyId ?? null,
              externalId: probe.externalId ?? null,
            },
            {
              transactionId: r.transaction_id,
              date: r.transaction_date,
              description: r.description,
              counterpartyId: r.counterparty_id,
              bankExternalId: bank ? r.external_ref_id : null,
            },
          );
          list.push({ ...base, score: scored.score, signals: scored.signals, hasBankExternalRef: bank });
        } else {
          list.push(base);
        }
        byRow.set(r.row_ref, list);
      }
      return refs.map((rowRef) => {
        const probe = scoringOf.get(rowRef);
        const list = byRow.get(rowRef) ?? [];
        if (!probe) return { rowRef, candidates: list };
        // Orden determinista: puntaje desc, menor diferencia de días, id (add-import-pipeline).
        const sorted = [...list].sort((x, y) => {
          const dScore = scoreToUnits(y.score as string) - scoreToUnits(x.score as string);
          if (dScore !== 0n) return dScore > 0n ? 1 : -1;
          const dDays = daysBetween(x.date, probe.date) - daysBetween(y.date, probe.date);
          if (dDays !== 0) return dDays;
          return x.transactionId < y.transactionId ? -1 : x.transactionId > y.transactionId ? 1 : 0;
        });
        return { rowRef, candidates: sorted };
      });
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
