import type { AuditEntry } from '@pf/audit/contracts';
import { DomainError, Instant, LocalDate } from '@pf/shared-kernel';
import {
  ImportJob,
  parseMapping,
  planBatches,
  sha256Hex,
  sniffCsv,
  type CsvMapping,
  type Decision,
  type ImportJobState,
  type ImportWarning,
} from '../domain/index.js';
import { IMPORTS_EVENTS } from '../contracts/index.js';
import type { ImportsDeps, StagedRow } from './ports/index.js';
import { buildPreviewSummary, toRowView } from './preview.js';
import { countersOf, runRowPipeline } from './row-pipeline.js';
import {
  toJobView,
  type CreatedImportView,
  type ImportJobView,
  type PreviewRowView,
  type PreviewSummaryView,
} from './views.js';

export const IMPORT_SAMPLE_ROWS = 20;

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `import ${id} not found`);
/** 412 con la versión vigente (`currentVersion`, docs/10 §6). */
const preconditionFailed = (currentVersion: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    details: { currentVersion },
  });

/** Nombre de archivo sin rutas ni caracteres de control, de 255 caracteres como máximo; no se loguea nunca. */
export function sanitizeFileName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const base = raw.split(/[\\/]/u).pop() ?? '';
  const cleaned = Array.from(base.normalize('NFC'))
    .filter((ch) => (ch.codePointAt(0) as number) >= 0x20 && (ch.codePointAt(0) as number) !== 0x7f)
    .join('')
    .trim();
  const limited = Array.from(cleaned).slice(0, 255).join('');
  return limited === '' ? null : limited;
}

export interface MappedImportView extends ImportJobView {
  readonly previewSummary: PreviewSummaryView;
}

export interface DecidedRowView {
  readonly row: PreviewRowView;
  /** Versión resultante del job (los conteos de la revisión cambian con cada decisión). */
  readonly version: number;
  readonly counters: ImportJobView['counters'];
}

/**
 * Casos de uso de IMPORTS que escriben (openspec add-basic-csv-import, decisiones 1–10 y 14–15): subir y leer el
 * archivo, aplicar el mapeo, decidir filas, aprobar, cancelar, reintentar y aceptar los errores. Cada comando corre en
 * UNA unidad de trabajo con su auditoría y, si corresponde, su evento de outbox (INV-029). Los roles
 * (`x-required-role: EDITOR`) los aplica el guard de identidad; la cuota `costly` y la idempotencia, las convenciones.
 */
export class ImportsService {
  constructor(private readonly deps: ImportsDeps) {}

  private audit(entry: AuditEntry): Promise<void> {
    return this.deps.audit.append(entry);
  }

  private async load(workspaceId: string, id: string, lock = true): Promise<ImportJob> {
    const job = await this.deps.jobs.findById(workspaceId, id, lock ? { lock: 'update' } : undefined);
    if (!job) throw notFound(id);
    return job;
  }

  private async save(job: ImportJob): Promise<void> {
    if (!(await this.deps.jobs.save(job))) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'the import was modified concurrently');
    }
    job.markPersisted();
  }

  private async publish(job: ImportJob, eventType: string, payload: Record<string, unknown>): Promise<void> {
    const s = job.state;
    await this.deps.outbox.append({
      eventId: this.deps.ids.next(),
      eventType,
      eventVersion: 1,
      occurredAt: this.deps.clock.now().toString(),
      workspaceId: s.workspaceId,
      aggregateType: 'ImportJob',
      aggregateId: s.id,
      aggregateVersion: s.version,
      payload: { workspaceId: s.workspaceId, importJobId: s.id, accountId: s.accountId, ...payload },
    });
  }

  // ───────────────────────────────────────────────────────────── subir

  /**
   * `CreateCsvImport`: lee el archivo (codificación, delimitador, columnas, límites), guarda sus celdas en el staging y
   * devuelve la importación esperando mapeo con el encabezado y hasta 20 filas de muestra. No crea transacciones; el
   * binario no se guarda. Cuenta cerrada o archivada ⇒ `ACCOUNT_CLOSED` / `ACCOUNT_ARCHIVED` y no se crea nada.
   */
  async createImport(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly accountId: string;
    readonly fileName?: string | null;
    readonly bytes: Uint8Array;
  }): Promise<CreatedImportView> {
    const { deps } = this;
    const { settings } = deps;
    if (cmd.bytes.length > settings.maxBytes) {
      throw new DomainError('UPLOAD_TOO_LARGE', `the file exceeds ${settings.maxBytes} bytes`);
    }
    // Lectura pura (sin base de datos): un archivo ilegible se rechaza antes de abrir la unidad de trabajo.
    const sniffed = sniffCsv(cmd.bytes, { maxRows: settings.maxRows, maxColumns: settings.maxColumns });
    const checksum = sha256Hex(cmd.bytes);
    const header = sniffed.records[0]?.cells ?? [];
    const sampleRows = sniffed.records.slice(1, 1 + IMPORT_SAMPLE_ROWS).map((r) => r.cells);

    return deps.uow.run(cmd.workspaceId, async () => {
      await deps.accounts.assertActive(cmd.workspaceId, cmd.accountId);
      const now = deps.clock.now();
      const timeZone = await deps.calendar.timeZoneOf(cmd.workspaceId);

      const warnings: ImportWarning[] = [];
      const previous = await deps.jobs.findPreviousImported(cmd.workspaceId, cmd.accountId, checksum);
      if (previous) {
        warnings.push({
          code: 'IMPORT_FILE_ALREADY_IMPORTED',
          previousImportId: previous.id,
          previousImportedAt: LocalDate.ofInstant(Instant.parse(previous.completedAt), timeZone).toString(),
        });
      }

      const job = ImportJob.create({
        id: deps.ids.next(),
        workspaceId: cmd.workspaceId,
        accountId: cmd.accountId,
        createdBy: cmd.userId,
        now: now.toString(),
        originalName: sanitizeFileName(cmd.fileName),
        fileChecksum: checksum,
        fileSizeBytes: cmd.bytes.length,
        encoding: sniffed.encoding,
        delimiter: sniffed.delimiter,
        rowCount: Math.max(0, sniffed.records.length - 1),
        columnCount: sniffed.columnCount,
        header,
        warnings,
        expiresAt: now.plusMillis(settings.reviewTtlMs).toString(),
      });
      await deps.jobs.insert(job);
      job.markPersisted();
      await deps.staging.insertRaw(
        cmd.workspaceId,
        job.id,
        sniffed.records.map((r) => ({ id: deps.ids.next(), rowNumber: r.line, raw: r.cells })),
      );
      const s = job.state;
      await this.audit({
        workspaceId: s.workspaceId,
        action: 'imports.import.created',
        aggregateType: 'ImportJob',
        aggregateId: s.id,
        aggregateVersion: s.version,
        changes: [
          { field: 'accountId', before: null, after: s.accountId },
          { field: 'status', before: null, after: s.status },
          { field: 'rowCount', before: null, after: s.rowCount },
          { field: 'fileSha256', before: null, after: s.fileChecksum },
        ],
      });

      let suggested: CsvMapping | null = null;
      const last = await deps.jobs.lastMapping(cmd.workspaceId, cmd.accountId);
      if (last) {
        try {
          suggested = parseMapping(last, s.columnCount);
        } catch {
          suggested = null;
        }
      }
      return { ...toJobView(s), sampleRows, suggestedMapping: suggested };
    });
  }

  // ───────────────────────────────────────────────────────────── mapear

  /**
   * `SetImportMapping`: valida el mapeo, normaliza y valida cada fila, calcula huellas, clasifica contra los imports
   * previos y los movimientos existentes y deja la importación en revisión. Se puede volver a enviar mientras no esté
   * aprobada: recalcula todo y conserva las decisiones de las filas cuya huella no cambió. No crea transacciones.
   */
  setMapping(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly importId: string;
    readonly expectedVersion: number;
    readonly mapping: unknown;
  }): Promise<MappedImportView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const job = await this.load(cmd.workspaceId, cmd.importId);
      this.assertVersion(job, cmd.expectedVersion);
      const status = job.state.status;
      if (status !== 'AWAITING_MAPPING' && status !== 'AWAITING_REVIEW') {
        throw new DomainError('INVALID_STATUS_TRANSITION', `an import in ${status} cannot be mapped`);
      }
      const mapping = parseMapping(cmd.mapping, job.state.columnCount);
      const account = await deps.accounts.getAccount(cmd.workspaceId, job.state.accountId);
      if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');

      const staged = await deps.staging.loadForMapping(cmd.workspaceId, job.id);
      const result = await runRowPipeline(deps, {
        workspaceId: cmd.workspaceId,
        accountId: account.accountId,
        currencyCode: account.currency,
        mapping,
        staged,
      });
      if (result.supersededFingerprints.length > 0) {
        await deps.links.supersede(
          cmd.workspaceId,
          account.accountId,
          result.supersededFingerprints,
          deps.clock.now().toString(),
        );
      }
      await deps.staging.applyNormalization(cmd.workspaceId, job.id, result.items, result.resetIds);
      const summary = await deps.staging.summary(cmd.workspaceId, job.id);
      job.applyMapping({
        mapping,
        counters: countersOf(summary),
        now: deps.clock.now().toString(),
      });
      await this.save(job);
      const previewSummary = await buildPreviewSummary(deps, {
        workspaceId: cmd.workspaceId,
        job: job.state,
        account,
        summary,
      });
      return { ...toJobView(job.state), previewSummary };
    });
  }

  private assertVersion(job: ImportJob, expected: number): void {
    if (job.state.version !== expected) throw preconditionFailed(job.state.version);
  }

  // ───────────────────────────────────────────────────────────── decidir una fila

  /**
   * `DecideImportRow`: `CREATE | SKIP | EXCLUDE` de una fila en revisión. Una fila inválida o ya importada tiene
   * decisión fija (`INVALID_STATUS_TRANSITION`); `SKIP` solo aplica a un posible duplicado (vincula con el movimiento
   * existente al aprobar) y una fila nueva solo se crea o se excluye.
   */
  decideRow(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly importId: string;
    readonly rowId: string;
    readonly expectedVersion: number;
    readonly decision: Decision;
  }): Promise<DecidedRowView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const job = await this.load(cmd.workspaceId, cmd.importId);
      this.assertVersion(job, cmd.expectedVersion);
      job.assertAwaitingReview();
      const row = await deps.staging.find(cmd.workspaceId, job.id, cmd.rowId);
      if (!row) throw notFound(cmd.rowId);
      this.assertDecisionAllowed(row, cmd.decision);
      await deps.staging.setDecision(cmd.workspaceId, job.id, row.id, cmd.decision);
      const summary = await deps.staging.summary(cmd.workspaceId, job.id);
      job.updateReviewCounters(countersOf(summary), deps.clock.now().toString());
      await this.save(job);
      const updated = (await deps.staging.find(cmd.workspaceId, job.id, row.id)) as StagedRow;
      const account = await deps.accounts.getAccount(cmd.workspaceId, job.state.accountId);
      return {
        row: toRowView(updated, null, account?.currency ?? ''),
        version: job.state.version,
        counters: job.state.counters,
      };
    });
  }

  private assertDecisionAllowed(row: StagedRow, decision: Decision): void {
    if (row.classification === null) {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'the row is not part of the data of the import');
    }
    if (row.classification === 'INVALID' || row.classification === 'DUPLICATE_EXACT') {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        'the decision of an invalid or already imported row is fixed',
      );
    }
    if (decision === 'SKIP' && row.classification !== 'DUPLICATE_PROBABLE') {
      throw new DomainError('VALIDATION_FAILED', 'only a possible duplicate can be skipped').at('/decision');
    }
  }

  // ───────────────────────────────────────────────────────────── aprobar

  /**
   * `ApproveImport`: exige que no queden posibles duplicados sin decisión (`IMPORT_REVIEW_INCOMPLETE` con
   * `pendingDecisions`), reparte las filas a crear en lotes, vincula las omitidas con su movimiento existente, pasa a
   * `APPROVED` y publica `imports.ImportApproved.v1` en la misma transacción. La persistencia es asíncrona (worker).
   */
  approve(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly importId: string;
    readonly expectedVersion: number;
  }): Promise<ImportJobView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const job = await this.load(cmd.workspaceId, cmd.importId);
      this.assertVersion(job, cmd.expectedVersion);
      job.assertAwaitingReview();
      const account = await deps.accounts.assertActive(cmd.workspaceId, job.state.accountId);
      const summary = await deps.staging.summary(cmd.workspaceId, job.id);
      if (summary.pendingDecisions > 0) {
        throw new DomainError(
          'IMPORT_REVIEW_INCOMPLETE',
          `${summary.pendingDecisions} possible duplicates are waiting for a decision`,
          { details: { pendingDecisions: summary.pendingDecisions } },
        );
      }
      const toCreate = await deps.staging.rowsToCreate(cmd.workspaceId, job.id);
      const plan = planBatches(
        toCreate.map((r) => ({ rowId: r.rowId, bookingDate: r.bookingDate, lineNumber: r.lineNumber })),
        deps.settings.batchSize,
      );
      await deps.staging.assignBatches(cmd.workspaceId, job.id, plan);

      // Omitir un posible duplicado lo vincula con el movimiento existente: una importación posterior lo reconoce.
      const skipped = await deps.staging.skippedProbableRows(cmd.workspaceId, job.id);
      await deps.links.insertMany(
        cmd.workspaceId,
        skipped.map((r) => ({
          id: deps.ids.next(),
          accountId: account.accountId,
          fingerprint: r.fingerprint,
          transactionId: r.matchedTransactionId,
          stagedTransactionId: r.rowId,
          kind: 'SKIPPED_AS_DUPLICATE' as const,
        })),
      );

      const now = deps.clock.now().toString();
      job.approve({ userId: cmd.userId, now, batchCount: plan.length });
      await this.save(job);
      await this.publish(job, IMPORTS_EVENTS.approved.eventType, { attempt: job.state.progress.attempt });
      await this.audit({
        workspaceId: cmd.workspaceId,
        action: 'imports.import.approved',
        aggregateType: 'ImportJob',
        aggregateId: job.id,
        aggregateVersion: job.state.version,
        changes: [
          { field: 'status', before: 'AWAITING_REVIEW', after: 'APPROVED' },
          { field: 'counters', before: null, after: JSON.stringify(job.state.counters) },
        ],
      });
      return toJobView(job.state);
    });
  }

  // ───────────────────────────────────────────────────────────── cancelar

  /** `CancelImport`: solo antes de aprobar; descarta las celdas crudas y audita. */
  cancel(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly importId: string;
  }): Promise<ImportJobView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const job = await this.load(cmd.workspaceId, cmd.importId);
      const before = job.state.status;
      job.cancel({ actor: { type: 'USER', userId: cmd.userId }, now: deps.clock.now().toString() });
      await this.save(job);
      await deps.staging.deleteAll(cmd.workspaceId, job.id);
      await this.audit({
        workspaceId: cmd.workspaceId,
        action: 'imports.import.cancelled',
        aggregateType: 'ImportJob',
        aggregateId: job.id,
        aggregateVersion: job.state.version,
        changes: [{ field: 'status', before, after: 'CANCELLED' }],
      });
      return toJobView(job.state);
    });
  }

  // ───────────────────────────────────────────────────────────── reintentar / aceptar

  /** `RetryImport`: reintenta las filas fallidas de una importación parcialmente fallida (idempotente por fila). */
  retry(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly importId: string;
  }): Promise<ImportJobView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const job = await this.load(cmd.workspaceId, cmd.importId);
      if (job.state.status !== 'PARTIALLY_FAILED') {
        throw new DomainError(
          'INVALID_STATUS_TRANSITION',
          `an import in ${job.state.status} cannot be retried`,
        );
      }
      await deps.accounts.assertActive(cmd.workspaceId, job.state.accountId);
      await deps.staging.clearFailures(cmd.workspaceId, job.id);
      job.retry(deps.clock.now().toString());
      await this.save(job);
      await this.publish(job, IMPORTS_EVENTS.approved.eventType, { attempt: job.state.progress.attempt });
      await this.audit({
        workspaceId: cmd.workspaceId,
        action: 'imports.import.retried',
        aggregateType: 'ImportJob',
        aggregateId: job.id,
        aggregateVersion: job.state.version,
        changes: [
          { field: 'status', before: 'PARTIALLY_FAILED', after: 'PERSISTING' },
          { field: 'attempt', before: job.state.progress.attempt - 1, after: job.state.progress.attempt },
        ],
      });
      return toJobView(job.state);
    });
  }

  /** `AcceptImportErrors`: acepta el resultado parcial (`COMPLETED_WITH_ERRORS`) y publica `ImportCompleted`. */
  acceptErrors(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly importId: string;
  }): Promise<ImportJobView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const job = await this.load(cmd.workspaceId, cmd.importId);
      job.acceptErrors(deps.clock.now().toString());
      await this.save(job);
      await publishCompleted(deps, job.state, await deps.staging.dateRange(cmd.workspaceId, job.id));
      await this.audit({
        workspaceId: cmd.workspaceId,
        action: 'imports.import.errors_accepted',
        aggregateType: 'ImportJob',
        aggregateId: job.id,
        aggregateVersion: job.state.version,
        changes: [
          { field: 'status', before: 'PARTIALLY_FAILED', after: 'COMPLETED_WITH_ERRORS' },
          { field: 'counters', before: null, after: JSON.stringify(job.state.counters) },
        ],
      });
      return toJobView(job.state);
    });
  }
}

/** `imports.ImportCompleted.v1` (docs/11): estadísticas del job y rango de fechas de sus filas. */
export async function publishCompleted(
  deps: ImportsDeps,
  s: ImportJobState,
  dateRange: { readonly from: string; readonly to: string } | null,
): Promise<void> {
  const c = s.counters;
  await deps.outbox.append({
    eventId: deps.ids.next(),
    eventType: IMPORTS_EVENTS.completed.eventType,
    eventVersion: 1,
    occurredAt: deps.clock.now().toString(),
    workspaceId: s.workspaceId,
    aggregateType: 'ImportJob',
    aggregateId: s.id,
    aggregateVersion: s.version,
    payload: {
      workspaceId: s.workspaceId,
      importJobId: s.id,
      accountId: s.accountId,
      sourceType: 'FILE_CSV',
      status: s.status,
      stats: {
        total: c.rows,
        imported: c.created,
        duplicates: c.alreadyImported + c.skipped,
        ignored: c.excluded,
        errors: c.invalid + c.failed,
      },
      dateRange,
    },
  });
}
