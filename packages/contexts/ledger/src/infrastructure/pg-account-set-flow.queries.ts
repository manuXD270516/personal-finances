import { unitOfWorkKysely } from '@pf/platform/api';
import { currency as makeCurrency, DomainError, LocalDate, Money } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type {
  AccountSetFlowQuery,
  AccountSetFlowRowDto,
  AccountSetMovementDto,
  FlowCounterpartClassDto,
  MoneyDto,
} from '../contracts/index.js';

interface SummaryRow {
  entry_date: string;
  currency: string;
  counterpart: FlowCounterpartClassDto;
  amount: string;
}

interface MovementRow extends SummaryRow {
  journal_entry_id: string;
  source_type: string;
  source_id: string;
  account_ids: string[];
  scale: number | string;
}

const COUNTERPART_CLASSES: readonly FlowCounterpartClassDto[] = [
  'INCOME',
  'EXPENSE',
  'FX_TRADING',
  'OPENING_BALANCE',
  'ADJUSTMENTS',
  'OUTSIDE_ASSET',
  'OUTSIDE_LIABILITY',
];

/** Clase de la contrapartida de una pata: cuenta de sistema por su tipo o cuenta del usuario por su naturaleza. */
const CLASS_EXPR = sql`COALESCE(la.system_kind, CASE la.type WHEN 'ASSET' THEN 'OUTSIDE_ASSET' ELSE 'OUTSIDE_LIABILITY' END)`;

const encodeCursor = (r: {
  entry_date: string;
  journal_entry_id: string;
  currency: string;
  counterpart: string;
}) =>
  Buffer.from(JSON.stringify([r.entry_date, r.journal_entry_id, r.currency, r.counterpart]), 'utf8').toString(
    'base64url',
  );
function decodeCursor(cursor: string): {
  date: string;
  entry: string;
  currency: string;
  counterpart: string;
} {
  try {
    const [date, entry, currency, counterpart] = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as [string, string, string, string];
    return {
      date: LocalDate.parse(date).toString(),
      entry: String(entry),
      currency: String(currency),
      counterpart: String(counterpart),
    };
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'cursor is not valid').at('/cursor');
  }
}

/**
 * `AccountSetFlowQuery` sobre PostgreSQL (add-financial-reports, design decisión 3 y 4). Para cada (asiento, moneda) que
 * toca el conjunto de cuentas, el flujo del conjunto es −Σ de las patas de FUERA del conjunto en esa moneda (el asiento
 * cuadra por moneda: trigger PF001), clasificadas por la cuenta contraparte. Corre en la unidad de trabajo del
 * llamador (RLS del workspace); las consultas de una operación van una tras otra sobre el mismo cliente.
 */
export class PgAccountSetFlowQuery implements AccountSetFlowQuery {
  async summarize(
    input: Parameters<AccountSetFlowQuery['summarize']>[0],
  ): Promise<readonly AccountSetFlowRowDto[]> {
    if (input.accountIds.length === 0) return [];
    const from = LocalDate.parse(input.dateFrom).toString();
    const to = LocalDate.parse(input.dateTo).toString();
    const { rows } = await sql<SummaryRow & { scale: number | string }>`
      WITH set_accts AS (
        SELECT id FROM ledger.ledger_account
         WHERE workspace_id = ${input.workspaceId} AND source_account_id = ANY(${[...input.accountIds]}::uuid[])),
      touch AS (
        SELECT DISTINCT q.journal_entry_id, q.currency
          FROM ledger.posting q
         WHERE q.workspace_id = ${input.workspaceId}
           AND q.entry_date BETWEEN ${from}::date AND ${to}::date
           AND q.ledger_account_id IN (SELECT id FROM set_accts))
      SELECT p.entry_date::text AS entry_date, p.currency, ${CLASS_EXPR} AS counterpart, c.scale,
             (-SUM(p.amount))::text AS amount
        FROM ledger.posting p
        JOIN touch t ON t.journal_entry_id = p.journal_entry_id AND t.currency = p.currency
        JOIN ledger.ledger_account la ON la.workspace_id = p.workspace_id AND la.id = p.ledger_account_id
        JOIN fx.currency c ON c.code = p.currency
       WHERE p.workspace_id = ${input.workspaceId}
         AND p.entry_date BETWEEN ${from}::date AND ${to}::date
         AND p.ledger_account_id NOT IN (SELECT id FROM set_accts)
       GROUP BY 1, 2, 3, 4
      HAVING SUM(p.amount) <> 0
       ORDER BY 1, 2, 3`.execute(unitOfWorkKysely());
    return rows.map((r) => ({
      businessDate: r.entry_date,
      currency: r.currency,
      counterpart: r.counterpart,
      amount: Money.parse(r.amount, makeCurrency(r.currency, Number(r.scale))).toFixed(),
    }));
  }

  async listMovements(input: Parameters<AccountSetFlowQuery['listMovements']>[0]): Promise<{
    readonly rows: readonly AccountSetMovementDto[];
    readonly nextCursor: string | null;
    readonly count: number;
    readonly totals: readonly MoneyDto[];
  }> {
    if (input.accountIds.length === 0) return { rows: [], nextCursor: null, count: 0, totals: [] };
    const from = LocalDate.parse(input.dateFrom).toString();
    const to = LocalDate.parse(input.dateTo).toString();
    const limit = Math.min(200, Math.max(1, Math.trunc(input.limit)));
    const classes = (input.counterparts ?? COUNTERPART_CLASSES).filter((c) =>
      COUNTERPART_CLASSES.includes(c),
    );
    const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
    const currencyFilter = input.currency === undefined ? sql`` : sql`AND p.currency = ${input.currency}`;
    const moves = sql`
      WITH set_accts AS (
        SELECT id, source_account_id FROM ledger.ledger_account
         WHERE workspace_id = ${input.workspaceId} AND source_account_id = ANY(${[...input.accountIds]}::uuid[])),
      touch AS (
        SELECT q.journal_entry_id, q.currency, array_agg(DISTINCT sa.source_account_id::text) AS account_ids
          FROM ledger.posting q
          JOIN set_accts sa ON sa.id = q.ledger_account_id
         WHERE q.workspace_id = ${input.workspaceId}
           AND q.entry_date BETWEEN ${from}::date AND ${to}::date
         GROUP BY q.journal_entry_id, q.currency),
      moves AS (
        SELECT p.entry_date::text AS entry_date, p.journal_entry_id::text AS journal_entry_id, p.currency,
               ${CLASS_EXPR} AS counterpart, c.scale, je.source_type, je.source_id::text AS source_id,
               t.account_ids, (-SUM(p.amount)) AS amount
          FROM ledger.posting p
          JOIN touch t ON t.journal_entry_id = p.journal_entry_id AND t.currency = p.currency
          JOIN ledger.journal_entry je ON je.workspace_id = p.workspace_id AND je.id = p.journal_entry_id
          JOIN ledger.ledger_account la ON la.workspace_id = p.workspace_id AND la.id = p.ledger_account_id
          JOIN fx.currency c ON c.code = p.currency
         WHERE p.workspace_id = ${input.workspaceId}
           AND p.entry_date BETWEEN ${from}::date AND ${to}::date
           AND p.ledger_account_id NOT IN (SELECT id FROM set_accts)
           ${currencyFilter}
         GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
        HAVING SUM(p.amount) <> 0)`;
    const classFilter = sql`m.counterpart = ANY(${[...classes]}::text[])`;
    const cursorFilter = cursor
      ? sql`AND (m.entry_date, m.journal_entry_id, m.currency, m.counterpart) < (${cursor.date}, ${cursor.entry}, ${cursor.currency}, ${cursor.counterpart})`
      : sql``;
    const page = await sql<MovementRow>`
      ${moves}
      SELECT m.entry_date, m.journal_entry_id, m.currency, m.counterpart, m.scale, m.source_type, m.source_id,
             m.account_ids, m.amount::text AS amount
        FROM moves m
       WHERE ${classFilter} ${cursorFilter}
       ORDER BY m.entry_date DESC, m.journal_entry_id DESC, m.currency DESC, m.counterpart DESC
       LIMIT ${limit + 1}`.execute(unitOfWorkKysely());
    const totals = await sql<{ currency: string; scale: number | string; amount: string; n: string }>`
      ${moves}
      SELECT m.currency, m.scale, SUM(m.amount)::text AS amount, count(*)::text AS n
        FROM moves m
       WHERE ${classFilter}
       GROUP BY m.currency, m.scale
       ORDER BY m.currency`.execute(unitOfWorkKysely());
    const hasMore = page.rows.length > limit;
    const visible = hasMore ? page.rows.slice(0, limit) : page.rows;
    const last = visible.at(-1);
    return {
      rows: visible.map((r) => ({
        journalEntryId: r.journal_entry_id,
        transactionId: r.source_type === 'Transaction' ? r.source_id : null,
        businessDate: r.entry_date,
        accountIds: r.account_ids,
        currency: r.currency,
        counterpart: r.counterpart,
        amount: Money.parse(r.amount, makeCurrency(r.currency, Number(r.scale))).toFixed(),
      })),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      count: totals.rows.reduce((n, r) => n + Number(r.n), 0),
      totals: totals.rows.map((r) =>
        Money.parse(r.amount, makeCurrency(r.currency, Number(r.scale))).toJSON(),
      ),
    };
  }
}
