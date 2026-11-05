import { unitOfWorkKysely } from '@pf/platform/api';
import { DomainError, Money, currency as makeCurrency, LocalDate } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { CurrencyCatalog, UnitOfWork } from '../application/ports/index.js';
import type {
  CounterpartyCategoryUsageQuery,
  FlowMoneyDto,
  NominalFlowGroupBy,
  NominalFlowQuery,
  NominalFlowRowDto,
  NominalPortionDto,
  NominalPortionPageDto,
  NominalPortionQuery,
} from '../contracts/index.js';

interface FlowRow {
  business_date: string;
  nature: 'INCOME' | 'EXPENSE';
  category_id: string;
  currency: string;
  tag_ids: string[] | null;
  account_id?: string;
  counterparty_id?: string | null;
  amount: string;
}

interface PortionRow {
  transaction_id: string;
  split_id: string;
  business_date: string;
  nature: 'INCOME' | 'EXPENSE';
  category_id: string;
  account_id: string;
  counterparty_id: string | null;
  description: string | null;
  currency: string;
  amount: string;
}

const FLOW_KINDS = sql`('INCOME', 'EXPENSE', 'REFUND', 'TRANSFER', 'CONVERSION', 'LOAN_DISBURSEMENT', 'LOAN_PAYMENT')`;

/** Cuenta de la porción: la de la transacción o, en comisiones de transferencias/conversiones, la de su pata `FEE`. */
const ACCOUNT_EXPR = sql`COALESCE(fee.account_id, t.account_id)`;
const FEE_JOIN = sql`LEFT JOIN LATERAL (
        SELECT l.account_id
          FROM txn.transaction_leg l
         WHERE l.workspace_id = t.workspace_id AND l.transaction_id = t.id
           AND l.role = 'FEE' AND l.superseded_in_revision IS NULL
           AND t.kind IN ('TRANSFER', 'CONVERSION')
         ORDER BY l.id
         LIMIT 1
      ) fee ON true`;
const COUNTERPARTY_EXPR = sql`COALESCE(s.counterparty_id, t.counterparty_id)`;

interface PortionFilters {
  readonly categoryIds?: readonly string[] | undefined;
  readonly accountIds?: readonly string[] | undefined;
  readonly counterpartyIds?: readonly string[] | undefined;
  readonly tagIds?: readonly string[] | undefined;
  readonly currencies?: readonly string[] | undefined;
}

/**
 * Predicado de filtros COMPARTIDO por `summarizeNominalFlows` y `listPortions`: así el drill-down suma exactamente la
 * celda (add-financial-reports, identidad Σ filas = celda). Cada filtro es opcional; sin ninguno no agrega SQL.
 */
function filterSql(f: PortionFilters) {
  const parts = [] as ReturnType<typeof sql>[];
  if (f.categoryIds !== undefined) parts.push(sql`AND s.category_id = ANY(${[...f.categoryIds]}::uuid[])`);
  if (f.accountIds !== undefined) parts.push(sql`AND ${ACCOUNT_EXPR} = ANY(${[...f.accountIds]}::uuid[])`);
  if (f.counterpartyIds !== undefined)
    parts.push(sql`AND ${COUNTERPARTY_EXPR} = ANY(${[...f.counterpartyIds]}::uuid[])`);
  if (f.tagIds !== undefined)
    parts.push(sql`AND EXISTS (
        SELECT 1 FROM txn.split_tag fst
         WHERE fst.workspace_id = s.workspace_id AND fst.split_id = s.id
           AND fst.tag_id = ANY(${[...f.tagIds]}::uuid[]))`);
  if (f.currencies !== undefined) parts.push(sql`AND s.currency = ANY(${[...f.currencies]}::text[])`);
  return parts.length === 0 ? sql`` : sql.join(parts, sql` `);
}

const needsAccount = (f: PortionFilters, groupBy: readonly string[]) =>
  f.accountIds !== undefined || groupBy.includes('ACCOUNT');

function scaleResolver(currencies: CurrencyCatalog) {
  const scales = new Map<string, number>();
  return async (code: string): Promise<number> => {
    let scale = scales.get(code);
    if (scale === undefined) {
      scale = (await currencies.scaleOf(code)) ?? 18;
      scales.set(code, scale);
    }
    return scale;
  };
}

/**
 * `SummarizeNominalFlows` sobre PostgreSQL (openspec add-basic-dashboard, design.md decisión 1): Σ de las porciones
 * VIGENTES (`superseded_in_revision IS NULL`) de transacciones con asiento activo (`POSTED | CLEARED | RECONCILED`,
 * INV-023), agrupado por fecha de negocio, naturaleza, categoría y moneda. Es el mismo conjunto que los postings a
 * `INCOME:*`/`EXPENSE:*` del ledger (cada posting nominal lleva el `split_id` de su porción, FR-LEDGER-008), leído en
 * el schema dueño de los splits sin joins cross-schema:
 *   INCOME → ingreso (+); EXPENSE → gasto (+); REFUND → gasto (−, en la fecha del reembolso);
 *   TRANSFER / CONVERSION → solo sus porciones de comisión (gasto +, categoría *Fees*); ADJUSTMENT no tiene porciones;
 *   LOAN_PAYMENT / LOAN_DISBURSEMENT (add-loans) → sus porciones (interés, comisiones, seguro, impuestos, comisión
 *   retenida: gasto +); el principal no es flujo.
 * El principal de transferencias, conversiones y préstamos, los saldos iniciales y los ajustes nunca son flujo (docs/14 §4.3).
 * Los filtros por cuenta, contraparte, etiqueta y moneda y el `groupBy` (add-financial-reports) son opcionales: sin
 * ellos la consulta y su agrupación son las de siempre.
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
    readonly categoryIds?: readonly string[];
    readonly withTags?: boolean;
    readonly accountIds?: readonly string[];
    readonly counterpartyIds?: readonly string[];
    readonly tagIds?: readonly string[];
    readonly currencies?: readonly string[];
    readonly groupBy?: readonly NominalFlowGroupBy[];
  }): Promise<readonly NominalFlowRowDto[]> {
    const from = LocalDate.parse(input.dateFrom).toString();
    const to = LocalDate.parse(input.dateTo).toString();
    const withTags = input.withTags === true;
    const groupBy = input.groupBy ?? [];
    const byAccount = groupBy.includes('ACCOUNT');
    const byCounterparty = groupBy.includes('COUNTERPARTY');
    // Con `withTags` la porción se agrupa también por su conjunto de tags (subconsulta lateral, ids ordenados).
    const tagJoin = withTags
      ? sql`LEFT JOIN LATERAL (
              SELECT array_agg(st.tag_id::text ORDER BY st.tag_id) AS ids
                FROM txn.split_tag st
               WHERE st.workspace_id = s.workspace_id AND st.split_id = s.id
            ) tg ON true`
      : sql``;
    const tagColumn = withTags ? sql`COALESCE(tg.ids, ARRAY[]::text[])` : sql`NULL::text[]`;
    const feeJoin = needsAccount(input, groupBy) ? FEE_JOIN : sql``;
    // Columnas 1..5 fijas; la cuenta y la contraparte (si se piden) son las posiciones 6 y 7 en ese orden.
    const extraSelect = [
      ...(byAccount ? [sql`${ACCOUNT_EXPR}::text AS account_id`] : []),
      ...(byCounterparty ? [sql`${COUNTERPARTY_EXPR}::text AS counterparty_id`] : []),
    ];
    const extraSelectSql = extraSelect.length > 0 ? sql`, ${sql.join(extraSelect)}` : sql``;
    const groupPositions = ['1', '2', '3', '4', '5', ...extraSelect.map((_, i) => String(6 + i))].join(', ');
    const orderExtra = `${byAccount ? ', 6' : ''}${byCounterparty ? `, ${byAccount ? 7 : 6}` : ''}`;
    return this.uow.run(input.workspaceId, async () => {
      const { rows } = await sql<FlowRow>`
        SELECT t.transaction_date::text AS business_date,
               CASE WHEN t.kind = 'INCOME' THEN 'INCOME' ELSE 'EXPENSE' END AS nature,
               s.category_id, s.currency, ${tagColumn} AS tag_ids
               ${extraSelectSql},
               (SUM(CASE WHEN t.kind = 'REFUND' THEN -s.amount ELSE s.amount END))::text AS amount
          FROM txn.transaction t
          JOIN txn.transaction_split s
            ON s.workspace_id = t.workspace_id AND s.transaction_id = t.id AND s.superseded_in_revision IS NULL
          ${tagJoin}
          ${feeJoin}
         WHERE t.workspace_id = ${input.workspaceId}
           AND t.status IN ('POSTED', 'CLEARED', 'RECONCILED')
           AND t.kind IN ${FLOW_KINDS}
           AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
           ${filterSql(input)}
         GROUP BY ${sql.raw(groupPositions)}
         ORDER BY 1, 2, 4, 3, 5${sql.raw(orderExtra)}`.execute(unitOfWorkKysely());
      const scaleOf = scaleResolver(this.currencies);
      const out: NominalFlowRowDto[] = [];
      for (const r of rows) {
        out.push({
          businessDate: r.business_date,
          nature: r.nature,
          categoryId: r.category_id,
          amount: Money.parse(r.amount, makeCurrency(r.currency, await scaleOf(r.currency))).toJSON(),
          ...(withTags ? { tagIds: r.tag_ids ?? [] } : {}),
          ...(byAccount && r.account_id !== undefined ? { accountId: r.account_id } : {}),
          ...(byCounterparty ? { counterpartyId: r.counterparty_id ?? null } : {}),
        });
      }
      return out;
    });
  }
}

const encodeCursor = (date: string, splitId: string) =>
  Buffer.from(JSON.stringify([date, splitId]), 'utf8').toString('base64url');
function decodeCursor(cursor: string): { date: string; splitId: string } {
  try {
    const [date, splitId] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];
    return { date: LocalDate.parse(date).toString(), splitId: String(splitId) };
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'cursor is not valid').at('/cursor');
  }
}

/**
 * `NominalPortionQuery` sobre PostgreSQL (add-financial-reports, drill-down): las porciones que componen una celda de
 * `summarizeNominalFlows`, con el mismo predicado (`FLOW_KINDS`, estado, vigencia y `filterSql`), keyset por
 * `(fecha de negocio DESC, id de porción DESC)` y los totales por moneda de TODA la celda en cada página. Las consultas
 * de la página y de los totales corren una tras otra sobre el mismo cliente (nunca en paralelo).
 */
export class PgNominalPortionQuery implements NominalPortionQuery {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly currencies: CurrencyCatalog,
  ) {}

  async listPortions(
    input: Parameters<NominalPortionQuery['listPortions']>[0],
  ): Promise<NominalPortionPageDto> {
    const from = LocalDate.parse(input.dateFrom).toString();
    const to = LocalDate.parse(input.dateTo).toString();
    const limit = Math.min(200, Math.max(1, Math.trunc(input.limit)));
    const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
    const natureFilter =
      input.nature === 'INCOME'
        ? sql`AND t.kind = 'INCOME'`
        : input.nature === 'EXPENSE'
          ? sql`AND t.kind <> 'INCOME'`
          : sql``;
    const cursorFilter = cursor
      ? sql`AND (t.transaction_date, s.id) < (${cursor.date}::date, ${cursor.splitId}::uuid)`
      : sql``;
    const base = sql`
          FROM txn.transaction t
          JOIN txn.transaction_split s
            ON s.workspace_id = t.workspace_id AND s.transaction_id = t.id AND s.superseded_in_revision IS NULL
          ${FEE_JOIN}
         WHERE t.workspace_id = ${input.workspaceId}
           AND t.status IN ('POSTED', 'CLEARED', 'RECONCILED')
           AND t.kind IN ${FLOW_KINDS}
           AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
           ${natureFilter}
           ${filterSql(input)}`;
    return this.uow.run(input.workspaceId, async () => {
      const scaleOf = scaleResolver(this.currencies);
      const page = await sql<PortionRow>`
        SELECT t.id::text AS transaction_id, s.id::text AS split_id, t.transaction_date::text AS business_date,
               CASE WHEN t.kind = 'INCOME' THEN 'INCOME' ELSE 'EXPENSE' END AS nature,
               s.category_id::text AS category_id, ${ACCOUNT_EXPR}::text AS account_id,
               ${COUNTERPARTY_EXPR}::text AS counterparty_id,
               COALESCE(NULLIF(s.memo, ''), t.description) AS description, s.currency,
               (CASE WHEN t.kind = 'REFUND' THEN -s.amount ELSE s.amount END)::text AS amount
        ${base} ${cursorFilter}
         ORDER BY t.transaction_date DESC, s.id DESC
         LIMIT ${limit + 1}`.execute(unitOfWorkKysely());
      const totals = await sql<{ currency: string; amount: string; n: string }>`
        SELECT s.currency, (SUM(CASE WHEN t.kind = 'REFUND' THEN -s.amount ELSE s.amount END))::text AS amount,
               count(*)::text AS n
        ${base}
         GROUP BY s.currency
         ORDER BY s.currency`.execute(unitOfWorkKysely());
      const hasMore = page.rows.length > limit;
      const visible = hasMore ? page.rows.slice(0, limit) : page.rows;
      const rows: NominalPortionDto[] = [];
      for (const r of visible) {
        rows.push({
          transactionId: r.transaction_id,
          splitId: r.split_id,
          businessDate: r.business_date,
          nature: r.nature,
          categoryId: r.category_id,
          accountId: r.account_id,
          counterpartyId: r.counterparty_id,
          description: r.description,
          amount: Money.parse(r.amount, makeCurrency(r.currency, await scaleOf(r.currency))).toJSON(),
        });
      }
      const totalMoney: FlowMoneyDto[] = [];
      for (const r of totals.rows) {
        totalMoney.push(Money.parse(r.amount, makeCurrency(r.currency, await scaleOf(r.currency))).toJSON());
      }
      const last = visible.at(-1);
      return {
        rows,
        nextCursor: hasMore && last ? encodeCursor(last.business_date, last.split_id) : null,
        count: totals.rows.reduce((n, r) => n + Number(r.n), 0),
        totals: totalMoney,
      };
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
