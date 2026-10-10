import { currentRequestContext, PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { dec } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import type {
  CurrencyCatalogPort,
  IdGenerator,
  ImportJobFilter,
  ImportJobRepository,
  RowLinkInsert,
  RowLinkRepository,
  RowNormalization,
  StagedRow,
  StagingRepository,
  StagingSummary,
  UnitOfWork,
} from '../application/ports/index.js';
import {
  ImportJob,
  type Classification,
  type CsvMapping,
  type Decision,
  type ImportJobState,
  type RowIssue,
} from '../domain/index.js';

const db = () => unitOfWorkKysely<Record<string, never>>();

/** Unidad de trabajo de IMPORTS: transacción PG con el contexto RLS del workspace; reutiliza la del llamador. */
export class PgImportsUnitOfWork implements UnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(pool: Pool) {
    this.uow = new PgUnitOfWork(pool);
  }

  private ctx(workspaceId: string) {
    const actor = currentRequestContext()?.actor;
    return { userId: actor && actor.type === 'USER' ? actor.userId : null, workspaceId };
  }

  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.uow.run(this.ctx(workspaceId), fn);
  }

  runDetached<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.uow.runDetached(this.ctx(workspaceId), fn);
  }
}

export const uuidV7Ids: IdGenerator = { next: () => uuidv7() };

/** Alcance de `fx.currency` (tabla de referencia): escala de la moneda de la cuenta. */
export const pgCurrencyCatalog: CurrencyCatalogPort = {
  async scaleOf(code) {
    const { rows } = await sql<{ scale: number }>`
      SELECT scale FROM fx.currency WHERE code = ${code} AND is_active`.execute(db());
    return rows[0] ? Number(rows[0].scale) : null;
  },
};

const CHUNK = 1000;
const chunks = <T>(items: readonly T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
};

// ───────────────────────────────────────────────────────────── import_job

interface JobRow {
  id: string;
  workspace_id: string;
  target_account_id: string;
  status: ImportJobState['status'];
  original_name: string | null;
  file_checksum: string;
  file_size_bytes: number;
  encoding: ImportJobState['encoding'];
  delimiter: ImportJobState['delimiter'];
  row_count: number;
  column_count: number;
  header: string[];
  mapping: CsvMapping | null;
  counters: ImportJobState['counters'];
  progress: ImportJobState['progress'];
  errors: ImportJobState['errors'];
  warnings: ImportJobState['warnings'];
  approved_by: string | null;
  approved_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
}

const JOB_COLUMNS = sql`
  j.id, j.workspace_id, j.target_account_id, j.status, j.original_name, encode(j.file_checksum, 'hex') AS file_checksum,
  j.file_size_bytes, j.encoding, j.delimiter, j.row_count, j.column_count, j.header, j.mapping, j.counters, j.progress,
  j.errors, j.warnings, j.approved_by,
  to_char(j.approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS approved_at,
  to_char(j.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS completed_at,
  to_char(j.cancelled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS cancelled_at,
  j.cancelled_by,
  to_char(j.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at,
  j.created_by,
  to_char(j.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(j.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
  j.version`;

const toJob = (r: JobRow): ImportJob =>
  ImportJob.rehydrate({
    id: r.id,
    workspaceId: r.workspace_id,
    accountId: r.target_account_id,
    status: r.status,
    originalName: r.original_name,
    fileChecksum: r.file_checksum,
    fileSizeBytes: Number(r.file_size_bytes),
    encoding: r.encoding,
    delimiter: r.delimiter,
    rowCount: Number(r.row_count),
    columnCount: Number(r.column_count),
    header: r.header,
    mapping: r.mapping,
    counters: r.counters,
    progress: r.progress,
    errors: r.errors,
    warnings: r.warnings,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    cancelledBy:
      r.cancelled_at === null
        ? null
        : r.cancelled_by === null
          ? { type: 'SYSTEM' }
          : { type: 'USER', userId: r.cancelled_by },
    expiresAt: r.expires_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: Number(r.version),
  });

const json = (value: unknown): string => JSON.stringify(value);

export class PgImportJobRepository implements ImportJobRepository {
  async insert(job: ImportJob): Promise<void> {
    const s = job.state;
    await sql`
      INSERT INTO imports.import_job
        (id, workspace_id, target_account_id, status, original_name, file_checksum, file_size_bytes, encoding, delimiter,
         row_count, column_count, header, mapping, counters, progress, errors, warnings, approved_by, approved_at,
         completed_at, cancelled_at, cancelled_by, expires_at, created_by, created_at, updated_at, version)
      VALUES
        (${s.id}, ${s.workspaceId}, ${s.accountId}, ${s.status}, ${s.originalName}, decode(${s.fileChecksum}, 'hex'),
         ${s.fileSizeBytes}, ${s.encoding}, ${s.delimiter}, ${s.rowCount}, ${s.columnCount}, ${json(s.header)}::jsonb,
         ${s.mapping === null ? null : json(s.mapping)}::jsonb, ${json(s.counters)}::jsonb, ${json(s.progress)}::jsonb,
         ${json(s.errors)}::jsonb, ${json(s.warnings)}::jsonb, ${s.approvedBy}, ${s.approvedAt}::timestamptz,
         ${s.completedAt}::timestamptz, ${s.cancelledAt}::timestamptz,
         ${s.cancelledBy && s.cancelledBy.type === 'USER' ? s.cancelledBy.userId : null},
         ${s.expiresAt}::timestamptz, ${s.createdBy}, ${s.createdAt}::timestamptz, ${s.updatedAt}::timestamptz,
         ${s.version})`.execute(db());
  }

  async findById(workspaceId: string, id: string, options?: { readonly lock?: 'update' }) {
    const { rows } = await sql<JobRow>`
      SELECT ${JOB_COLUMNS} FROM imports.import_job j
       WHERE j.workspace_id = ${workspaceId} AND j.id = ${id}
       ${options?.lock === 'update' ? sql`FOR UPDATE` : sql``}`.execute(db());
    return rows[0] ? toJob(rows[0]) : null;
  }

  async save(job: ImportJob): Promise<boolean> {
    const s = job.state;
    const result = await sql`
      UPDATE imports.import_job SET
        status = ${s.status}, mapping = ${s.mapping === null ? null : json(s.mapping)}::jsonb,
        counters = ${json(s.counters)}::jsonb, progress = ${json(s.progress)}::jsonb, errors = ${json(s.errors)}::jsonb,
        warnings = ${json(s.warnings)}::jsonb, approved_by = ${s.approvedBy}, approved_at = ${s.approvedAt}::timestamptz,
        completed_at = ${s.completedAt}::timestamptz, cancelled_at = ${s.cancelledAt}::timestamptz,
        cancelled_by = ${s.cancelledBy && s.cancelledBy.type === 'USER' ? s.cancelledBy.userId : null},
        expires_at = ${s.expiresAt}::timestamptz, updated_at = ${s.updatedAt}::timestamptz, version = ${s.version}
       WHERE workspace_id = ${s.workspaceId} AND id = ${s.id} AND version = ${job.persistedVersion}`.execute(
      db(),
    );
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  async list(workspaceId: string, filter: ImportJobFilter): Promise<ImportJob[]> {
    const { rows } = await sql<JobRow>`
      SELECT ${JOB_COLUMNS} FROM imports.import_job j
       WHERE j.workspace_id = ${workspaceId}
         AND (${filter.accountId ?? null}::uuid IS NULL OR j.target_account_id = ${filter.accountId ?? null}::uuid)
         AND (${filter.status ?? null}::text IS NULL OR j.status = ${filter.status ?? null}::text)
         AND (${filter.after ? filter.after[0] : null}::timestamptz IS NULL
              OR (j.created_at, j.id) < (${filter.after ? filter.after[0] : null}::timestamptz,
                                         ${filter.after ? filter.after[1] : null}::uuid))
       ORDER BY j.created_at DESC, j.id DESC
       LIMIT ${filter.limit}`.execute(db());
    return rows.map(toJob);
  }

  async findPreviousImported(workspaceId: string, accountId: string, fileChecksum: string) {
    const { rows } = await sql<{ id: string; completed_at: string }>`
      SELECT j.id, to_char(COALESCE(j.completed_at, j.updated_at) AT TIME ZONE 'UTC',
                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS completed_at
        FROM imports.import_job j
       WHERE j.workspace_id = ${workspaceId} AND j.target_account_id = ${accountId}
         AND j.file_checksum = decode(${fileChecksum}, 'hex')
         AND j.status IN ('COMPLETED', 'COMPLETED_WITH_ERRORS', 'PARTIALLY_FAILED')
       ORDER BY COALESCE(j.completed_at, j.updated_at) DESC, j.id DESC
       LIMIT 1`.execute(db());
    return rows[0] ? { id: rows[0].id, completedAt: rows[0].completed_at } : null;
  }

  async lastMapping(workspaceId: string, accountId: string): Promise<CsvMapping | null> {
    const { rows } = await sql<{ mapping: CsvMapping }>`
      SELECT j.mapping FROM imports.import_job j
       WHERE j.workspace_id = ${workspaceId} AND j.target_account_id = ${accountId} AND j.mapping IS NOT NULL
       ORDER BY j.created_at DESC, j.id DESC LIMIT 1`.execute(db());
    return rows[0]?.mapping ?? null;
  }

  async expiredReviews(workspaceId: string, now: string, limit: number): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      SELECT j.id FROM imports.import_job j
       WHERE j.workspace_id = ${workspaceId} AND j.status IN ('AWAITING_MAPPING', 'AWAITING_REVIEW')
         AND j.expires_at IS NOT NULL AND j.expires_at <= ${now}::timestamptz
       ORDER BY j.expires_at, j.id LIMIT ${limit}`.execute(db());
    return rows.map((r) => r.id);
  }

  async purgeable(workspaceId: string, cutoff: string, limit: number): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      SELECT j.id FROM imports.import_job j
       WHERE j.workspace_id = ${workspaceId}
         AND ((j.status IN ('COMPLETED', 'COMPLETED_WITH_ERRORS') AND j.completed_at <= ${cutoff}::timestamptz)
              OR (j.status = 'CANCELLED' AND j.cancelled_at <= ${cutoff}::timestamptz))
         AND EXISTS (SELECT 1 FROM imports.staged_transaction s
                      WHERE s.workspace_id = j.workspace_id AND s.import_job_id = j.id)
       ORDER BY j.id LIMIT ${limit}`.execute(db());
    return rows.map((r) => r.id);
  }
}

// ───────────────────────────────────────────────────────────── staged_transaction

interface StagedDbRow {
  id: string;
  row_number: number;
  raw: string[];
  booking_date: string | null;
  amount: string | null;
  scale: number | null;
  currency: string | null;
  direction: StagedRow['direction'];
  description: string | null;
  occurrence_index: number | null;
  fingerprint: string | null;
  classification: Classification | null;
  decision: Decision | null;
  issues: RowIssue[];
  matched_transaction_id: string | null;
  transaction_id: string | null;
  batch_no: number | null;
  batch_error: { code: string } | null;
}

const STAGED_COLUMNS = sql`
  s.id, s.row_number, s.raw, s.booking_date::text AS booking_date, s.amount::text AS amount, c.scale AS scale,
  s.currency, s.direction, s.description, s.occurrence_index, encode(s.fingerprint, 'hex') AS fingerprint,
  s.classification, s.decision, s.issues, s.matched_transaction_id, s.transaction_id, s.batch_no, s.batch_error`;

const toStaged = (r: StagedDbRow): StagedRow => ({
  id: r.id,
  rowNumber: Number(r.row_number),
  raw: r.raw,
  bookingDate: r.booking_date,
  amount: r.amount === null ? null : dec(r.amount).toFixed(r.scale === null ? 18 : Number(r.scale)),
  currency: r.currency,
  direction: r.direction,
  description: r.description,
  occurrenceIndex: r.occurrence_index === null ? null : Number(r.occurrence_index),
  fingerprint: r.fingerprint,
  classification: r.classification,
  decision: r.decision,
  issues: r.issues,
  matchedTransactionId: r.matched_transaction_id,
  transactionId: r.transaction_id,
  batchNo: r.batch_no === null ? null : Number(r.batch_no),
  batchError: r.batch_error,
});

export class PgStagingRepository implements StagingRepository {
  async insertRaw(
    workspaceId: string,
    jobId: string,
    rows: readonly { readonly id: string; readonly rowNumber: number; readonly raw: readonly string[] }[],
  ): Promise<void> {
    for (const part of chunks(rows)) {
      await sql`
        INSERT INTO imports.staged_transaction (id, workspace_id, import_job_id, row_number, raw)
        SELECT (e->>'id')::uuid, ${workspaceId}::uuid, ${jobId}::uuid, (e->>'n')::int, e->'raw'
          FROM jsonb_array_elements(${json(part.map((r) => ({ id: r.id, n: r.rowNumber, raw: r.raw })))}::jsonb) e`.execute(
        db(),
      );
    }
  }

  async loadForMapping(workspaceId: string, jobId: string) {
    const { rows } = await sql<{
      id: string;
      row_number: number;
      raw: string[];
      fingerprint: string | null;
      classification: Classification | null;
      decision: Decision | null;
    }>`
      SELECT s.id, s.row_number, s.raw, encode(s.fingerprint, 'hex') AS fingerprint, s.classification, s.decision
        FROM imports.staged_transaction s
       WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId}
       ORDER BY s.row_number`.execute(db());
    return rows.map((r) => ({
      id: r.id,
      rowNumber: Number(r.row_number),
      raw: r.raw,
      fingerprint: r.fingerprint,
      classification: r.classification,
      decision: r.decision,
    }));
  }

  async applyNormalization(
    workspaceId: string,
    jobId: string,
    items: readonly RowNormalization[],
    resetIds: readonly string[],
  ): Promise<void> {
    for (const part of chunks(items)) {
      await sql`
        UPDATE imports.staged_transaction s SET
          booking_date = (v->>'bookingDate')::date, amount = (v->>'amount')::numeric, currency = v->>'currency',
          direction = v->>'direction', description = v->>'description',
          occurrence_index = (v->>'occurrenceIndex')::int, fingerprint = decode(v->>'fingerprint', 'hex'),
          classification = v->>'classification', decision = v->>'decision', issues = v->'issues',
          matched_transaction_id = (v->>'matchedTransactionId')::uuid,
          transaction_id = NULL, batch_no = NULL, batch_error = NULL
          FROM jsonb_array_elements(${json(part)}::jsonb) v
         WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId} AND s.id = (v->>'id')::uuid`.execute(
        db(),
      );
    }
    for (const part of chunks(resetIds)) {
      await sql`
        UPDATE imports.staged_transaction s SET
          booking_date = NULL, amount = NULL, currency = NULL, direction = NULL, description = NULL,
          occurrence_index = NULL, fingerprint = NULL, classification = NULL, decision = NULL,
          issues = '[]'::jsonb, matched_transaction_id = NULL, transaction_id = NULL, batch_no = NULL, batch_error = NULL
         WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId} AND s.id = ANY(${part}::uuid[])`.execute(
        db(),
      );
    }
  }

  async summary(workspaceId: string, jobId: string): Promise<StagingSummary> {
    const { rows } = await sql<Record<string, string>>`
      SELECT
        count(*) FILTER (WHERE s.classification IS NOT NULL) AS rows,
        count(*) FILTER (WHERE s.classification = 'NEW') AS c_new,
        count(*) FILTER (WHERE s.classification = 'DUPLICATE_EXACT') AS c_exact,
        count(*) FILTER (WHERE s.classification = 'DUPLICATE_PROBABLE') AS c_probable,
        count(*) FILTER (WHERE s.classification = 'INVALID') AS c_invalid,
        count(*) FILTER (WHERE s.classification = 'DUPLICATE_PROBABLE' AND s.decision IS NULL) AS pending,
        count(*) FILTER (WHERE s.decision = 'CREATE' AND s.classification IN ('NEW', 'DUPLICATE_PROBABLE')) AS to_create,
        count(*) FILTER (WHERE s.decision = 'SKIP' AND s.classification = 'DUPLICATE_PROBABLE') AS skipped,
        count(*) FILTER (WHERE s.decision = 'EXCLUDE' AND s.classification IN ('NEW', 'DUPLICATE_PROBABLE')) AS excluded,
        COALESCE(sum(s.amount) FILTER (WHERE s.decision = 'CREATE' AND s.classification IN ('NEW', 'DUPLICATE_PROBABLE')
                                         AND s.direction = 'OUT'), 0)::text AS outflows,
        COALESCE(sum(s.amount) FILTER (WHERE s.decision = 'CREATE' AND s.classification IN ('NEW', 'DUPLICATE_PROBABLE')
                                         AND s.direction = 'IN'), 0)::text AS inflows,
        count(*) FILTER (WHERE s.transaction_id IS NOT NULL) AS created,
        count(*) FILTER (WHERE s.batch_error IS NOT NULL AND s.transaction_id IS NULL) AS failed
        FROM imports.staged_transaction s
       WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId}`.execute(db());
    const r = rows[0] as Record<string, string>;
    const n = (k: string) => Number(r[k]);
    return {
      rows: n('rows'),
      byClassification: {
        NEW: n('c_new'),
        DUPLICATE_EXACT: n('c_exact'),
        DUPLICATE_PROBABLE: n('c_probable'),
        INVALID: n('c_invalid'),
      },
      pendingDecisions: n('pending'),
      toCreate: n('to_create'),
      skipped: n('skipped'),
      excluded: n('excluded'),
      outflows: r['outflows'] as string,
      inflows: r['inflows'] as string,
      created: n('created'),
      failed: n('failed'),
    };
  }

  async page(
    workspaceId: string,
    jobId: string,
    options: {
      classification?: Classification | undefined;
      afterRowNumber?: number | undefined;
      limit: number;
    },
  ): Promise<StagedRow[]> {
    const { rows } = await sql<StagedDbRow>`
      SELECT ${STAGED_COLUMNS}
        FROM imports.staged_transaction s LEFT JOIN fx.currency c ON c.code = s.currency
       WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId} AND s.classification IS NOT NULL
         AND (${options.classification ?? null}::text IS NULL OR s.classification = ${options.classification ?? null}::text)
         AND (${options.afterRowNumber ?? null}::int IS NULL OR s.row_number > ${options.afterRowNumber ?? null}::int)
       ORDER BY s.row_number LIMIT ${options.limit}`.execute(db());
    return rows.map(toStaged);
  }

  async find(workspaceId: string, jobId: string, rowId: string): Promise<StagedRow | null> {
    const { rows } = await sql<StagedDbRow>`
      SELECT ${STAGED_COLUMNS}
        FROM imports.staged_transaction s LEFT JOIN fx.currency c ON c.code = s.currency
       WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId} AND s.id = ${rowId}`.execute(
      db(),
    );
    return rows[0] ? toStaged(rows[0]) : null;
  }

  async setDecision(workspaceId: string, jobId: string, rowId: string, decision: Decision): Promise<void> {
    await sql`
      UPDATE imports.staged_transaction SET decision = ${decision}
       WHERE workspace_id = ${workspaceId} AND import_job_id = ${jobId} AND id = ${rowId}`.execute(db());
  }

  async rowsToCreate(workspaceId: string, jobId: string) {
    const { rows } = await sql<{ id: string; booking_date: string; row_number: number }>`
      SELECT s.id, s.booking_date::text AS booking_date, s.row_number
        FROM imports.staged_transaction s
       WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId}
         AND s.decision = 'CREATE' AND s.classification IN ('NEW', 'DUPLICATE_PROBABLE')
       ORDER BY s.booking_date, s.row_number`.execute(db());
    return rows.map((r) => ({ rowId: r.id, bookingDate: r.booking_date, lineNumber: Number(r.row_number) }));
  }

  async assignBatches(
    workspaceId: string,
    jobId: string,
    plan: readonly { readonly batchNo: number; readonly rowIds: readonly string[] }[],
  ): Promise<void> {
    const flat = plan.flatMap((b) => b.rowIds.map((id) => ({ id, n: b.batchNo })));
    for (const part of chunks(flat)) {
      await sql`
        UPDATE imports.staged_transaction s SET batch_no = (v->>'n')::int
          FROM jsonb_array_elements(${json(part)}::jsonb) v
         WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId} AND s.id = (v->>'id')::uuid`.execute(
        db(),
      );
    }
  }

  async skippedProbableRows(workspaceId: string, jobId: string) {
    const { rows } = await sql<{ id: string; fingerprint: string; matched_transaction_id: string }>`
      SELECT s.id, encode(s.fingerprint, 'hex') AS fingerprint, s.matched_transaction_id
        FROM imports.staged_transaction s
       WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId}
         AND s.classification = 'DUPLICATE_PROBABLE' AND s.decision = 'SKIP'
         AND s.matched_transaction_id IS NOT NULL AND s.fingerprint IS NOT NULL
       ORDER BY s.row_number`.execute(db());
    return rows.map((r) => ({
      rowId: r.id,
      fingerprint: r.fingerprint,
      matchedTransactionId: r.matched_transaction_id,
    }));
  }

  async pendingBatchNumbers(workspaceId: string, jobId: string): Promise<number[]> {
    const { rows } = await sql<{ batch_no: number }>`
      SELECT DISTINCT s.batch_no FROM imports.staged_transaction s
       WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId}
         AND s.batch_no IS NOT NULL AND s.transaction_id IS NULL AND s.batch_error IS NULL
       ORDER BY s.batch_no`.execute(db());
    return rows.map((r) => Number(r.batch_no));
  }

  async loadBatch(workspaceId: string, jobId: string, batchNo: number): Promise<StagedRow[]> {
    const { rows } = await sql<StagedDbRow>`
      SELECT ${STAGED_COLUMNS}
        FROM imports.staged_transaction s LEFT JOIN fx.currency c ON c.code = s.currency
       WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId} AND s.batch_no = ${batchNo}
         AND s.transaction_id IS NULL AND s.batch_error IS NULL
       ORDER BY s.booking_date, s.row_number`.execute(db());
    return rows.map(toStaged);
  }

  async markPersisted(
    workspaceId: string,
    items: readonly { readonly rowId: string; readonly transactionId: string }[],
  ): Promise<void> {
    for (const part of chunks(items)) {
      await sql`
        UPDATE imports.staged_transaction s SET transaction_id = (v->>'t')::uuid
          FROM jsonb_array_elements(${json(part.map((i) => ({ id: i.rowId, t: i.transactionId })))}::jsonb) v
         WHERE s.workspace_id = ${workspaceId} AND s.id = (v->>'id')::uuid`.execute(db());
    }
  }

  async markBatchFailed(
    workspaceId: string,
    jobId: string,
    batchNo: number,
    error: { readonly code: string },
  ): Promise<void> {
    await sql`
      UPDATE imports.staged_transaction SET batch_error = ${json(error)}::jsonb
       WHERE workspace_id = ${workspaceId} AND import_job_id = ${jobId} AND batch_no = ${batchNo}
         AND transaction_id IS NULL`.execute(db());
  }

  async clearFailures(workspaceId: string, jobId: string): Promise<void> {
    await sql`
      UPDATE imports.staged_transaction SET batch_error = NULL
       WHERE workspace_id = ${workspaceId} AND import_job_id = ${jobId}
         AND batch_error IS NOT NULL AND transaction_id IS NULL`.execute(db());
  }

  async failures(workspaceId: string, jobId: string, limit: number) {
    const { rows } = await sql<{ code: string; n: string; lines: number[] }>`
      SELECT s.batch_error->>'code' AS code, count(*) AS n,
             (array_agg(s.row_number ORDER BY s.row_number))[1:${limit}::int] AS lines
        FROM imports.staged_transaction s
       WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId}
         AND s.batch_error IS NOT NULL AND s.transaction_id IS NULL
       GROUP BY 1 ORDER BY 1`.execute(db());
    return rows.map((r) => ({ code: r.code, count: Number(r.n), lines: r.lines.map(Number) }));
  }

  async dateRange(workspaceId: string, jobId: string) {
    const { rows } = await sql<{ d_from: string | null; d_to: string | null }>`
      SELECT min(s.booking_date)::text AS d_from, max(s.booking_date)::text AS d_to
        FROM imports.staged_transaction s
       WHERE s.workspace_id = ${workspaceId} AND s.import_job_id = ${jobId} AND s.transaction_id IS NOT NULL`.execute(
      db(),
    );
    const r = rows[0];
    return r?.d_from && r.d_to ? { from: r.d_from, to: r.d_to } : null;
  }

  async deleteAll(workspaceId: string, jobId: string): Promise<number> {
    const result = await sql`
      DELETE FROM imports.staged_transaction WHERE workspace_id = ${workspaceId} AND import_job_id = ${jobId}`.execute(
      db(),
    );
    return Number(result.numAffectedRows ?? 0);
  }
}

// ───────────────────────────────────────────────────────────── row_link

export class PgRowLinkRepository implements RowLinkRepository {
  async findActive(workspaceId: string, accountId: string, fingerprints: readonly string[]) {
    const out: { fingerprint: string; transactionId: string }[] = [];
    for (const part of chunks(fingerprints)) {
      const { rows } = await sql<{ fingerprint: string; transaction_id: string }>`
        SELECT encode(l.fingerprint, 'hex') AS fingerprint, l.transaction_id
          FROM imports.row_link l
         WHERE l.workspace_id = ${workspaceId} AND l.account_id = ${accountId} AND l.status = 'ACTIVE'
           AND l.fingerprint IN (SELECT decode(f, 'hex') FROM unnest(${part}::text[]) f)`.execute(db());
      out.push(...rows.map((r) => ({ fingerprint: r.fingerprint, transactionId: r.transaction_id })));
    }
    return out;
  }

  async insertMany(workspaceId: string, links: readonly RowLinkInsert[]): Promise<void> {
    for (const part of chunks(links)) {
      await sql`
        INSERT INTO imports.row_link (id, workspace_id, account_id, fingerprint, transaction_id, staged_transaction_id, kind)
        SELECT (e->>'id')::uuid, ${workspaceId}::uuid, (e->>'account')::uuid, decode(e->>'fp', 'hex'),
               (e->>'txn')::uuid, (e->>'staged')::uuid, e->>'kind'
          FROM jsonb_array_elements(${json(
            part.map((l) => ({
              id: l.id,
              account: l.accountId,
              fp: l.fingerprint,
              txn: l.transactionId,
              staged: l.stagedTransactionId,
              kind: l.kind,
            })),
          )}::jsonb) e
        ON CONFLICT DO NOTHING`.execute(db());
    }
  }

  async supersede(
    workspaceId: string,
    accountId: string,
    fingerprints: readonly string[],
    now: string,
  ): Promise<void> {
    for (const part of chunks(fingerprints)) {
      await sql`
        UPDATE imports.row_link SET status = 'SUPERSEDED', superseded_at = ${now}::timestamptz
         WHERE workspace_id = ${workspaceId} AND account_id = ${accountId} AND status = 'ACTIVE'
           AND fingerprint IN (SELECT decode(f, 'hex') FROM unnest(${part}::text[]) f)`.execute(db());
    }
  }

  async linkedTransactionIds(
    workspaceId: string,
    accountId: string,
    transactionIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const out = new Set<string>();
    for (const part of chunks(transactionIds)) {
      const { rows } = await sql<{ transaction_id: string }>`
        SELECT DISTINCT l.transaction_id FROM imports.row_link l
         WHERE l.workspace_id = ${workspaceId} AND l.account_id = ${accountId} AND l.status = 'ACTIVE'
           AND l.transaction_id = ANY(${part}::uuid[])`.execute(db());
      for (const r of rows) out.add(r.transaction_id);
    }
    return out;
  }
}
