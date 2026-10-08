import { unitOfWorkKysely } from '@pf/platform/api';
import { Money, currency as makeCurrency, LocalDate } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { CategoryLookupPort, CurrencyCatalog, UnitOfWork } from '../application/ports/index.js';
import type {
  ClosingFindingDetailDto,
  ClosingFindingDto,
  ClosingRangeInput,
  TransactionsClosingQuery,
} from '../contracts/index.js';
import { DUPLICATE_WINDOW_DAYS, findDuplicates, type TransactionStatus } from '../domain/index.js';

/** Máximo de detalles por hallazgo (design.md de add-month-closing). */
const MAX_DETAILS = 50;

interface SumRow {
  currency: string;
  total: string;
}
interface DetailRow {
  ref_id: string;
  label: string | null;
  date: string;
  amount: string;
  currency: string;
}

/**
 * `TransactionsClosingQuery` sobre PostgreSQL (openspec add-month-closing): lecturas del checklist y del snapshot de
 * cierre. Sin efectos; corre en la unidad de trabajo del llamador (RLS del workspace). Solo lee el schema dueño
 * (`txn.*`), sin joins cross-schema; las categorías de sistema vienen de la API pública de CLASSIFICATION.
 */
export class PgTransactionsClosingQuery implements TransactionsClosingQuery {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly currencies: CurrencyCatalog,
    private readonly categories: CategoryLookupPort,
  ) {}

  countPendingInRange(input: ClosingRangeInput): Promise<ClosingFindingDto> {
    const { from, to } = range(input);
    return this.uow.run(input.workspaceId, async () => {
      const sums = await sql<SumRow & { n: number }>`
        SELECT t.currency, SUM(t.amount)::text AS total, COUNT(*)::int AS n
          FROM txn.transaction t
         WHERE t.workspace_id = ${input.workspaceId} AND t.status = 'PENDING'
           AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
         GROUP BY t.currency ORDER BY t.currency`.execute(unitOfWorkKysely());
      const details = await sql<DetailRow>`
        SELECT t.id AS ref_id, COALESCE(NULLIF(t.description, ''), t.kind) AS label,
               t.transaction_date::text AS date, t.amount::text AS amount, t.currency
          FROM txn.transaction t
         WHERE t.workspace_id = ${input.workspaceId} AND t.status = 'PENDING'
           AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
         ORDER BY t.transaction_date, t.id LIMIT ${MAX_DETAILS}`.execute(unitOfWorkKysely());
      return this.finding(
        sums.rows.reduce((n, r) => n + r.n, 0),
        sums.rows,
        details.rows.map((r) => ({ ...r, refType: 'TRANSACTION' as const })),
      );
    });
  }

  countUncategorizedInRange(input: ClosingRangeInput): Promise<ClosingFindingDto> {
    const { from, to } = range(input);
    return this.uow.run(input.workspaceId, async () => {
      const ids = (
        await Promise.all([
          this.categories.uncategorized(input.workspaceId, 'EXPENSE'),
          this.categories.uncategorized(input.workspaceId, 'INCOME'),
        ])
      ).filter((id): id is string => id !== null);
      if (ids.length === 0) return this.finding(0, [], []);
      // Solo transacciones con asiento activo y porciones vigentes; transferencias/conversiones no cuentan (sus
      // porciones son comisiones con categoría *Fees*), ni los ajustes (sin porciones).
      const base = sql`
          FROM txn.transaction t
          JOIN txn.transaction_split s
            ON s.workspace_id = t.workspace_id AND s.transaction_id = t.id AND s.superseded_in_revision IS NULL
         WHERE t.workspace_id = ${input.workspaceId}
           AND t.status IN ('POSTED', 'CLEARED', 'RECONCILED')
           AND t.kind IN ('INCOME', 'EXPENSE', 'REFUND')
           AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
           AND s.category_id = ANY(${ids}::uuid[])`;
      const sums = await sql<SumRow & { n: number }>`
        SELECT s.currency, SUM(s.amount)::text AS total, COUNT(*)::int AS n ${base}
         GROUP BY s.currency ORDER BY s.currency`.execute(unitOfWorkKysely());
      const details = await sql<DetailRow>`
        SELECT s.id AS ref_id, COALESCE(NULLIF(s.memo, ''), NULLIF(t.description, ''), t.kind) AS label,
               t.transaction_date::text AS date, s.amount::text AS amount, s.currency ${base}
         ORDER BY t.transaction_date, s.id LIMIT ${MAX_DETAILS}`.execute(unitOfWorkKysely());
      return this.finding(
        sums.rows.reduce((n, r) => n + r.n, 0),
        sums.rows,
        details.rows.map((r) => ({ ...r, refType: 'SPLIT' as const })),
      );
    });
  }

  countOpenDuplicatesInRange(input: ClosingRangeInput): Promise<ClosingFindingDto> {
    const { from, to } = range(input);
    return this.uow.run(input.workspaceId, async () => {
      // Candidatos por SQL (misma cuenta, monto y moneda, |Δ fecha| <= ventana, no anuladas, al menos una en el rango);
      // la heurística de descripción/contraparte la decide `findDuplicates` (una sola fuente de reglas). DERIVADO: no
      // hay tabla de candidatos persistidos ni flujo de descarte (desviación documentada en la spec de cierre).
      const { rows } = await sql<{
        a_id: string;
        b_id: string;
        account_id: string;
        amount: string;
        currency: string;
        a_date: string;
        b_date: string;
        a_status: TransactionStatus;
        b_status: TransactionStatus;
        a_desc: string | null;
        b_desc: string | null;
        a_cp: string | null;
        b_cp: string | null;
        b_kind: string;
      }>`
        SELECT a.id AS a_id, b.id AS b_id, a.account_id, a.amount::text AS amount, a.currency,
               a.transaction_date::text AS a_date, b.transaction_date::text AS b_date,
               a.status AS a_status, b.status AS b_status,
               a.description AS a_desc, b.description AS b_desc,
               a.counterparty_id AS a_cp, b.counterparty_id AS b_cp, b.kind AS b_kind
          FROM txn.transaction a
          JOIN txn.transaction b
            ON b.workspace_id = a.workspace_id AND b.account_id = a.account_id AND b.currency = a.currency
           AND b.amount = a.amount AND b.id > a.id
           AND abs(b.transaction_date - a.transaction_date) <= ${DUPLICATE_WINDOW_DAYS}
         WHERE a.workspace_id = ${input.workspaceId}
           AND a.status <> 'VOIDED' AND b.status <> 'VOIDED'
           AND a.kind IN ('INCOME', 'EXPENSE', 'REFUND') AND b.kind IN ('INCOME', 'EXPENSE', 'REFUND')
           AND (a.transaction_date BETWEEN ${from}::date AND ${to}::date
                OR b.transaction_date BETWEEN ${from}::date AND ${to}::date)
         ORDER BY a.id, b.id`.execute(unitOfWorkKysely());
      const scales = new Map<string, number>();
      const pairs: { refId: string; date: string; label: string; amount: Money }[] = [];
      for (const r of rows) {
        let scale = scales.get(r.currency);
        if (scale === undefined) {
          scale = (await this.currencies.scaleOf(r.currency)) ?? 18;
          scales.set(r.currency, scale);
        }
        const amount = Money.parse(r.amount, makeCurrency(r.currency, scale));
        const hits = findDuplicates(
          {
            accountId: r.account_id,
            amount,
            businessDate: r.a_date,
            description: r.a_desc,
            counterpartyId: r.a_cp,
            excludeTransactionId: r.a_id,
          },
          [
            {
              id: r.b_id,
              accountId: r.account_id,
              amount,
              businessDate: r.b_date,
              description: r.b_desc,
              counterpartyId: r.b_cp,
              status: r.b_status,
            },
          ],
        );
        if (hits.length === 0) continue;
        // El par se identifica por su transacción más reciente (fecha, y a igualdad, el id mayor = `b`).
        const bNewer = r.b_date >= r.a_date;
        pairs.push({
          refId: bNewer ? r.b_id : r.a_id,
          date: bNewer ? r.b_date : r.a_date,
          label: (bNewer ? r.b_desc : r.a_desc) || r.b_kind,
          amount,
        });
      }
      pairs.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.refId < y.refId ? -1 : 1));
      const totals = new Map<string, Money>();
      for (const p of pairs) {
        const cur = totals.get(p.amount.currency.code);
        totals.set(p.amount.currency.code, cur ? cur.add(p.amount) : p.amount);
      }
      return {
        count: pairs.length,
        amounts: [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, m]) => m.toJSON()),
        details: pairs.slice(0, MAX_DETAILS).map((p): ClosingFindingDetailDto => ({
          refType: 'DUPLICATE_CANDIDATE',
          refId: p.refId,
          label: p.label,
          date: p.date,
          amount: p.amount.toJSON(),
        })),
        truncated: pairs.length > MAX_DETAILS,
      };
    });
  }

  listReconciledWithoutStatementInRange(input: {
    readonly workspaceId: string;
    readonly accountIds: readonly string[];
    readonly dateFrom: string;
    readonly dateTo: string;
  }): Promise<
    readonly {
      readonly accountId: string;
      readonly transactionId: string;
      readonly businessDate: string;
      readonly amount: { readonly amount: string; readonly currency: string };
    }[]
  > {
    const { from, to } = range(input);
    if (input.accountIds.length === 0) return Promise.resolve([]);
    return this.uow.run(input.workspaceId, async () => {
      const { rows } = await sql<{
        account_id: string;
        transaction_id: string;
        business_date: string;
        amount: string;
        currency: string;
      }>`
        SELECT l.account_id, t.id AS transaction_id, t.transaction_date::text AS business_date,
               SUM(l.amount)::text AS amount, l.currency
          FROM txn.transaction t
          JOIN txn.transaction_leg l
            ON l.workspace_id = t.workspace_id AND l.transaction_id = t.id AND l.superseded_in_revision IS NULL
         WHERE t.workspace_id = ${input.workspaceId}
           AND t.status = 'RECONCILED' AND t.reconciliation_mode = 'WITHOUT_STATEMENT'
           AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
           AND l.account_id = ANY(${[...input.accountIds]}::uuid[])
         GROUP BY l.account_id, t.id, t.transaction_date, l.currency
         ORDER BY t.transaction_date, t.id, l.account_id`.execute(unitOfWorkKysely());
      const out: {
        accountId: string;
        transactionId: string;
        businessDate: string;
        amount: { amount: string; currency: string };
      }[] = [];
      for (const r of rows) {
        out.push({
          accountId: r.account_id,
          transactionId: r.transaction_id,
          businessDate: r.business_date,
          amount: await this.money(r.amount, r.currency),
        });
      }
      return out;
    });
  }

  listAccountIdsWithActivityInRange(input: ClosingRangeInput): Promise<readonly string[]> {
    const { from, to } = range(input);
    return this.uow.run(input.workspaceId, async () => {
      const { rows } = await sql<{ account_id: string }>`
        SELECT DISTINCT l.account_id
          FROM txn.transaction t
          JOIN txn.transaction_leg l
            ON l.workspace_id = t.workspace_id AND l.transaction_id = t.id AND l.superseded_in_revision IS NULL
         WHERE t.workspace_id = ${input.workspaceId}
           AND t.status NOT IN ('VOIDED', 'PENDING')
           AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
         ORDER BY l.account_id`.execute(unitOfWorkKysely());
      return rows.map((r) => r.account_id);
    });
  }

  private async money(amount: string, currency: string): Promise<{ amount: string; currency: string }> {
    const scale = (await this.currencies.scaleOf(currency)) ?? 18;
    return Money.parse(amount, makeCurrency(currency, scale)).toJSON();
  }

  private async finding(
    count: number,
    sums: readonly SumRow[],
    details: readonly (DetailRow & { refType: ClosingFindingDetailDto['refType'] })[],
  ): Promise<ClosingFindingDto> {
    const amounts: { amount: string; currency: string }[] = [];
    for (const s of sums) amounts.push(await this.money(s.total, s.currency));
    const out: ClosingFindingDetailDto[] = [];
    for (const d of details) {
      out.push({
        refType: d.refType,
        refId: d.ref_id,
        label: d.label ?? '',
        date: d.date,
        amount: await this.money(d.amount, d.currency),
      });
    }
    return { count, amounts, details: out, truncated: count > out.length };
  }
}

function range(input: { readonly dateFrom: string; readonly dateTo: string }): { from: string; to: string } {
  return { from: LocalDate.parse(input.dateFrom).toString(), to: LocalDate.parse(input.dateTo).toString() };
}
