import { currentRequestContext, unitOfWorkKysely } from '@pf/platform/api';
import { currency as makeCurrency, Money } from '@pf/shared-kernel';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type {
  CoverageCounts,
  ReconciliationItem,
  ReconciliationListFilter,
  ReconciliationRepository,
} from '../application/ports/index.js';
import {
  Reconciliation,
  type ReconciliationState,
  type ReconciliationStatus,
  type Transaction,
} from '../domain/index.js';
import type { PgTransactionRepository } from './pg-transactions.js';

/** Tablas de la sesión de reconciliación (migración 20261008140000_txn_reconciliation.sql). */
interface ReconciliationDb {
  'txn.reconciliation': {
    id: string;
    workspace_id: string;
    account_id: string;
    currency: string;
    statement_date: string;
    statement_balance: string;
    cleared_balance: string | null;
    difference: string | null;
    status: ReconciliationStatus;
    adjustment_transaction_id: string | null;
    started_by: string;
    started_at: string;
    completed_by: string | null;
    completed_at: string | null;
    cancelled_by: string | null;
    cancelled_at: string | null;
    version: number;
  };
  'txn.reconciliation_item': {
    workspace_id: string;
    reconciliation_id: string;
    transaction_id: string;
    reconciled_at: string;
    verified_without_statement: boolean;
    unreconciled_at: string | null;
    unreconciled_by: string | null;
    unreconcile_reason: string | null;
  };
  'fx.currency': { code: string; scale: number };
}

const db = (): Kysely<ReconciliationDb> => unitOfWorkKysely<ReconciliationDb>();
const iso = (column: string) =>
  sql<string | null>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const ITEM_CHUNK = 500;

const columns = [
  'r.id',
  'r.workspace_id',
  'r.account_id',
  'r.currency',
  'r.status',
  'r.adjustment_transaction_id',
  'r.started_by',
  'r.completed_by',
  'r.cancelled_by',
  'r.version',
  sql<string>`r.statement_date::text`.as('statement_date'),
  sql<string>`r.statement_balance::text`.as('statement_balance'),
  sql<string | null>`r.cleared_balance::text`.as('cleared_balance'),
  sql<string | null>`r.difference::text`.as('difference'),
  iso('r.started_at').as('started_at'),
  iso('r.completed_at').as('completed_at'),
  iso('r.cancelled_at').as('cancelled_at'),
  'c.scale',
] as const;

type Row = Omit<ReconciliationDb['txn.reconciliation'], 'started_at'> & {
  scale: number;
  started_at: string | null;
};

function toReconciliation(r: Row): Reconciliation {
  const ccy = makeCurrency(r.currency, Number(r.scale));
  const money = (v: string) => Money.parse(v, ccy);
  const state: ReconciliationState = {
    id: r.id,
    workspaceId: r.workspace_id,
    accountId: r.account_id,
    statementDate: r.statement_date,
    statementBalance: money(r.statement_balance),
    status: r.status,
    clearedBalance: r.cleared_balance === null ? null : money(r.cleared_balance),
    difference: r.difference === null ? null : money(r.difference),
    adjustmentTransactionId: r.adjustment_transaction_id,
    startedBy: r.started_by,
    startedAt: r.started_at,
    completedBy: r.completed_by,
    completedAt: r.completed_at,
    cancelledBy: r.cancelled_by,
    cancelledAt: r.cancelled_at,
    version: r.version,
  };
  return Reconciliation.rehydrate(state);
}

const actorUserId = (): string => {
  const actor = currentRequestContext()?.actor;
  return actor && actor.type === 'USER' ? actor.userId : NIL_UUID;
};

/**
 * Repositorio Kysely de `txn.reconciliation*` (add-reconciliation, tarea 4.2). Las consultas de saldo son agregadas
 * sobre los legs vigentes de la cuenta (índice `transaction_leg_register_idx`); `lock*` toman `FOR UPDATE` de las
 * transacciones incluidas para que finalizar evalúe y reconcilie el MISMO conjunto sin carreras.
 */
export class PgReconciliationRepository implements ReconciliationRepository {
  constructor(private readonly transactions: PgTransactionRepository) {}

  async insert(r: Reconciliation): Promise<void> {
    const s = r.snapshot;
    await db()
      .insertInto('txn.reconciliation')
      .values({
        id: s.id,
        workspace_id: s.workspaceId,
        account_id: s.accountId,
        currency: s.statementBalance.currency.code,
        statement_date: s.statementDate,
        statement_balance: s.statementBalance.toFixed(),
        cleared_balance: s.clearedBalance?.toFixed() ?? null,
        difference: s.difference?.toFixed() ?? null,
        status: s.status,
        adjustment_transaction_id: s.adjustmentTransactionId,
        started_by: s.startedBy,
        completed_by: s.completedBy,
        completed_at: s.completedAt,
        cancelled_by: s.cancelledBy,
        cancelled_at: s.cancelledAt,
        version: s.version,
      } as never)
      .execute();
  }

  async update(r: Reconciliation): Promise<boolean> {
    const s = r.snapshot;
    const result = await db()
      .updateTable('txn.reconciliation')
      .set({
        status: s.status,
        cleared_balance: s.clearedBalance?.toFixed() ?? null,
        difference: s.difference?.toFixed() ?? null,
        adjustment_transaction_id: s.adjustmentTransactionId,
        completed_by: s.completedBy,
        completed_at: s.completedAt,
        cancelled_by: s.cancelledBy,
        cancelled_at: s.cancelledAt,
        version: s.version,
      } as never)
      .where('workspace_id', '=', s.workspaceId)
      .where('id', '=', s.id)
      .where('version', '=', r.persistedVersion ?? -1)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async findById(
    workspaceId: string,
    id: string,
    options: { readonly forUpdate?: boolean } = {},
  ): Promise<Reconciliation | null> {
    let q = db()
      .selectFrom('txn.reconciliation as r')
      .innerJoin('fx.currency as c', 'c.code', 'r.currency')
      .select(columns)
      .where('r.workspace_id', '=', workspaceId)
      .where('r.id', '=', id);
    if (options.forUpdate) q = q.forUpdate('r');
    const row = await q.executeTakeFirst();
    return row ? toReconciliation(row as Row) : null;
  }

  async findInProgress(workspaceId: string, accountId: string): Promise<Reconciliation | null> {
    const row = await db()
      .selectFrom('txn.reconciliation as r')
      .innerJoin('fx.currency as c', 'c.code', 'r.currency')
      .select(columns)
      .where('r.workspace_id', '=', workspaceId)
      .where('r.account_id', '=', accountId)
      .where('r.status', '=', 'IN_PROGRESS')
      .executeTakeFirst();
    return row ? toReconciliation(row as Row) : null;
  }

  async lastCompleted(workspaceId: string, accountId: string): Promise<Reconciliation | null> {
    const row = await db()
      .selectFrom('txn.reconciliation as r')
      .innerJoin('fx.currency as c', 'c.code', 'r.currency')
      .select(columns)
      .where('r.workspace_id', '=', workspaceId)
      .where('r.account_id', '=', accountId)
      .where('r.status', '=', 'COMPLETED')
      .orderBy('r.statement_date', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? toReconciliation(row as Row) : null;
  }

  async list(
    workspaceId: string,
    filter: ReconciliationListFilter,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<Reconciliation[]> {
    let q = db()
      .selectFrom('txn.reconciliation as r')
      .innerJoin('fx.currency as c', 'c.code', 'r.currency')
      .select(columns)
      .where('r.workspace_id', '=', workspaceId);
    if (filter.accountId) q = q.where('r.account_id', '=', filter.accountId);
    if (filter.status) q = q.where('r.status', '=', filter.status);
    const rows = await q
      .orderBy('r.statement_date', 'desc')
      .orderBy('r.id', 'desc')
      .offset(page.offset)
      .limit(page.limit)
      .execute();
    return rows.map((r) => toReconciliation(r as Row));
  }

  async findByIds(workspaceId: string, ids: readonly string[]): Promise<Reconciliation[]> {
    if (ids.length === 0) return [];
    const rows = await db()
      .selectFrom('txn.reconciliation as r')
      .innerJoin('fx.currency as c', 'c.code', 'r.currency')
      .select(columns)
      .where('r.workspace_id', '=', workspaceId)
      .where('r.id', 'in', [...ids])
      .execute();
    return rows.map((r) => toReconciliation(r as Row));
  }

  async confirmedLegsTotal(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly currency: string;
    readonly through: string;
    readonly statuses: readonly ('CLEARED' | 'RECONCILED')[];
  }): Promise<{ readonly total: Money; readonly count: number }> {
    const scale = await db()
      .selectFrom('fx.currency')
      .select('scale')
      .where('code', '=', input.currency)
      .executeTakeFirstOrThrow();
    const statuses = [...input.statuses];
    const { rows } = await sql<{ total: string; cnt: number }>`
      SELECT COALESCE(SUM(l.amount), 0)::text AS total, COUNT(DISTINCT t.id)::int AS cnt
        FROM txn.transaction_leg l
        JOIN txn.transaction t ON t.workspace_id = l.workspace_id AND t.id = l.transaction_id
       WHERE l.workspace_id = ${input.workspaceId}
         AND l.account_id = ${input.accountId}
         AND l.currency = ${input.currency}
         AND l.superseded_in_revision IS NULL
         AND l.transaction_date <= ${input.through}::date
         AND t.status = ANY(${statuses}::text[])`.execute(db());
    const row = rows[0];
    return {
      total: Money.parse(row?.total ?? '0', makeCurrency(input.currency, Number(scale.scale))),
      count: Number(row?.cnt ?? 0),
    };
  }

  async lockClearedThrough(workspaceId: string, accountId: string, through: string): Promise<Transaction[]> {
    return this.lock(workspaceId, accountId, through, sql`t.status = 'CLEARED'`);
  }

  async lockWithoutStatementThrough(
    workspaceId: string,
    accountId: string,
    through: string,
  ): Promise<Transaction[]> {
    return this.lock(
      workspaceId,
      accountId,
      through,
      sql`t.status = 'RECONCILED' AND t.reconciliation_mode = 'WITHOUT_STATEMENT'`,
    );
  }

  private async lock(
    workspaceId: string,
    accountId: string,
    through: string,
    predicate: RawBuilder<unknown>,
  ): Promise<Transaction[]> {
    const { rows } = await sql<{ id: string }>`
      SELECT t.id
        FROM txn.transaction t
       WHERE t.workspace_id = ${workspaceId}
         AND ${predicate}
         AND t.transaction_date <= ${through}::date
         AND EXISTS (SELECT 1 FROM txn.transaction_leg l
                      WHERE l.workspace_id = t.workspace_id AND l.transaction_id = t.id
                        AND l.account_id = ${accountId} AND l.superseded_in_revision IS NULL)
       ORDER BY t.transaction_date, t.id
         FOR UPDATE OF t`.execute(db());
    return this.transactions.findByIds(
      workspaceId,
      rows.map((r) => r.id),
    );
  }

  async insertItems(
    workspaceId: string,
    items: readonly {
      readonly reconciliationId: string;
      readonly transactionId: string;
      readonly verifiedWithoutStatement: boolean;
    }[],
  ): Promise<void> {
    for (let i = 0; i < items.length; i += ITEM_CHUNK) {
      await db()
        .insertInto('txn.reconciliation_item')
        .values(
          items.slice(i, i + ITEM_CHUNK).map((it) => ({
            workspace_id: workspaceId,
            reconciliation_id: it.reconciliationId,
            transaction_id: it.transactionId,
            verified_without_statement: it.verifiedWithoutStatement,
          })) as never,
        )
        .execute();
    }
  }

  async itemsOf(workspaceId: string, reconciliationId: string): Promise<ReconciliationItem[]> {
    const rows = await db()
      .selectFrom('txn.reconciliation_item as i')
      .select([
        'i.reconciliation_id',
        'i.transaction_id',
        'i.verified_without_statement',
        'i.unreconciled_by',
        'i.unreconcile_reason',
        iso('i.reconciled_at').as('reconciled_at'),
        iso('i.unreconciled_at').as('unreconciled_at'),
      ])
      .where('i.workspace_id', '=', workspaceId)
      .where('i.reconciliation_id', '=', reconciliationId)
      .orderBy('i.reconciled_at')
      .orderBy('i.transaction_id')
      .execute();
    return rows.map((r) => ({
      reconciliationId: r.reconciliation_id,
      transactionId: r.transaction_id,
      reconciledAt: r.reconciled_at ?? '',
      verifiedWithoutStatement: r.verified_without_statement,
      unreconciledAt: r.unreconciled_at,
      unreconciledBy: r.unreconciled_by,
      unreconcileReason: r.unreconcile_reason,
    }));
  }

  async markUnreconciled(input: {
    readonly workspaceId: string;
    readonly transactionId: string;
    readonly reason: string;
  }): Promise<{ readonly reconciliationId: string } | null> {
    const { rows } = await sql<{ reconciliation_id: string }>`
      WITH target AS (
        SELECT reconciliation_id FROM txn.reconciliation_item
         WHERE workspace_id = ${input.workspaceId} AND transaction_id = ${input.transactionId}
           AND unreconciled_at IS NULL
         ORDER BY reconciled_at DESC LIMIT 1 FOR UPDATE)
      UPDATE txn.reconciliation_item i
         SET unreconciled_at = now(), unreconciled_by = ${actorUserId()}::uuid, unreconcile_reason = ${input.reason}
        FROM target
       WHERE i.workspace_id = ${input.workspaceId} AND i.transaction_id = ${input.transactionId}
         AND i.reconciliation_id = target.reconciliation_id
      RETURNING i.reconciliation_id`.execute(db());
    const row = rows[0];
    return row ? { reconciliationId: row.reconciliation_id } : null;
  }

  async coverageCounts(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly from: string | null;
    readonly through: string;
    readonly afterDate: string | null;
  }): Promise<CoverageCounts> {
    const { rows } = await sql<{ posted: number; cleared: number; wos_range: number; wos_after: boolean }>`
      SELECT COUNT(*) FILTER (WHERE t.status = 'POSTED')::int AS posted,
             COUNT(*) FILTER (WHERE t.status = 'CLEARED')::int AS cleared,
             COUNT(*) FILTER (WHERE t.reconciliation_mode = 'WITHOUT_STATEMENT'
                                AND (${input.from}::date IS NULL OR t.transaction_date >= ${input.from}::date))::int AS wos_range,
             COALESCE(BOOL_OR(t.reconciliation_mode = 'WITHOUT_STATEMENT'
                                AND (${input.afterDate}::date IS NULL OR t.transaction_date > ${input.afterDate}::date)), false) AS wos_after
        FROM txn.transaction t
       WHERE t.workspace_id = ${input.workspaceId}
         AND t.status IN ('POSTED', 'CLEARED', 'RECONCILED')
         AND t.transaction_date <= ${input.through}::date
         AND EXISTS (SELECT 1 FROM txn.transaction_leg l
                      WHERE l.workspace_id = t.workspace_id AND l.transaction_id = t.id
                        AND l.account_id = ${input.accountId} AND l.superseded_in_revision IS NULL)`.execute(
      db(),
    );
    const row = rows[0];
    return {
      unreconciledPostedCount: Number(row?.posted ?? 0),
      unreconciledClearedCount: Number(row?.cleared ?? 0),
      withoutStatementInRange: Number(row?.wos_range ?? 0),
      withoutStatementAfterLastStatement: row?.wos_after === true,
    };
  }
}
