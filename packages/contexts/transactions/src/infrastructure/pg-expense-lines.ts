import { unitOfWorkKysely } from '@pf/platform/api';
import { DomainError, LocalDate } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { ExpenseLineDto, ExpenseLineQuery } from '../contracts/index.js';
import type { CurrencyCatalog, UnitOfWork } from '../application/ports/index.js';
import { normalizeFlowAmount } from './nominal-amount.js';

/** Tope de transacciones por página (la detección lee unas 20 000 porciones por año del Large Seed). */
const MAX_PAGE = 5000;

interface LineRow {
  id: string;
  version: number;
  transaction_date: string;
  status: 'POSTED' | 'CLEARED' | 'RECONCILED';
  account_id: string;
  counterparty_id: string | null;
  source: string;
  debt_role: 'CARD_CHARGE' | null;
  category_id: string;
  position: number;
  currency: string;
  amount: string;
}

const encodeCursor = (date: string, id: string): string => Buffer.from(`${date}|${id}`).toString('base64url');
function decodeCursor(cursor: string): { date: string; id: string } {
  const [date, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!date || !id || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new DomainError('VALIDATION_FAILED', 'invalid cursor').at('/after');
  }
  return { date, id };
}

/**
 * `ExpenseLineQuery` sobre PostgreSQL (openspec add-spending-anomaly-detection, decisión 2): lectura SIN efectos de las
 * porciones vigentes de los gastos `POSTED | CLEARED | RECONCILED`, con su versión, contraparte y administrador. Corre en
 * la unidad de trabajo del llamador (RLS del workspace); el keyset pagina por transacción para no partir sus porciones.
 */
export class PgExpenseLines implements ExpenseLineQuery {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly currencies: CurrencyCatalog,
  ) {}

  listExpenseLines(input: Parameters<ExpenseLineQuery['listExpenseLines']>[0]) {
    const from = LocalDate.parse(input.from).toString();
    const to = LocalDate.parse(input.to).toString();
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), MAX_PAGE);
    const after = input.after ? decodeCursor(input.after) : null;
    const cursor = after
      ? sql`AND (t.transaction_date, t.id) > (${after.date}::date, ${after.id}::uuid)`
      : sql``;
    return this.uow.run(input.workspaceId, async () => {
      const { rows } = await sql<LineRow>`
        WITH page AS (
          SELECT t.id, t.version, t.transaction_date, t.status, t.account_id, t.counterparty_id, t.source, t.debt_role
            FROM txn.transaction t
           WHERE t.workspace_id = ${input.workspaceId}
             AND t.kind = 'EXPENSE' AND t.status IN ('POSTED', 'CLEARED', 'RECONCILED')
             AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
             ${cursor}
           ORDER BY t.transaction_date, t.id
           LIMIT ${limit + 1})
        SELECT p.id::text AS id, p.version, p.transaction_date::text AS transaction_date, p.status,
               p.account_id::text AS account_id, p.counterparty_id::text AS counterparty_id, p.source, p.debt_role,
               s.category_id::text AS category_id, s.position, s.currency, s.amount::text AS amount
          FROM page p
          JOIN txn.transaction_split s
            ON s.workspace_id = ${input.workspaceId} AND s.transaction_id = p.id AND s.superseded_in_revision IS NULL
         ORDER BY p.transaction_date, p.id, s.position`.execute(unitOfWorkKysely());
      // La página trae `limit + 1` transacciones: la última solo indica que hay más y no se devuelve.
      const orderedIds: string[] = [];
      for (const r of rows) if (orderedIds[orderedIds.length - 1] !== r.id) orderedIds.push(r.id);
      const hasMore = orderedIds.length > limit;
      const keep = new Set(orderedIds.slice(0, limit));
      const visible = rows.filter((r) => keep.has(r.id));
      const lastId = orderedIds[limit - 1];
      const lastRow = hasMore ? visible.find((r) => r.id === lastId) : undefined;
      const scales = new Map<string, number>();
      for (const code of new Set(visible.map((r) => r.currency))) {
        scales.set(code, (await this.currencies.scaleOf(code)) ?? 18);
      }
      const items: ExpenseLineDto[] = visible.map((r) => ({
        transactionId: r.id,
        version: Number(r.version),
        date: r.transaction_date,
        status: r.status,
        accountId: r.account_id,
        counterpartyId: r.counterparty_id,
        categoryId: r.category_id,
        splitIndex: Number(r.position),
        amount: normalizeFlowAmount(r.amount, r.currency, scales.get(r.currency) as number),
        managedBy: r.source === 'DEBT' ? 'DEBT' : r.source === 'GOAL' ? 'GOAL' : null,
        debtRole: r.debt_role ?? null,
      }));
      return { items, next: lastRow ? encodeCursor(lastRow.transaction_date, lastRow.id) : null };
    });
  }

  transactionStates(input: Parameters<ExpenseLineQuery['transactionStates']>[0]) {
    return this.uow.run(input.workspaceId, async () => {
      if (input.transactionIds.length === 0) return [];
      const { rows } = await sql<{ id: string; version: number; status: string }>`
        SELECT t.id::text AS id, t.version, t.status FROM txn.transaction t
         WHERE t.workspace_id = ${input.workspaceId} AND t.id = ANY(${[...input.transactionIds]}::uuid[])
         ORDER BY t.id`.execute(unitOfWorkKysely());
      return rows.map((r) => ({ transactionId: r.id, version: Number(r.version), status: r.status }));
    });
  }
}
