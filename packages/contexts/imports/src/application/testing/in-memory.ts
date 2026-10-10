import type { AuditEntry } from '@pf/audit/contracts';
import { DomainError, FixedClock, Instant, LocalDate, dec } from '@pf/shared-kernel';
import type {
  DuplicateCandidatesQuery,
  ImportedTransactionsCommand,
  TransactionStatusQuery,
} from '@pf/transactions/contracts';
import {
  ImportJob,
  type Classification,
  type ClosedPeriodRange,
  type CsvMapping,
  type Decision,
  type ImportJobState,
} from '../../domain/index.js';
import type {
  AccountView,
  ImportJobFilter,
  ImportJobRepository,
  ImportsDeps,
  ImportsSettings,
  RowLinkInsert,
  RowLinkRepository,
  RowNormalization,
  StagedRow,
  StagingRepository,
  StagingSummary,
  UnitOfWork,
} from '../ports/index.js';

/** Dobles en memoria de los puertos de IMPORTS (tests de aplicación sin base de datos). */

export interface MemTransaction {
  readonly id: string;
  readonly kind: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'CONVERSION';
  status: 'POSTED' | 'VOIDED' | 'PENDING';
  readonly accountId: string;
  readonly date: string;
  /** Signo contable de la pata en la cuenta: salida negativa. */
  readonly signed: string;
  readonly currency: string;
  readonly description: string | null;
  readonly source: string;
  readonly externalRef: { namespace: string; id: string } | null;
  readonly importJobId: string | null;
  readonly categoryName: string | null;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface MemStaged extends Mutable<StagedRow> {
  readonly jobId: string;
}
interface MemLink {
  id: string;
  accountId: string;
  fingerprint: string;
  transactionId: string;
  stagedTransactionId: string | null;
  kind: 'CREATED' | 'SKIPPED_AS_DUPLICATE';
  status: 'ACTIVE' | 'SUPERSEDED';
}

const dayNumber = (date: string): number =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

export class MemoryWorld {
  jobs = new Map<string, ImportJobState>();
  staged: MemStaged[] = [];
  links: MemLink[] = [];
  transactions: MemTransaction[] = [];
  audit: AuditEntry[] = [];
  events: { eventType: string; aggregateId: string; payload: Record<string, unknown> }[] = [];
  accounts = new Map<string, AccountView>();
  closed: ClosedPeriodRange[] = [];
  balance = '4000.00';
  timeZone = 'America/La_Paz';
  /** Fechas (YYYY-MM-DD) cuyo registro lanza `PERIOD_CLOSED` en `recordBatch` (cierre entre la vista previa y la persistencia). */
  lockedDates = new Set<string>();
  /** Falla transitoria inyectada en `recordBatch` (no es un error de dominio). */
  transientFailureAt: number | null = null;
  recordBatchCalls = 0;
  private seq = 0;
  readonly clock = new FixedClock(Instant.parse('2026-10-20T14:00:00.000Z'));

  nextId(): string {
    this.seq += 1;
    return `00000000-0000-7000-8000-${String(this.seq).padStart(12, '0')}`;
  }

  snapshot(): string {
    return JSON.stringify({
      jobs: [...this.jobs],
      staged: this.staged,
      links: this.links,
      transactions: this.transactions,
      audit: this.audit,
      events: this.events,
    });
  }

  restore(snapshot: string): void {
    const s = JSON.parse(snapshot) as {
      jobs: [string, ImportJobState][];
      staged: MemStaged[];
      links: MemLink[];
      transactions: MemTransaction[];
      audit: AuditEntry[];
      events: MemoryWorld['events'];
    };
    this.jobs = new Map(s.jobs);
    this.staged = s.staged;
    this.links = s.links;
    this.transactions = s.transactions;
    this.audit = s.audit;
    this.events = s.events;
  }

  addAccount(account: Partial<AccountView> & { accountId: string }): AccountView {
    const full: AccountView = { currency: 'BOB', nature: 'ASSET', status: 'ACTIVE', ...account };
    this.accounts.set(full.accountId, full);
    return full;
  }

  addTransaction(
    t: Partial<MemTransaction> & Pick<MemTransaction, 'accountId' | 'date' | 'signed'>,
  ): MemTransaction {
    const full: MemTransaction = {
      id: this.nextId(),
      kind: Number(t.signed) < 0 ? 'EXPENSE' : 'INCOME',
      status: 'POSTED',
      currency: 'BOB',
      description: null,
      source: 'MANUAL',
      externalRef: null,
      importJobId: null,
      categoryName: null,
      ...t,
    };
    this.transactions.push(full);
    return full;
  }
}

class MemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly world: MemoryWorld) {}

  // Sin anidar transacciones reales: una excepción restaura el estado previo (rollback del lote).
  async run<T>(_workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const before = this.world.snapshot();
    try {
      return await fn();
    } catch (err) {
      this.world.restore(before);
      throw err;
    }
  }

  runDetached<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.run(workspaceId, fn);
  }
}

function toJob(state: ImportJobState): ImportJob {
  return ImportJob.rehydrate(state);
}

class MemoryJobs implements ImportJobRepository {
  constructor(private readonly w: MemoryWorld) {}

  async insert(job: ImportJob) {
    this.w.jobs.set(job.id, job.state);
  }

  async findById(_ws: string, id: string) {
    const s = this.w.jobs.get(id);
    return s ? toJob(s) : null;
  }

  async save(job: ImportJob) {
    const current = this.w.jobs.get(job.id);
    if (!current || current.version !== job.persistedVersion) return false;
    this.w.jobs.set(job.id, job.state);
    return true;
  }

  async list(_ws: string, filter: ImportJobFilter) {
    return [...this.w.jobs.values()]
      .filter(
        (j) =>
          (!filter.accountId || j.accountId === filter.accountId) &&
          (!filter.status || j.status === filter.status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, filter.limit)
      .map(toJob);
  }

  async findPreviousImported(_ws: string, accountId: string, fileChecksum: string) {
    const found = [...this.w.jobs.values()]
      .filter(
        (j) =>
          j.accountId === accountId &&
          j.fileChecksum === fileChecksum &&
          ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'PARTIALLY_FAILED'].includes(j.status),
      )
      .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))[0];
    return found ? { id: found.id, completedAt: found.completedAt ?? found.updatedAt } : null;
  }

  async lastMapping(_ws: string, accountId: string): Promise<CsvMapping | null> {
    const found = [...this.w.jobs.values()]
      .filter((j) => j.accountId === accountId && j.mapping)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return found?.mapping ?? null;
  }

  async expiredReviews(_ws: string, now: string, limit: number) {
    return [...this.w.jobs.values()]
      .filter(
        (j) =>
          (j.status === 'AWAITING_MAPPING' || j.status === 'AWAITING_REVIEW') &&
          j.expiresAt !== null &&
          j.expiresAt <= now,
      )
      .slice(0, limit)
      .map((j) => j.id);
  }

  async purgeable(_ws: string, cutoff: string, limit: number) {
    return [...this.w.jobs.values()]
      .filter(
        (j) =>
          ((['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(j.status) && (j.completedAt ?? '') <= cutoff) ||
            (j.status === 'CANCELLED' && (j.cancelledAt ?? '') <= cutoff)) &&
          this.w.staged.some((s) => s.jobId === j.id),
      )
      .slice(0, limit)
      .map((j) => j.id);
  }
}

class MemoryStaging implements StagingRepository {
  constructor(private readonly w: MemoryWorld) {}

  private rowsOf(jobId: string) {
    return this.w.staged.filter((s) => s.jobId === jobId);
  }

  async insertRaw(
    _ws: string,
    jobId: string,
    rows: readonly { id: string; rowNumber: number; raw: readonly string[] }[],
  ) {
    for (const r of rows) {
      this.w.staged.push({
        id: r.id,
        jobId,
        rowNumber: r.rowNumber,
        raw: r.raw,
        bookingDate: null,
        amount: null,
        currency: null,
        direction: null,
        description: null,
        occurrenceIndex: null,
        fingerprint: null,
        classification: null,
        decision: null,
        issues: [],
        matchedTransactionId: null,
        transactionId: null,
        batchNo: null,
        batchError: null,
      });
    }
  }

  async loadForMapping(_ws: string, jobId: string) {
    return this.rowsOf(jobId)
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .map((s) => ({
        id: s.id,
        rowNumber: s.rowNumber,
        raw: s.raw,
        fingerprint: s.fingerprint,
        classification: s.classification,
        decision: s.decision,
      }));
  }

  async applyNormalization(
    _ws: string,
    jobId: string,
    items: readonly RowNormalization[],
    resetIds: readonly string[],
  ) {
    const byId = new Map(this.rowsOf(jobId).map((s) => [s.id, s] as const));
    for (const i of items) {
      const s = byId.get(i.id) as MemStaged;
      Object.assign(s, {
        bookingDate: i.bookingDate,
        amount: i.amount,
        currency: i.currency,
        direction: i.direction,
        description: i.description,
        occurrenceIndex: i.occurrenceIndex,
        fingerprint: i.fingerprint,
        classification: i.classification,
        decision: i.decision,
        issues: i.issues,
        matchedTransactionId: i.matchedTransactionId,
        transactionId: null,
        batchNo: null,
        batchError: null,
      });
    }
    for (const id of resetIds) {
      const s = byId.get(id) as MemStaged;
      Object.assign(s, {
        bookingDate: null,
        amount: null,
        currency: null,
        direction: null,
        description: null,
        occurrenceIndex: null,
        fingerprint: null,
        classification: null,
        decision: null,
        issues: [],
        matchedTransactionId: null,
        transactionId: null,
        batchNo: null,
        batchError: null,
      });
    }
  }

  async summary(_ws: string, jobId: string): Promise<StagingSummary> {
    const rows = this.rowsOf(jobId);
    const count = (c: Classification) => rows.filter((r) => r.classification === c).length;
    const creatable = (r: MemStaged) =>
      r.decision === 'CREATE' && (r.classification === 'NEW' || r.classification === 'DUPLICATE_PROBABLE');
    const sum = (direction: 'IN' | 'OUT') =>
      rows
        .filter((r) => creatable(r) && r.direction === direction)
        .reduce((acc, r) => acc.plus(dec(r.amount as string)), dec('0'))
        .toFixed(2);
    return {
      rows: rows.filter((r) => r.classification !== null).length,
      byClassification: {
        NEW: count('NEW'),
        DUPLICATE_EXACT: count('DUPLICATE_EXACT'),
        DUPLICATE_PROBABLE: count('DUPLICATE_PROBABLE'),
        INVALID: count('INVALID'),
      },
      pendingDecisions: rows.filter((r) => r.classification === 'DUPLICATE_PROBABLE' && r.decision === null)
        .length,
      toCreate: rows.filter(creatable).length,
      skipped: rows.filter((r) => r.decision === 'SKIP' && r.classification === 'DUPLICATE_PROBABLE').length,
      excluded: rows.filter(
        (r) =>
          r.decision === 'EXCLUDE' &&
          (r.classification === 'NEW' || r.classification === 'DUPLICATE_PROBABLE'),
      ).length,
      outflows: sum('OUT'),
      inflows: sum('IN'),
      created: rows.filter((r) => r.transactionId !== null).length,
      failed: rows.filter((r) => r.batchError !== null && r.transactionId === null).length,
    };
  }

  async page(
    _ws: string,
    jobId: string,
    o: { classification?: Classification | undefined; afterRowNumber?: number | undefined; limit: number },
  ) {
    return this.rowsOf(jobId)
      .filter(
        (r) =>
          r.classification !== null &&
          (!o.classification || r.classification === o.classification) &&
          (o.afterRowNumber === undefined || r.rowNumber > o.afterRowNumber),
      )
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .slice(0, o.limit);
  }

  async find(_ws: string, jobId: string, rowId: string) {
    return this.rowsOf(jobId).find((r) => r.id === rowId) ?? null;
  }

  async setDecision(_ws: string, jobId: string, rowId: string, decision: Decision) {
    const row = this.rowsOf(jobId).find((r) => r.id === rowId);
    if (row) row.decision = decision;
  }

  async rowsToCreate(_ws: string, jobId: string) {
    return this.rowsOf(jobId)
      .filter(
        (r) =>
          r.decision === 'CREATE' &&
          (r.classification === 'NEW' || r.classification === 'DUPLICATE_PROBABLE'),
      )
      .map((r) => ({ rowId: r.id, bookingDate: r.bookingDate as string, lineNumber: r.rowNumber }));
  }

  async assignBatches(
    _ws: string,
    jobId: string,
    plan: readonly { batchNo: number; rowIds: readonly string[] }[],
  ) {
    const byId = new Map(this.rowsOf(jobId).map((r) => [r.id, r] as const));
    for (const b of plan) for (const id of b.rowIds) (byId.get(id) as MemStaged).batchNo = b.batchNo;
  }

  async skippedProbableRows(_ws: string, jobId: string) {
    return this.rowsOf(jobId)
      .filter(
        (r) =>
          r.classification === 'DUPLICATE_PROBABLE' &&
          r.decision === 'SKIP' &&
          r.matchedTransactionId &&
          r.fingerprint,
      )
      .map((r) => ({
        rowId: r.id,
        fingerprint: r.fingerprint as string,
        matchedTransactionId: r.matchedTransactionId as string,
      }));
  }

  async pendingBatchNumbers(_ws: string, jobId: string) {
    return [
      ...new Set(
        this.rowsOf(jobId)
          .filter((r) => r.batchNo !== null && r.transactionId === null && r.batchError === null)
          .map((r) => r.batchNo as number),
      ),
    ].sort((a, b) => a - b);
  }

  async loadBatch(_ws: string, jobId: string, batchNo: number) {
    return this.rowsOf(jobId)
      .filter((r) => r.batchNo === batchNo && r.transactionId === null && r.batchError === null)
      .sort((a, b) => (a.bookingDate ?? '').localeCompare(b.bookingDate ?? '') || a.rowNumber - b.rowNumber);
  }

  async markPersisted(_ws: string, items: readonly { rowId: string; transactionId: string }[]) {
    for (const i of items) {
      const row = this.w.staged.find((r) => r.id === i.rowId);
      if (row) row.transactionId = i.transactionId;
    }
  }

  async markBatchFailed(_ws: string, jobId: string, batchNo: number, error: { code: string }) {
    for (const r of this.rowsOf(jobId))
      if (r.batchNo === batchNo && r.transactionId === null) r.batchError = error;
  }

  async clearFailures(_ws: string, jobId: string) {
    for (const r of this.rowsOf(jobId)) if (r.transactionId === null) r.batchError = null;
  }

  async failures(_ws: string, jobId: string, limit: number) {
    const groups = new Map<string, number[]>();
    for (const r of this.rowsOf(jobId).sort((a, b) => a.rowNumber - b.rowNumber)) {
      if (r.batchError && r.transactionId === null) {
        groups.set(r.batchError.code, [...(groups.get(r.batchError.code) ?? []), r.rowNumber]);
      }
    }
    return [...groups].map(([code, lines]) => ({ code, count: lines.length, lines: lines.slice(0, limit) }));
  }

  async dateRange(_ws: string, jobId: string) {
    const dates = this.rowsOf(jobId)
      .filter((r) => r.transactionId !== null)
      .map((r) => r.bookingDate as string)
      .sort();
    return dates.length > 0 ? { from: dates[0] as string, to: dates.at(-1) as string } : null;
  }

  async deleteAll(_ws: string, jobId: string) {
    const before = this.w.staged.length;
    this.w.staged = this.w.staged.filter((s) => s.jobId !== jobId);
    return before - this.w.staged.length;
  }
}

class MemoryLinks implements RowLinkRepository {
  constructor(private readonly w: MemoryWorld) {}

  async findActive(_ws: string, accountId: string, fingerprints: readonly string[]) {
    const wanted = new Set(fingerprints);
    return this.w.links
      .filter((l) => l.accountId === accountId && l.status === 'ACTIVE' && wanted.has(l.fingerprint))
      .map((l) => ({ fingerprint: l.fingerprint, transactionId: l.transactionId }));
  }

  async insertMany(_ws: string, links: readonly RowLinkInsert[]) {
    for (const l of links) {
      const taken = this.w.links.some(
        (x) => x.accountId === l.accountId && x.fingerprint === l.fingerprint && x.status === 'ACTIVE',
      );
      if (!taken) this.w.links.push({ ...l, status: 'ACTIVE' });
    }
  }

  async supersede(_ws: string, accountId: string, fingerprints: readonly string[]) {
    const wanted = new Set(fingerprints);
    for (const l of this.w.links)
      if (l.accountId === accountId && l.status === 'ACTIVE' && wanted.has(l.fingerprint))
        l.status = 'SUPERSEDED';
  }

  async linkedTransactionIds(_ws: string, accountId: string, transactionIds: readonly string[]) {
    const wanted = new Set(transactionIds);
    return new Set(
      this.w.links
        .filter((l) => l.accountId === accountId && l.status === 'ACTIVE' && wanted.has(l.transactionId))
        .map((l) => l.transactionId),
    );
  }
}

/** Doble de `ImportedTransactionsCommand` (registro en lote) sobre el mundo en memoria. */
function memoryImported(w: MemoryWorld): ImportedTransactionsCommand {
  return {
    async recordBatch(input) {
      w.recordBatchCalls += 1;
      if (w.transientFailureAt === w.recordBatchCalls) throw new Error('connection reset');
      const created: { rowRef: string; transactionId: string }[] = [];
      const alreadyExisting: { rowRef: string; transactionId: string }[] = [];
      for (const row of input.rows) {
        const existing = w.transactions.find(
          (t) =>
            t.accountId === input.accountId &&
            t.status !== 'VOIDED' &&
            t.externalRef?.namespace === row.externalRef.namespace &&
            t.externalRef.id === row.externalRef.id,
        );
        if (existing) {
          alreadyExisting.push({ rowRef: row.rowRef, transactionId: existing.id });
          continue;
        }
        if (w.lockedDates.has(row.date) || w.closed.some((p) => p.start <= row.date && row.date <= p.end)) {
          throw new DomainError('PERIOD_CLOSED', `${row.date} is in a closed period`);
        }
        const tx = w.addTransaction({
          accountId: input.accountId,
          date: row.date,
          signed: row.direction === 'OUT' ? `-${row.amount.amount}` : row.amount.amount,
          currency: row.amount.currency,
          description: row.description,
          source: 'IMPORT',
          externalRef: row.externalRef,
          importJobId: input.importJobId,
          categoryName: row.direction === 'OUT' ? 'UNCATEGORIZED' : 'UNCATEGORIZED_INCOME',
        });
        created.push({ rowRef: row.rowRef, transactionId: tx.id });
      }
      return { created, alreadyExisting };
    },
  };
}

function memoryCandidates(w: MemoryWorld): DuplicateCandidatesQuery {
  return {
    async findForImport(input) {
      return input.rows.map((row) => ({
        rowRef: row.rowRef,
        candidates: w.transactions
          .filter(
            (t) =>
              t.accountId === input.accountId &&
              t.status !== 'VOIDED' &&
              t.currency === row.amount.currency &&
              dec(t.signed).abs().equals(dec(row.amount.amount)) &&
              (row.direction === 'OUT' ? dec(t.signed).isNegative() : dec(t.signed).isPositive()) &&
              Math.abs(dayNumber(t.date) - dayNumber(LocalDate.parse(row.date).toString())) <=
                input.windowDays &&
              !(input.excludeTransactionIds ?? []).includes(t.id),
          )
          .map((t) => ({
            transactionId: t.id,
            kind: t.kind,
            status: t.status,
            date: t.date,
            amount: { amount: row.amount.amount, currency: t.currency },
            description: t.description,
            counterpartyId: null,
          })),
      }));
    },
  };
}

function memoryStatuses(w: MemoryWorld): TransactionStatusQuery {
  return {
    async statusOf(input) {
      return w.transactions
        .filter((t) => input.transactionIds.includes(t.id))
        .map((t) => ({ transactionId: t.id, status: t.status }));
    },
  };
}

export const TEST_SETTINGS: ImportsSettings = {
  maxBytes: 2_097_152,
  maxRows: 5000,
  maxColumns: 50,
  batchSize: 200,
  reviewTtlMs: 30 * 86_400_000,
  stagingRetentionMs: 90 * 86_400_000,
  futureToleranceDays: 3,
  duplicateWindowDays: 3,
};

export function createMemoryDeps(world: MemoryWorld, settings: Partial<ImportsSettings> = {}): ImportsDeps {
  return {
    uow: new MemoryUnitOfWork(world),
    jobs: new MemoryJobs(world),
    staging: new MemoryStaging(world),
    links: new MemoryLinks(world),
    accounts: {
      async getAccount(_ws, accountId) {
        return world.accounts.get(accountId) ?? null;
      },
      async assertActive(_ws, accountId) {
        const a = world.accounts.get(accountId);
        if (!a) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
        if (a.status === 'CLOSED') throw new DomainError('ACCOUNT_CLOSED', 'the account is closed');
        if (a.status === 'ARCHIVED') throw new DomainError('ACCOUNT_ARCHIVED', 'the account is archived');
        return a;
      },
    },
    balances: {
      async presentedBalance() {
        return world.balance;
      },
    },
    currencies: {
      async scaleOf(code) {
        return ({ BOB: 2, USD: 2, JPY: 0 } as Record<string, number>)[code] ?? null;
      },
    },
    calendar: { timeZoneOf: async () => world.timeZone },
    periods: { listClosed: async () => world.closed },
    imported: memoryImported(world),
    duplicates: memoryCandidates(world),
    statuses: memoryStatuses(world),
    audit: {
      async append(entry) {
        world.audit.push(entry);
      },
    },
    outbox: {
      async append(event) {
        world.events.push({
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          payload: event.payload as Record<string, unknown>,
        });
      },
    },
    ids: { next: () => world.nextId() },
    clock: world.clock,
    settings: { ...TEST_SETTINGS, ...settings },
  };
}
