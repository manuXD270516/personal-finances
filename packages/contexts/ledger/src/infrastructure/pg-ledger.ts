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
  firstOpenDateOnOrAfter,
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
    period_start: string;
    period_end: string;
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

  /**
   * Asientos y postings por conjunto (openspec add-bulk-imported-transactions decisión 3): `INSERT … SELECT FROM
   * unnest(…)` de arreglos tipados (sin concatenar SQL). Los disparadores de integridad (suma cero por moneda, ≥ 2
   * postings, periodo abierto, inmutabilidad) siguen activos por fila: el conjunto no los esquiva.
   */
  async appendMany(entries: readonly JournalEntry[]): Promise<readonly JournalEntry[]> {
    const first = entries[0];
    if (!first) return [];
    try {
      return await this.insertMany(first.workspaceId, entries);
    } catch (err) {
      if (
        pgCode(err) === '23505' &&
        (err as { constraint?: string }).constraint === 'journal_entry_source_uk'
      ) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'the source was posted concurrently; retry', {
          cause: err,
        });
      }
      throw err;
    }
  }

  private async insertMany(workspaceId: string, entries: readonly JournalEntry[]): Promise<JournalEntry[]> {
    await sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${'ledger.balance_snapshot:' + workspaceId}, 0))`.execute(
      db(),
    );
    const inserted = await sql<{ id: string; sequence: string }>`
      INSERT INTO ledger.journal_entry
        (id, workspace_id, entry_date, entry_type, source_type, source_id, source_revision, reverses_entry_id, memo,
         correlation_id, created_by)
      SELECT t.id, ${workspaceId}::uuid, t.entry_date, t.entry_type, t.source_type, t.source_id, t.source_revision,
             t.reverses_entry_id, t.memo, t.correlation_id, t.created_by
        FROM unnest(
          ${entries.map((e) => e.id)}::uuid[], ${entries.map((e) => e.entryDate.toString())}::date[],
          ${entries.map((e) => e.entryType)}::text[], ${entries.map((e) => e.sourceRef.type)}::text[],
          ${entries.map((e) => e.sourceRef.id)}::uuid[], ${entries.map((e) => e.sourceRef.revision)}::int[],
          ${entries.map((e) => e.reversesEntryId)}::uuid[], ${entries.map((e) => e.memo)}::text[],
          ${entries.map((e) => e.correlationId)}::uuid[], ${entries.map((e) => e.createdBy)}::uuid[]
        ) WITH ORDINALITY AS t(id, entry_date, entry_type, source_type, source_id, source_revision, reverses_entry_id,
                               memo, correlation_id, created_by, ord)
       ORDER BY t.ord
      RETURNING id, sequence::text AS sequence`.execute(db());
    const sequenceOf = new Map(inserted.rows.map((r) => [r.id, r.sequence]));
    const lines = entries.flatMap((e) => e.postings.map((p) => ({ e, p })));
    await sql`
      INSERT INTO ledger.posting
        (id, workspace_id, journal_entry_id, entry_date, line_no, ledger_account_id, account_type, currency, amount,
         split_id)
      SELECT t.id, ${workspaceId}::uuid, t.journal_entry_id, t.entry_date, t.line_no, t.ledger_account_id,
             t.account_type, t.currency, t.amount, t.split_id
        FROM unnest(
          ${lines.map((l) => l.p.id)}::uuid[], ${lines.map((l) => l.e.id)}::uuid[],
          ${lines.map((l) => l.e.entryDate.toString())}::date[], ${lines.map((l) => l.p.lineNo)}::smallint[],
          ${lines.map((l) => l.p.account.id)}::uuid[], ${lines.map((l) => l.p.account.nature)}::text[],
          ${lines.map((l) => l.p.amount.currency.code)}::text[], ${lines.map((l) => l.p.amount.toNumeric())}::numeric[],
          ${lines.map((l) => l.p.splitId)}::uuid[]
        ) WITH ORDINALITY AS t(id, journal_entry_id, entry_date, line_no, ledger_account_id, account_type, currency,
                               amount, split_id, ord)
       ORDER BY t.ord`.execute(db());
    return entries.map((e) => e.withSequence(sequenceOf.get(e.id) ?? ''));
  }

  /** Asientos existentes de esos orígenes (una consulta): `${source_id}|${source_revision}` → id y secuencia. */
  async existingBySources(
    workspaceId: string,
    sources: readonly SourceRef[],
    entryType: EntryType,
  ): Promise<ReadonlyMap<string, { readonly id: string; readonly sequence: string }>> {
    if (sources.length === 0) return new Map();
    const { rows } = await sql<{ id: string; sequence: string; source_id: string; source_revision: number }>`
      SELECT e.id, e.sequence::text AS sequence, e.source_id, e.source_revision
        FROM unnest(${sources.map((x) => x.type)}::text[], ${sources.map((x) => x.id)}::uuid[],
                    ${sources.map((x) => x.revision)}::int[]) AS s(source_type, source_id, source_revision)
        JOIN ledger.journal_entry e
          ON e.workspace_id = ${workspaceId}::uuid AND e.source_type = s.source_type AND e.source_id = s.source_id
         AND e.source_revision = s.source_revision AND e.entry_type = ${entryType}`.execute(db());
    return new Map(
      rows.map((r) => [`${r.source_id}|${r.source_revision}`, { id: r.id, sequence: r.sequence }]),
    );
  }

  private async insert(entry: JournalEntry): Promise<JournalEntry> {
    // Candado compartido por workspace: espera a un `RebuildBalanceSnapshots` en curso (exclusivo) para que el
    // checkpoint `last_sequence` de los snapshots sea exacto (pg-ledger-maintenance.ts).
    await sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${'ledger.balance_snapshot:' + entry.workspaceId}, 0))`.execute(
      db(),
    );
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

  async findManyById(workspaceId: string, ids: readonly string[]): Promise<readonly JournalEntry[]> {
    const valid = ids.filter((id) => UUID.test(id));
    if (valid.length === 0) return [];
    const rows = await this.entries()
      .where('workspace_id', '=', workspaceId)
      .where('id', 'in', valid)
      .execute();
    if (rows.length === 0) return [];
    const postings = await db()
      .selectFrom('ledger.posting')
      .select([
        'id',
        'journal_entry_id',
        'ledger_account_id',
        'currency',
        sql<string>`amount::text`.as('amount'),
        'split_id',
        'line_no',
      ])
      .where('workspace_id', '=', workspaceId)
      .where(
        'journal_entry_id',
        'in',
        rows.map((r) => r.id),
      )
      .orderBy('line_no')
      .execute();
    const accountCache = new Map<string, LedgerAccount>();
    const result: JournalEntry[] = [];
    for (const row of rows) {
      const resolved = [];
      for (const p of postings.filter((x) => x.journal_entry_id === row.id)) {
        let account = accountCache.get(p.ledger_account_id);
        if (!account) {
          const found = await this.accounts.findById(workspaceId, p.ledger_account_id);
          if (!found) throw new DomainError('INTERNAL_ERROR', `posting ${p.id} without ledger account`);
          accountCache.set(p.ledger_account_id, found);
          account = found;
        }
        resolved.push({
          id: p.id,
          account,
          amount: Money.parse(p.amount, account.currency),
          splitId: p.split_id,
        });
      }
      result.push(
        JournalEntry.restore(
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
        ),
      );
    }
    return result;
  }

  async reversedAmong(workspaceId: string, ids: readonly string[]): Promise<ReadonlySet<string>> {
    const valid = ids.filter((id) => UUID.test(id));
    if (valid.length === 0) return new Set();
    const rows = await db()
      .selectFrom('ledger.entry_reversal')
      .select('original_entry_id')
      .where('workspace_id', '=', workspaceId)
      .where('original_entry_id', 'in', valid)
      .execute();
    return new Set(rows.map((r) => r.original_entry_id));
  }

  async recordReversals(
    workspaceId: string,
    pairs: readonly { readonly originalId: string; readonly reversalId: string }[],
  ): Promise<void> {
    if (pairs.length === 0) return;
    const res = await sql`
      INSERT INTO ledger.entry_reversal (original_entry_id, reversal_entry_id, workspace_id)
      SELECT t.o, t.r, ${workspaceId}::uuid
        FROM unnest(${pairs.map((p) => p.originalId)}::uuid[], ${pairs.map((p) => p.reversalId)}::uuid[]) AS t(o, r)
      ON CONFLICT (original_entry_id) DO NOTHING`.execute(db());
    if (Number(res.numAffectedRows ?? 0n) !== pairs.length) {
      throw new DomainError('LEDGER_ENTRY_ALREADY_REVERSED', 'an entry of the batch was already reversed');
    }
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

/** Bloqueo por rango del periodo financiero (ADR-0028): `lock`/`unlock` idempotentes. */
export class PgPeriodLockRepository implements PeriodLockRepository {
  async isLocked(workspaceId: string, date: LocalDate): Promise<boolean> {
    const res = await sql<{ locked: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM ledger.period_lock l
         WHERE l.workspace_id = ${workspaceId}
           AND ${date.toString()}::date BETWEEN l.period_start AND l.period_end) AS locked`.execute(db());
    return res.rows[0]?.locked === true;
  }

  async lockedDates(workspaceId: string, dates: readonly LocalDate[]): Promise<ReadonlySet<string>> {
    if (dates.length === 0) return new Set();
    const { rows } = await sql<{ d: string }>`
      SELECT d.d::text AS d
        FROM unnest(${dates.map((x) => x.toString())}::date[]) AS d(d)
       WHERE EXISTS (
         SELECT 1 FROM ledger.period_lock l
          WHERE l.workspace_id = ${workspaceId}::uuid AND d.d BETWEEN l.period_start AND l.period_end)`.execute(
      db(),
    );
    return new Set(rows.map((r) => r.d));
  }

  async lock(lock: PeriodLock, lockedBy: string | null): Promise<boolean> {
    // Una colisión de la exclusión gist (rango solapado con OTRO periodo) NO la cubre el ON CONFLICT: es un error real.
    const start = lock.periodStart === null ? '-infinity' : lock.periodStart.toString();
    const res = await sql`
      INSERT INTO ledger.period_lock (workspace_id, year_month, period_id, period_start, period_end, locked_by)
      VALUES (${lock.workspaceId}, ${lock.yearMonth.value}, ${lock.periodId}, ${start}::date,
              ${lock.periodEnd.toString()}::date, ${lockedBy})
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

  async firstOpenDateOnOrAfter(workspaceId: string, date: LocalDate): Promise<LocalDate> {
    // Fechas como texto (`::text`): evita el parser de `date` de pg. Los locks de un workspace son pocos (≤ 1 por periodo).
    const res = await sql<{ period_start: string; period_end: string }>`
      SELECT period_start::text AS period_start, period_end::text AS period_end
        FROM ledger.period_lock WHERE workspace_id = ${workspaceId} ORDER BY period_end`.execute(db());
    const ranges = res.rows.map((r) => ({
      periodStart: r.period_start === '-infinity' ? null : LocalDate.parse(r.period_start),
      periodEnd: LocalDate.parse(r.period_end),
    }));
    return firstOpenDateOnOrAfter(ranges, date);
  }

  async acquireExclusiveWorkspaceLock(workspaceId: string): Promise<void> {
    // La MISMA clave que cada posteo toma en modo compartido (`PgJournalEntryRepository.insert`).
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'ledger.balance_snapshot:' + workspaceId}, 0))`.execute(
      db(),
    );
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
