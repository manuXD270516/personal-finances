import { currentRequestContext, currentSqlExecutor, PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { currentCorrelation, uuidv7, type Logger } from '@pf/platform/logging';
import { currency as makeCurrency, DomainError, LocalDate, Money, type Currency } from '@pf/shared-kernel';
import { sql, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import type {
  CurrencyCatalog,
  IdGenerator,
  JournalEntryRepository,
  LedgerAccountRepository,
  LedgerRequestContext,
  LedgerUnitOfWork,
  PeriodLockRepository,
} from '../application/ports/index.js';
import {
  JournalEntry,
  LedgerAccount,
  LedgerAccountCode,
  type AccountNature,
  type EntryType,
  type PeriodLock,
  type SourceRef,
  type SystemKind,
  type YearMonth,
} from '../domain/index.js';

/** Tablas del schema `ledger` que usa la aplicación (NUMERIC llega como string; fechas se leen como texto). */
interface LedgerDb {
  'ledger.ledger_account': {
    id: string;
    workspace_id: string;
    type: AccountNature;
    currency: string;
    system_kind: SystemKind | null;
    source_account_id: string | null;
    code: string;
    archived_at: string | null;
  };
  'ledger.journal_entry': {
    id: string;
    workspace_id: string;
    sequence: string;
    entry_date: string;
    entry_type: EntryType;
    source_context: string;
    source_type: string;
    source_id: string;
    source_revision: number;
    reverses_entry_id: string | null;
    memo: string | null;
    correlation_id: string | null;
    created_by: string | null;
  };
  'ledger.posting': {
    id: string;
    workspace_id: string;
    journal_entry_id: string;
    entry_date: string;
    line_no: number;
    ledger_account_id: string;
    account_type: AccountNature;
    currency: string;
    amount: string;
    split_id: string | null;
  };
  'ledger.entry_reversal': { original_entry_id: string; reversal_entry_id: string; workspace_id: string };
  'ledger.period_lock': {
    workspace_id: string;
    year_month: string;
    period_id: string | null;
    locked_by: string | null;
  };
  'fx.currency': { code: string; scale: number };
}

const db = (): Kysely<LedgerDb> => unitOfWorkKysely<LedgerDb>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Métrica de errores que delatan bugs (PF002/PF003/42501) e invariantes rotas. */
export interface LedgerMetrics {
  increment(name: string, labels: Readonly<Record<string, string>>): void;
}

const pgCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;

/**
 * Traduce los SQLSTATE del ledger (design.md §Decisiones 3, tarea 5.4; docs/31 D19): `PF001`, `PF004`, `PF005` son la
 * segunda barrera de reglas de dominio → `DomainError` equivalente; `PF002` (sin contexto RLS), `PF003` (mutación
 * prohibida) y `42501` (sin privilegio) son SIEMPRE bugs → `INTERNAL_ERROR` + log de error + métrica. El código
 * original queda en `cause`.
 */
export function mapLedgerSqlError(err: unknown, logger?: Logger, metrics?: LedgerMetrics): unknown {
  const code = pgCode(err);
  const message = err instanceof Error ? err.message : String(err);
  switch (code) {
    case 'PF001':
      return new DomainError('LEDGER_UNBALANCED_ENTRY', message, { cause: err });
    case 'PF004':
      return new DomainError('PERIOD_CLOSED', message, { cause: err });
    case 'PF005':
      return new DomainError('LEDGER_ENTRY_TOO_FEW_POSTINGS', message, { cause: err });
    case 'PF002':
    case 'PF003':
    case '42501':
      logger?.error({ sqlstate: code, err: message }, 'ledger: database barrier violated (bug)');
      metrics?.increment('ledger_db_barrier_violations_total', { sqlstate: code });
      return new DomainError('INTERNAL_ERROR', `ledger database barrier ${code}`, { cause: err });
    default:
      return err;
  }
}

/**
 * Unidad de trabajo del ledger sobre `PgUnitOfWork`: si el llamador ya tiene una transacción (p. ej. Transactions
 * registrando una transacción de negocio), el ledger escribe en ELLA (mismo commit; los triggers diferidos se evalúan
 * en su COMMIT). Si no, abre una con el contexto RLS del workspace y el usuario de la petición en curso. Los errores
 * de BD (también los del COMMIT, donde fallan los triggers diferidos PF001/PF005) se traducen con `mapLedgerSqlError`.
 */
export class PgLedgerUnitOfWork implements LedgerUnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(
    pool: Pool,
    private readonly logger?: Logger,
    private readonly metrics?: LedgerMetrics,
  ) {
    this.uow = new PgUnitOfWork(pool);
  }

  async run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    try {
      if (currentSqlExecutor()) return await fn();
      const actor = currentRequestContext()?.actor;
      const userId = actor && actor.type === 'USER' ? actor.userId : null;
      return await this.uow.run({ userId, workspaceId }, fn);
    } catch (err) {
      throw mapLedgerSqlError(err, this.logger, this.metrics);
    }
  }
}

export const pgCurrencyCatalog: CurrencyCatalog = {
  async currencyOf(code: string): Promise<Currency> {
    const row = await db()
      .selectFrom('fx.currency')
      .select(['code', 'scale'])
      .where('code', '=', code)
      .executeTakeFirst();
    if (!row) throw new DomainError('REFERENCE_NOT_FOUND', `currency ${code} not found`);
    return makeCurrency(row.code, Number(row.scale));
  },
};

type AccountRow = LedgerDb['ledger.ledger_account'];

async function toAccount(row: AccountRow, currencies: CurrencyCatalog): Promise<LedgerAccount> {
  return LedgerAccount.restore({
    id: row.id,
    workspaceId: row.workspace_id,
    nature: row.type,
    currency: await currencies.currencyOf(row.currency),
    systemKind: row.system_kind,
    sourceAccountId: row.source_account_id,
    code: LedgerAccountCode.parse(row.code),
    archivedAt: row.archived_at,
  });
}

const accountColumns = [
  'id',
  'workspace_id',
  'type',
  'currency',
  'system_kind',
  'source_account_id',
  'code',
  sql<string | null>`archived_at::text`.as('archived_at'),
] as const;

/**
 * Plan de cuentas (design.md §Decisiones 1): `INSERT … ON CONFLICT DO NOTHING` sobre los índices únicos parciales
 * + relectura ⇒ idempotente y seguro bajo concurrencia (dos transacciones concurrentes obtienen la misma cuenta).
 */
export class PgLedgerAccountRepository implements LedgerAccountRepository {
  constructor(
    private readonly ids: IdGenerator,
    private readonly currencies: CurrencyCatalog = pgCurrencyCatalog,
  ) {}

  async getOrCreateForUserAccount(input: {
    workspaceId: string;
    sourceAccountId: string;
    nature: 'ASSET' | 'LIABILITY';
    currency: Currency;
  }): Promise<LedgerAccount> {
    const candidate = LedgerAccount.forUserAccount({ id: this.ids.newId(), ...input });
    await this.insertIfAbsent(
      candidate,
      sql`(workspace_id, source_account_id) WHERE source_account_id IS NOT NULL`,
    );
    const row = await db()
      .selectFrom('ledger.ledger_account')
      .select(accountColumns)
      .where('workspace_id', '=', input.workspaceId)
      .where('source_account_id', '=', input.sourceAccountId)
      .executeTakeFirstOrThrow();
    const account = await toAccount(row, this.currencies);
    if (account.currency.code !== input.currency.code || account.nature !== input.nature) {
      // La naturaleza y la moneda de una cuenta contable no cambian nunca (INV-006).
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `ledger account of ${input.sourceAccountId} is ${account.nature} ${account.currency.code}`,
      );
    }
    return account;
  }

  async getOrCreateSystem(input: {
    workspaceId: string;
    kind: SystemKind;
    currency: Currency;
  }): Promise<LedgerAccount> {
    const candidate = LedgerAccount.system({ id: this.ids.newId(), ...input });
    await this.insertIfAbsent(
      candidate,
      sql`(workspace_id, system_kind, currency) WHERE system_kind IS NOT NULL`,
    );
    const row = await db()
      .selectFrom('ledger.ledger_account')
      .select(accountColumns)
      .where('workspace_id', '=', input.workspaceId)
      .where('system_kind', '=', input.kind)
      .where('currency', '=', input.currency.code)
      .executeTakeFirstOrThrow();
    return toAccount(row, this.currencies);
  }

  async findById(workspaceId: string, id: string): Promise<LedgerAccount | null> {
    if (!UUID.test(id)) return null;
    const row = await db()
      .selectFrom('ledger.ledger_account')
      .select(accountColumns)
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toAccount(row, this.currencies) : null;
  }

  private async insertIfAbsent(a: LedgerAccount, conflict: ReturnType<typeof sql>): Promise<void> {
    await sql`
      INSERT INTO ledger.ledger_account (id, workspace_id, type, currency, system_kind, source_account_id, code)
      VALUES (${a.id}, ${a.workspaceId}, ${a.nature}, ${a.currency.code}, ${a.systemKind}, ${a.sourceAccountId},
              ${a.code.value})
      ON CONFLICT ${conflict} DO NOTHING`.execute(db());
  }
}

type EntryRow = LedgerDb['ledger.journal_entry'];

/** Repositorio append-only de asientos: solo INSERT y SELECT (sin grants de UPDATE/DELETE en la BD). */
export class PgJournalEntryRepository implements JournalEntryRepository {
  constructor(private readonly accounts: LedgerAccountRepository) {}

  async append(entry: JournalEntry): Promise<JournalEntry> {
    try {
      return await this.insert(entry);
    } catch (err) {
      // Carrera con otra transacción sobre el mismo origen (índice único de idempotencia, design §Decisiones 5):
      // dos reversas concurrentes del mismo asiento chocan aquí antes que en la PK de `entry_reversal`.
      const constraint = (err as { constraint?: string }).constraint;
      if (pgCode(err) === '23505' && constraint === 'journal_entry_source_uk') {
        throw entry.entryType === 'REVERSAL'
          ? new DomainError(
              'LEDGER_ENTRY_ALREADY_REVERSED',
              `entry ${entry.reversesEntryId} was already reversed`,
              { cause: err },
            )
          : new DomainError('CONCURRENCY_CONFLICT', 'the source was posted concurrently; retry', {
              cause: err,
            });
      }
      throw err;
    }
  }

  private async insert(entry: JournalEntry): Promise<JournalEntry> {
    const inserted = await db()
      .insertInto('ledger.journal_entry')
      .values({
        id: entry.id,
        workspace_id: entry.workspaceId,
        entry_date: entry.entryDate.toString(),
        entry_type: entry.entryType,
        source_context: entry.sourceRef.context,
        source_type: entry.sourceRef.type,
        source_id: entry.sourceRef.id,
        source_revision: entry.sourceRef.revision,
        reverses_entry_id: entry.reversesEntryId,
        memo: entry.memo,
        correlation_id: entry.correlationId,
        created_by: entry.createdBy,
      } as never)
      .returning(sql<string>`sequence::text`.as('sequence'))
      .executeTakeFirstOrThrow();
    await db()
      .insertInto('ledger.posting')
      .values(
        entry.postings.map((p) => ({
          id: p.id,
          workspace_id: entry.workspaceId,
          journal_entry_id: entry.id,
          entry_date: entry.entryDate.toString(),
          line_no: p.lineNo,
          ledger_account_id: p.account.id,
          account_type: p.account.nature,
          currency: p.amount.currency.code,
          amount: p.amount.toNumeric(),
          split_id: p.splitId,
        })),
      )
      .execute();
    return entry.withSequence(inserted.sequence);
  }

  async findById(workspaceId: string, id: string): Promise<JournalEntry | null> {
    if (!UUID.test(id)) return null;
    const row = await this.entries()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? this.hydrate(row) : null;
  }

  async findBySource(
    workspaceId: string,
    source: SourceRef,
    entryType: EntryType,
  ): Promise<JournalEntry | null> {
    const row = await this.entries()
      .where('workspace_id', '=', workspaceId)
      .where('source_type', '=', source.type)
      .where('source_id', '=', source.id)
      .where('source_revision', '=', source.revision)
      .where('entry_type', '=', entryType)
      .executeTakeFirst();
    return row ? this.hydrate(row) : null;
  }

  async isReversed(workspaceId: string, entryId: string): Promise<boolean> {
    const row = await db()
      .selectFrom('ledger.entry_reversal')
      .select('original_entry_id')
      .where('workspace_id', '=', workspaceId)
      .where('original_entry_id', '=', entryId)
      .executeTakeFirst();
    return row !== undefined;
  }

  async recordReversal(workspaceId: string, originalId: string, reversalId: string): Promise<void> {
    // ON CONFLICT sobre la PK: con dos reversas concurrentes la segunda espera al commit de la primera y no inserta
    // (sin abortar la transacción) ⇒ LEDGER_ENTRY_ALREADY_REVERSED limpio (INV-008).
    const res = await sql`
      INSERT INTO ledger.entry_reversal (original_entry_id, reversal_entry_id, workspace_id)
      VALUES (${originalId}, ${reversalId}, ${workspaceId})
      ON CONFLICT (original_entry_id) DO NOTHING`.execute(db());
    if (res.numAffectedRows === 0n) {
      throw new DomainError('LEDGER_ENTRY_ALREADY_REVERSED', `entry ${originalId} was already reversed`);
    }
  }

  private entries() {
    return db()
      .selectFrom('ledger.journal_entry')
      .select([
        'id',
        'workspace_id',
        sql<string>`sequence::text`.as('sequence'),
        sql<string>`entry_date::text`.as('entry_date'),
        'entry_type',
        'source_context',
        'source_type',
        'source_id',
        'source_revision',
        'reverses_entry_id',
        'memo',
        'correlation_id',
        'created_by',
      ]);
  }

  private async hydrate(row: EntryRow): Promise<JournalEntry> {
    const postings = await db()
      .selectFrom('ledger.posting')
      .select([
        'id',
        'ledger_account_id',
        'currency',
        sql<string>`amount::text`.as('amount'),
        'split_id',
        'line_no',
      ])
      .where('workspace_id', '=', row.workspace_id)
      .where('journal_entry_id', '=', row.id)
      .orderBy('line_no')
      .execute();
    const resolved = [];
    for (const p of postings) {
      const account = await this.accounts.findById(row.workspace_id, p.ledger_account_id);
      if (!account) throw new DomainError('INTERNAL_ERROR', `posting ${p.id} without ledger account`);
      resolved.push({
        id: p.id,
        account,
        amount: Money.parse(p.amount, account.currency),
        splitId: p.split_id,
      });
    }
    return JournalEntry.restore(
      {
        id: row.id,
        workspaceId: row.workspace_id,
        entryDate: LocalDate.parse(row.entry_date),
        entryType: row.entry_type,
        sourceRef: {
          context: 'TRANSACTIONS',
          type: 'Transaction',
          id: row.source_id,
          revision: row.source_revision,
        },
        reversesEntryId: row.reverses_entry_id,
        memo: row.memo,
        correlationId: row.correlation_id,
        createdBy: row.created_by,
        postings: resolved,
      },
      row.sequence,
    );
  }
}

/** Bloqueo mensual (D10): `lock`/`unlock` idempotentes. */
export class PgPeriodLockRepository implements PeriodLockRepository {
  async isLocked(workspaceId: string, yearMonth: YearMonth): Promise<boolean> {
    const row = await db()
      .selectFrom('ledger.period_lock')
      .select('year_month')
      .where('workspace_id', '=', workspaceId)
      .where('year_month', '=', yearMonth.value)
      .executeTakeFirst();
    return row !== undefined;
  }

  async lock(lock: PeriodLock, lockedBy: string | null): Promise<boolean> {
    const res = await sql`
      INSERT INTO ledger.period_lock (workspace_id, year_month, period_id, locked_by)
      VALUES (${lock.workspaceId}, ${lock.yearMonth.value}, ${lock.periodId}, ${lockedBy})
      ON CONFLICT (workspace_id, year_month) DO NOTHING`.execute(db());
    return (res.numAffectedRows ?? 0n) > 0n;
  }

  async unlock(workspaceId: string, yearMonth: YearMonth): Promise<boolean> {
    const res = await db()
      .deleteFrom('ledger.period_lock')
      .where('workspace_id', '=', workspaceId)
      .where('year_month', '=', yearMonth.value)
      .executeTakeFirst();
    return res.numDeletedRows > 0n;
  }
}

export const uuidV7Ids: IdGenerator = { newId: () => uuidv7() };

/** Actor y correlación del contexto ambiental de la plataforma (petición HTTP o job). */
export const platformLedgerContext: LedgerRequestContext = {
  actorUserId: () => {
    const actor = currentRequestContext()?.actor;
    return actor && actor.type === 'USER' ? actor.userId : null;
  },
  correlationId: () => {
    const id = currentCorrelation()?.correlationId;
    return id && UUID.test(id) ? id : null;
  },
};
