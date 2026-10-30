import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, Instant, LocalDate, Money, currency as makeCurrency } from '@pf/shared-kernel';
import {
  ImportJob,
  applyEditPatch,
  assertValidConversion,
  assertValidTransfer,
  isEmptyPatch,
  parseMapping,
  parseProfileOptions,
  planBatches,
  profileMappingFromCsv,
  resolveMapping,
  sha256Hex,
  sniffCsv,
  TABULAR_FORMATS,
  type CsvMapping,
  type Decision,
  type ImportJobState,
  type ImportStatementInfo,
  type ImportWarning,
  type RowEdits,
  type RowKind,
  type StatementFormat,
} from '../domain/index.js';
import { IMPORTS_EVENTS } from '../contracts/index.js';
import { publishJobEvent, recordJob } from './job-recorder.js';
import { buildProposals, rulesSubjectKind } from './classification-stage.js';
import { ratio } from './process-import.service.js';
import type { BulkEditSet, ImportsDeps, PreviewFilter, StagedRow } from './ports/index.js';
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

/** Formatos que el pipeline sabe leer (el PDF es de un change propio, pregunta 1). */
const IMPORTABLE: readonly StatementFormat[] = ['CSV', 'OFX', 'QIF', 'JSON', 'XLSX'];

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

const zero = (currency: string) => ({ amount: '0', currency });

function emptyPreviewSummary(currency: string): PreviewSummaryView {
  return {
    counts: {
      rows: 0,
      new: 0,
      alreadyImported: 0,
      probableDuplicates: 0,
      invalid: 0,
      pendingDecisions: 0,
      toCreate: 0,
      skipped: 0,
      excluded: 0,
    },
    outflows: zero(currency),
    inflows: zero(currency),
    currentBalance: zero(currency),
    resultingBalance: zero(currency),
  };
}

/** Parche de edición de una fila (`PATCH .../rows/{rowId}`, decisión 11): todo opcional. */
export interface RowPatch extends RowEdits {
  readonly decision?: Decision | undefined;
  /** Candidato elegido al omitir vinculando (por omisión, el asignado). */
  readonly candidateTransactionId?: string | undefined;
}

/**
 * Casos de uso de IMPORTS que escriben (openspec add-basic-csv-import decisiones 1–10 y 14–15 y add-import-pipeline):
 * subir y leer el archivo o crear la importación desde un documento, aplicar el mapeo, editar y decidir filas (una a
 * una y en lote), reevaluar reglas, confirmar coincidencias con compromisos, fijar el saldo del extracto, aprobar,
 * cancelar, reintentar y aceptar los errores. Cada comando corre en UNA unidad de trabajo con su auditoría y recorrido
 * y, si corresponde, su evento de outbox (INV-029). Los roles los aplica el guard de identidad; la cuota `costly` y la
 * idempotencia, las convenciones.
 */
export class ImportsService {
  constructor(private readonly deps: ImportsDeps) {}

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

  private async publish(job: ImportJob, kind: { eventType: string; eventVersion: number }, payload: object) {
    return publishJobEvent(this.deps, job, kind, payload as Record<string, unknown>);
  }

  private assertVersion(job: ImportJob, expected: number): void {
    if (job.state.version !== expected) throw preconditionFailed(job.state.version);
  }

  // ───────────────────────────────────────────────────────────── subir (CSV por multipart, ruta conservada)

  /**
   * `CreateCsvImport`: lee el archivo (codificación, delimitador, columnas, límites), guarda sus celdas en el staging y
   * devuelve la importación esperando mapeo con el encabezado y hasta 20 filas de muestra. No crea transacciones; el
   * binario no se guarda. Cuenta cerrada o archivada ⇒ `ACCOUNT_CLOSED` / `ACCOUNT_ARCHIVED` y no se crea nada.
   * La ruta se conserva (D322) y se marca obsoleta cuando la UI use solo documentos.
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

      const warnings = await this.previousImportWarning(cmd.workspaceId, cmd.accountId, checksum, timeZone);

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
      await recordJob(deps, job, 'created', {
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

  private async previousImportWarning(
    workspaceId: string,
    accountId: string,
    checksum: string,
    timeZone: string,
  ): Promise<ImportWarning[]> {
    const previous = await this.deps.jobs.findPreviousImported(workspaceId, accountId, checksum);
    if (!previous) return [];
    return [
      {
        code: 'IMPORT_FILE_ALREADY_IMPORTED',
        previousImportId: previous.id,
        previousImportedAt: LocalDate.ofInstant(Instant.parse(previous.completedAt), timeZone).toString(),
      },
    ];
  }

  // ───────────────────────────────────────────────────────────── crear desde un documento

  /**
   * `CreateImportFromDocument` (decisión 2): el documento debe estar disponible (`DOCUMENT_NOT_AVAILABLE`), tener el
   * propósito «extracto para importar» (`VALIDATION_FAILED`) y un formato importable (`IMPORT_UNSUPPORTED_FORMAT`; un
   * PDF se rechaza aquí); uno de otro workspace o inexistente es `REFERENCE_NOT_FOUND`. En la MISMA unidad de trabajo
   * crea el job `UPLOADED`, lo vincula al documento, audita y publica `imports.ImportFileUploaded.v1`. No lee el
   * contenido ni crea ninguna transacción.
   */
  createFromDocument(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly accountId: string;
    readonly documentId: string;
    readonly mappingProfileId?: string | undefined;
  }): Promise<ImportJobView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const account = await deps.accounts.assertActive(cmd.workspaceId, cmd.accountId);
      const document = await deps.documents.getForProcessing(cmd.workspaceId, cmd.documentId);
      if (!document) throw new DomainError('REFERENCE_NOT_FOUND', 'document not found').at('/documentId');
      if (document.status !== 'AVAILABLE') {
        throw new DomainError('DOCUMENT_NOT_AVAILABLE', 'the document is not available').at('/documentId');
      }
      if (document.purpose !== 'IMPORT_SOURCE') {
        throw new DomainError('VALIDATION_FAILED', 'the document is not a statement to import').at(
          '/documentId',
        );
      }
      const format = document.detectedFormat as StatementFormat | null;
      if (format === null || !(IMPORTABLE.includes(format) || (format === 'PDF' && deps.pdf !== undefined))) {
        throw new DomainError('IMPORT_UNSUPPORTED_FORMAT', 'the document format cannot be imported').at(
          '/documentId',
        );
      }

      let profile: { id: string; version: number } | null = null;
      if (cmd.mappingProfileId) {
        const versions = await deps.profiles.versionsOf(cmd.workspaceId, cmd.mappingProfileId);
        const latest = versions.at(-1);
        if (!latest) {
          throw new DomainError('REFERENCE_NOT_FOUND', 'profile not found').at('/mappingProfileId');
        }
        if (latest.archivedAt !== null || latest.format !== format) {
          throw new DomainError('VALIDATION_FAILED', 'the profile does not apply to this document').at(
            '/mappingProfileId',
          );
        }
        profile = { id: latest.id, version: latest.version };
      }

      const now = deps.clock.now();
      const timeZone = await deps.calendar.timeZoneOf(cmd.workspaceId);
      const warnings = await this.previousImportWarning(
        cmd.workspaceId,
        cmd.accountId,
        document.sha256,
        timeZone,
      );
      const job = ImportJob.createFromDocument({
        id: deps.ids.next(),
        workspaceId: cmd.workspaceId,
        accountId: cmd.accountId,
        createdBy: cmd.userId,
        now: now.toString(),
        documentId: cmd.documentId,
        format,
        originalName: sanitizeFileName(document.originalName),
        fileChecksum: document.sha256,
        fileSizeBytes: document.sizeBytes,
        warnings,
        mappingProfile: profile,
      });
      await deps.jobs.insert(job);
      job.markPersisted();
      await deps.documents.linkToImport({
        workspaceId: cmd.workspaceId,
        documentId: cmd.documentId,
        importJobId: job.id,
        actorUserId: cmd.userId,
      });
      const event = await this.publish(job, IMPORTS_EVENTS.fileUploaded, {
        documentId: cmd.documentId,
        format,
      });
      const s = job.state;
      await recordJob(deps, job, 'created', {
        events: [event],
        changes: [
          { field: 'accountId', before: null, after: s.accountId },
          { field: 'status', before: null, after: s.status },
          { field: 'documentId', before: null, after: s.documentId },
          { field: 'format', before: null, after: s.format },
          { field: 'fileSha256', before: null, after: s.fileChecksum },
        ],
      });
      return toJobView(s, account.currency);
    });
  }

  // ───────────────────────────────────────────────────────────── mapear

  /**
   * `SetImportMapping`: valida el mapeo, normaliza y valida cada fila, calcula huellas, clasifica contra los imports
   * previos y los movimientos existentes y deja la importación en revisión. Se puede volver a enviar mientras no esté
   * aprobada: recalcula todo y conserva las decisiones de las filas cuya huella no cambió. No crea transacciones.
   * Para un job de documento aplica el perfil o el mapeo y devuelve el job `PROCESSING`: el worker reanuda las etapas.
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
      const account = await deps.accounts.getAccount(cmd.workspaceId, job.state.accountId);
      if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
      if (job.isDocumentJob) {
        const view = await this.mapDocumentJob(cmd, job, account.currency);
        // El job queda en PROCESSING: la vista previa se arma en el worker (el controlador responde 202 con el job).
        return { ...view, previewSummary: emptyPreviewSummary(account.currency) };
      }

      const mapping = parseMapping(cmd.mapping, job.state.columnCount);
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
      await recordJob(deps, job, 'mapped', {
        changes: [
          { field: 'status', before: status, after: job.state.status },
          { field: 'counters', before: null, after: JSON.stringify(job.state.counters) },
        ],
      });
      const previewSummary = await buildPreviewSummary(deps, {
        workspaceId: cmd.workspaceId,
        job: job.state,
        account,
        summary,
      });
      return { ...toJobView(job.state, account.currency), previewSummary };
    });
  }

  /** Mapeo de un job de documento: perfil guardado, opciones `imports.profile.v1` o mapeo CSV básico. */
  private async mapDocumentJob(
    cmd: { workspaceId: string; userId: string; mapping: unknown },
    job: ImportJob,
    currency: string,
  ): Promise<ImportJobView> {
    const { deps } = this;
    const state = job.state;
    const format = state.format as StatementFormat;
    const tabular = TABULAR_FORMATS.includes(format);
    const body = (typeof cmd.mapping === 'object' && cmd.mapping !== null ? cmd.mapping : {}) as Record<
      string,
      unknown
    >;
    let profileMapping = null as ImportJobState['profileMapping'];
    let profile: { id: string; version: number } | null = null;
    let readOptions: ImportJobState['readOptions'] = null;

    if (typeof body['mappingProfileId'] === 'string') {
      const versions = await deps.profiles.versionsOf(cmd.workspaceId, body['mappingProfileId']);
      const wanted = typeof body['version'] === 'number' ? body['version'] : (versions.at(-1)?.version ?? 0);
      const chosen = versions.find((v) => v.version === wanted);
      if (!chosen) throw new DomainError('REFERENCE_NOT_FOUND', 'profile not found').at('/mappingProfileId');
      if (chosen.archivedAt !== null || chosen.format !== format) {
        throw new DomainError('IMPORT_MAPPING_INVALID', 'the profile does not apply to this import').at(
          '/mappingProfileId',
        );
      }
      profile = { id: chosen.id, version: chosen.version };
      if (tabular) {
        if (chosen.options.mapping === null) {
          throw new DomainError('IMPORT_MAPPING_INVALID', 'the profile has no column mapping').at('/options');
        }
        const resolved = resolveMapping(chosen.options.mapping, state.header);
        if (!resolved.ok) {
          throw new DomainError(
            'IMPORT_MAPPING_INVALID',
            'the header does not have the columns of the profile',
            {
              details: { missingColumns: resolved.missing },
            },
          ).at('/mappingProfileId');
        }
        profileMapping = resolved.mapping;
      } else {
        readOptions = { dateOrder: chosen.options.dateOrder };
      }
    } else if (body['version'] === 'imports.profile.v1') {
      const options = parseProfileOptions(format, body, tabular ? state.columnCount : null);
      if (tabular) {
        if (options.mapping === null) throw new DomainError('IMPORT_MAPPING_INVALID', 'mapping is required');
        profileMapping = options.mapping;
      } else {
        readOptions = { dateOrder: options.dateOrder };
      }
    } else if (tabular) {
      profileMapping = profileMappingFromCsv(parseMapping(cmd.mapping, state.columnCount));
    } else {
      throw new DomainError('IMPORT_MAPPING_INVALID', 'the mapping does not apply to this format').at('');
    }

    const before = state.status;
    job.applyMapping({
      mapping: null,
      counters: state.counters,
      now: deps.clock.now().toString(),
      profile,
      profileMapping,
      readOptions,
      restartStage: tabular ? 'NORMALIZE' : 'PARSE',
    });
    await this.save(job);
    // El worker reanuda desde `progress.stage`: un nuevo hecho dispara el consumidor existente (sin consumidores nuevos).
    const event = await this.publish(job, IMPORTS_EVENTS.fileUploaded, {
      documentId: state.documentId,
      format: state.format,
    });
    await recordJob(deps, job, 'mapped', {
      events: [event],
      changes: [
        { field: 'status', before, after: job.state.status },
        ...(profile
          ? [{ field: 'mappingProfile', before: null, after: `${profile.id}@${profile.version}` }]
          : []),
      ],
      ...(profile ? { detailRefs: { profileId: profile.id, profileVersion: profile.version } } : {}),
    });
    return toJobView(job.state, currency);
  }

  // ───────────────────────────────────────────────────────────── editar y decidir una fila

  /**
   * `EditImportRow` (`PATCH .../rows/{rowId}`, decisión 11): decisión, tipo, categoría, contraparte, etiquetas,
   * descripción, nota, transferencia o conversión y vínculo con una ocurrencia, de una fila en revisión. Cada campo
   * editado queda con origen manual sobre la propuesta del pipeline. Una fila inválida o ya importada tiene decisión
   * fija (`INVALID_STATUS_TRANSITION`); `SKIP` solo aplica a un posible duplicado (vincula con el movimiento existente
   * al aprobar). Valida las referencias y NO crea ni modifica ninguna transacción.
   */
  decideRow(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly importId: string;
    readonly rowId: string;
    readonly expectedVersion: number;
    readonly decision?: Decision | undefined;
    readonly patch?: RowPatch | undefined;
  }): Promise<DecidedRowView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const job = await this.load(cmd.workspaceId, cmd.importId);
      this.assertVersion(job, cmd.expectedVersion);
      job.assertAwaitingReview();
      const row = await deps.staging.find(cmd.workspaceId, job.id, cmd.rowId);
      if (!row) throw notFound(cmd.rowId);

      const { decision: patchDecision, candidateTransactionId, ...editPatch } = cmd.patch ?? {};
      const decision = cmd.decision ?? patchDecision;
      if (decision === undefined && isEmptyPatch(editPatch) && candidateTransactionId === undefined) {
        throw new DomainError('VALIDATION_FAILED', 'the body has nothing to change');
      }
      this.assertEditable(row, decision);

      const account = await deps.accounts.getAccount(cmd.workspaceId, job.state.accountId);
      if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
      await this.validatePatch(cmd.workspaceId, row, editPatch, account.currency, account.accountId);

      const edits = applyEditPatch(row.edits, editPatch);
      const kind: RowKind | null = edits.kind ?? null;
      let matched: string | undefined;
      let decidedScore: string | null = null;
      if (decision === 'SKIP') {
        const chosen =
          candidateTransactionId === undefined
            ? undefined
            : row.candidates.find((c) => c.transactionId === candidateTransactionId);
        if (candidateTransactionId !== undefined && !chosen) {
          throw new DomainError('VALIDATION_FAILED', 'the candidate does not belong to the row').at(
            '/candidateTransactionId',
          );
        }
        matched = chosen?.transactionId;
        decidedScore =
          (chosen ?? row.candidates.find((c) => c.transactionId === row.matchedTransactionId))?.score ?? null;
      }
      const occurrenceLink =
        editPatch.occurrenceLink === undefined
          ? row.occurrenceLink
          : editPatch.occurrenceLink === null
            ? null
            : { occurrenceId: editPatch.occurrenceLink.occurrenceId };

      await deps.staging.applyEdit(cmd.workspaceId, job.id, row.id, {
        edits,
        kind,
        decision,
        decidedBy: cmd.userId,
        decidedAt: deps.clock.now().toString(),
        occurrenceLink,
        matchedTransactionId: matched,
        decidedScore,
      });
      const summary = await deps.staging.summary(cmd.workspaceId, job.id);
      job.updateReviewCounters(countersOf(summary), deps.clock.now().toString());
      await this.save(job);
      const updated = (await deps.staging.find(cmd.workspaceId, job.id, row.id)) as StagedRow;
      return {
        row: toRowView(updated, null, account.currency),
        version: job.state.version,
        counters: job.state.counters,
      };
    });
  }

  private assertEditable(row: StagedRow, decision: Decision | undefined): void {
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

  /** Referencias del parche: categoría activa del tipo, contraparte, etiquetas, cuentas y ocurrencia candidata. */
  private async validatePatch(
    workspaceId: string,
    row: StagedRow,
    patch: RowEdits,
    currency: string,
    accountId: string,
  ): Promise<void> {
    const { deps } = this;
    const kind: RowKind = patch.kind ?? row.edits.kind ?? (row.direction === 'IN' ? 'INCOME' : 'EXPENSE');
    if (patch.categoryId) {
      await deps.refs.assertCategory(
        workspaceId,
        patch.categoryId,
        kind === 'EXPENSE' || kind === 'INCOME' ? kind : null,
        '/categoryId',
      );
    }
    if (patch.counterpartyId)
      await deps.refs.assertCounterparty(workspaceId, patch.counterpartyId, '/counterpartyId');
    if (patch.tagIds && patch.tagIds.length > 0)
      await deps.refs.assertTags(workspaceId, patch.tagIds, '/tagIds');
    if (
      patch.description !== undefined &&
      patch.description !== null &&
      Array.from(patch.description).length > 500
    ) {
      throw new DomainError('VALIDATION_FAILED', 'the description has at most 500 characters').at(
        '/description',
      );
    }

    if (patch.transfer) {
      const counter = await deps.accounts.getAccount(workspaceId, patch.transfer.counterAccountId);
      if (!counter)
        throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/transfer/counterAccountId');
      const scale = (await deps.currencies.scaleOf(counter.currency)) ?? 2;
      assertValidTransfer({
        accountId,
        accountCurrency: currency,
        counter: { accountId: counter.accountId, currency: counter.currency, scale, status: counter.status },
      });
    }
    if (patch.conversion) {
      const counter = await deps.accounts.getAccount(workspaceId, patch.conversion.counterAccountId);
      if (!counter) {
        throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/conversion/counterAccountId');
      }
      const scale = (await deps.currencies.scaleOf(counter.currency)) ?? 2;
      const ownScale = (await deps.currencies.scaleOf(currency)) ?? 2;
      assertValidConversion({
        accountId,
        accountCurrency: currency,
        accountScale: ownScale,
        amount: row.amount ?? '0',
        counter: { accountId: counter.accountId, currency: counter.currency, scale, status: counter.status },
        counterAmount: patch.conversion.counterAmount,
      });
      const fee = patch.conversion.fee;
      if (fee) {
        try {
          Money.parse(fee.amount, makeCurrency(fee.currency, fee.currency === currency ? ownScale : scale));
        } catch (error) {
          throw error instanceof DomainError ? error.at('/conversion/fee/amount') : error;
        }
      }
    }
    if (patch.occurrenceLink) {
      const wanted = patch.occurrenceLink.occurrenceId;
      if (!row.occurrenceCandidates.some((c) => c.occurrenceId === wanted)) {
        throw new DomainError('VALIDATION_FAILED', 'the occurrence is not a candidate of the row').at(
          '/occurrenceLink/occurrenceId',
        );
      }
    }
  }

  // ───────────────────────────────────────────────────────────── edición en lote

  /** `BulkEditImportRows`: el mismo cambio para las filas de un filtro, en una sentencia (≤ 5 000 filas). */
  bulkEdit(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly importId: string;
    readonly expectedVersion: number;
    readonly filter: PreviewFilter;
    readonly set: BulkEditSet;
  }): Promise<{ readonly updated: number; readonly version: number }> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const job = await this.load(cmd.workspaceId, cmd.importId);
      this.assertVersion(job, cmd.expectedVersion);
      job.assertAwaitingReview();
      const { set } = cmd;
      if (
        set.categoryId === undefined &&
        set.tagIds === undefined &&
        set.counterpartyId === undefined &&
        set.decision === undefined
      ) {
        throw new DomainError('VALIDATION_FAILED', 'the set has nothing to change').at('/set');
      }
      if (set.decision === 'SKIP') {
        throw new DomainError('VALIDATION_FAILED', 'a bulk edit cannot skip rows').at('/set/decision');
      }
      if (set.categoryId)
        await deps.refs.assertCategory(cmd.workspaceId, set.categoryId, null, '/set/categoryId');
      if (set.counterpartyId) {
        await deps.refs.assertCounterparty(cmd.workspaceId, set.counterpartyId, '/set/counterpartyId');
      }
      if (set.tagIds && set.tagIds.length > 0)
        await deps.refs.assertTags(cmd.workspaceId, set.tagIds, '/set/tagIds');
      const updated = await deps.staging.bulkEdit(cmd.workspaceId, job.id, cmd.filter, set, {
        userId: cmd.userId,
        at: deps.clock.now().toString(),
      });
      const summary = await deps.staging.summary(cmd.workspaceId, job.id);
      job.updateReviewCounters(countersOf(summary), deps.clock.now().toString());
      await this.save(job);
      return { updated, version: job.state.version };
    });
  }

  // ───────────────────────────────────────────────────────────── reevaluar reglas

  /**
   * `ReevaluateImportRules` (decisión 8): recalcula la PROPUESTA de clasificación de las filas con las reglas vigentes
   * y NO toca lo que el usuario editó (origen manual). Una falla de RULES deja las filas sin propuesta con la
   * advertencia `IMPORT_RULES_UNAVAILABLE`, sin impedir la revisión.
   */
  reevaluateRules(cmd: {
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
      const account = await deps.accounts.getAccount(cmd.workspaceId, job.state.accountId);
      if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
      const rows = (await deps.staging.loadAll(cmd.workspaceId, job.id)).filter(
        (r) =>
          (r.classification === 'NEW' || r.classification === 'DUPLICATE_PROBABLE') &&
          r.bookingDate !== null &&
          r.amount !== null &&
          r.direction !== null,
      );
      const proposals = await buildProposals(deps, {
        workspaceId: cmd.workspaceId,
        accountId: account.accountId,
        currencyCode: account.currency,
        rows: rows.map((r) => ({
          id: r.id,
          kind: rulesSubjectKind(r.direction as 'IN' | 'OUT'),
          date: r.bookingDate as string,
          amount: r.amount as string,
          description: r.description,
          externalSource: r.externalId ? `imports.ext:${job.state.format ?? 'CSV'}` : null,
          edits: r.edits,
        })),
      });
      await deps.staging.applyProposals(
        cmd.workspaceId,
        job.id,
        rows.map((r) => {
          const out = proposals.get(r.id);
          return {
            id: r.id,
            proposal: out?.proposal ?? null,
            warnings: out?.rulesUnavailable
              ? [{ code: 'IMPORT_RULES_UNAVAILABLE' as const, severity: 'WARNING' as const }]
              : [],
          };
        }),
      );
      const byRule = rows.filter(
        (r) => proposals.get(r.id)?.proposal.category?.origin.type === 'RULE',
      ).length;
      const without = rows.filter((r) => {
        const effective =
          r.edits.categoryId !== undefined
            ? r.edits.categoryId
            : (proposals.get(r.id)?.proposal.category?.value ?? null);
        return effective === null;
      }).length;
      const summary = await deps.staging.summary(cmd.workspaceId, job.id);
      job.reevaluated({
        rulesSummary: {
          rows: rows.length,
          classifiedByRule: byRule,
          withoutCategory: without,
          ratio: ratio(byRule, rows.length),
          rulesUnavailable: [...proposals.values()].some((p) => p.rulesUnavailable),
        },
        counters: countersOf(summary),
        now: deps.clock.now().toString(),
      });
      await this.save(job);
      await recordJob(deps, job, 'rules_reevaluated', {
        changes: [{ field: 'ruleCount', before: null, after: byRule }],
      });
      return toJobView(job.state, account.currency);
    });
  }

  // ───────────────────────────────────────────────────────────── coincidencias con compromisos

  /** Confirma el vínculo de las filas con un único candidato de confianza alta (acción explícita; D121). */
  confirmOccurrenceMatches(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly importId: string;
    readonly expectedVersion: number;
  }): Promise<{ readonly confirmed: number; readonly version: number }> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const job = await this.load(cmd.workspaceId, cmd.importId);
      this.assertVersion(job, cmd.expectedVersion);
      job.assertAwaitingReview();
      const confirmed = await deps.staging.confirmHighConfidenceMatches(cmd.workspaceId, job.id);
      const summary = await deps.staging.summary(cmd.workspaceId, job.id);
      job.updateReviewCounters(countersOf(summary), deps.clock.now().toString());
      await this.save(job);
      return { confirmed, version: job.state.version };
    });
  }

  // ───────────────────────────────────────────────────────────── saldo del extracto

  /** `SetImportStatement`: saldo inicial/final y periodo del extracto (CSV, XLSX, QIF) o corrección de los del archivo. */
  setStatement(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly importId: string;
    readonly expectedVersion: number;
    readonly statement: {
      readonly openingBalance?: { amount: string; currency: string } | null;
      readonly closingBalance?: { amount: string; currency: string } | null;
      readonly periodFrom?: string | null;
      readonly periodTo?: string | null;
    };
  }): Promise<ImportJobView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const job = await this.load(cmd.workspaceId, cmd.importId);
      this.assertVersion(job, cmd.expectedVersion);
      const status = job.state.status;
      if (status !== 'AWAITING_MAPPING' && status !== 'AWAITING_REVIEW') {
        throw new DomainError(
          'INVALID_STATUS_TRANSITION',
          `an import in ${status} has no editable statement`,
        );
      }
      const account = await deps.accounts.getAccount(cmd.workspaceId, job.state.accountId);
      if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
      const scale = (await deps.currencies.scaleOf(account.currency)) ?? 2;
      const balance = (value: { amount: string; currency: string } | null | undefined, pointer: string) => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        if (value.currency !== account.currency) {
          throw new DomainError('VALIDATION_FAILED', 'the balance must be in the currency of the account').at(
            `${pointer}/currency`,
          );
        }
        try {
          return Money.parse(value.amount, makeCurrency(account.currency, scale)).toJSON().amount;
        } catch (error) {
          throw error instanceof DomainError ? error.at(`${pointer}/amount`) : error;
        }
      };
      const previous = job.state.statement;
      const statement: ImportStatementInfo = {
        openingBalance:
          balance(cmd.statement.openingBalance, '/openingBalance') ?? previous?.openingBalance ?? null,
        closingBalance:
          balance(cmd.statement.closingBalance, '/closingBalance') ?? previous?.closingBalance ?? null,
        closingDate:
          cmd.statement.periodTo === undefined ? (previous?.closingDate ?? null) : cmd.statement.periodTo,
        periodFrom:
          cmd.statement.periodFrom === undefined ? (previous?.periodFrom ?? null) : cmd.statement.periodFrom,
        periodTo:
          cmd.statement.periodTo === undefined ? (previous?.periodTo ?? null) : cmd.statement.periodTo,
      };
      // Un valor explícito `null` borra el saldo; `undefined` conserva el anterior.
      const cleared: ImportStatementInfo = {
        ...statement,
        ...(cmd.statement.openingBalance === null ? { openingBalance: null } : {}),
        ...(cmd.statement.closingBalance === null ? { closingBalance: null } : {}),
      };
      job.setStatement(cleared, deps.clock.now().toString());
      await this.save(job);
      await recordJob(deps, job, 'statement_set', {
        changes: [
          {
            field: 'statement',
            before: previous ? JSON.stringify(previous) : null,
            after: JSON.stringify(cleared),
          },
        ],
      });
      return toJobView(job.state, account.currency);
    });
  }

  // ───────────────────────────────────────────────────────────── aprobar

  /**
   * `ApproveImport`: exige que no queden posibles duplicados sin decisión (`IMPORT_REVIEW_INCOMPLETE` con
   * `pendingDecisions`; la vinculación preseleccionada de confianza alta cuenta como decisión), reparte las filas a
   * crear en lotes, vincula las omitidas con su movimiento existente (cada vínculo queda auditado con la línea, el
   * movimiento, el puntaje y quien aprobó), pasa a `APPROVED` y publica `imports.ImportApproved.v1` en la misma
   * transacción. La persistencia es asíncrona (worker).
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
      const namespace = `imports.ext:${job.state.format ?? 'CSV'}`;
      await deps.links.insertMany(
        cmd.workspaceId,
        skipped.map((r) => ({
          id: deps.ids.next(),
          accountId: account.accountId,
          fingerprint: r.fingerprint,
          transactionId: r.matchedTransactionId,
          stagedTransactionId: r.rowId,
          kind: 'SKIPPED_AS_DUPLICATE' as const,
          importJobId: job.id,
          externalRef: r.externalId ? { namespace, id: r.externalId } : null,
        })),
      );
      const linkEntries = skipped.map((r) => ({
        workspaceId: cmd.workspaceId,
        action: 'imports.row.linked',
        aggregateType: 'ImportRow',
        aggregateId: r.rowId,
        aggregateVersion: null,
        changes: [
          { field: 'line', before: null, after: r.lineNumber },
          { field: 'transactionId', before: null, after: r.matchedTransactionId },
          { field: 'score', before: null, after: r.decidedScore ?? '' },
          { field: 'decision', before: null, after: 'SKIP' },
        ],
      }));
      if (linkEntries.length > 0) {
        if (deps.audit.appendMany) await deps.audit.appendMany(linkEntries);
        else for (const entry of linkEntries) await deps.audit.append(entry);
      }

      const now = deps.clock.now().toString();
      job.approve({ userId: cmd.userId, now, batchCount: plan.length });
      await this.save(job);
      const event = await this.publish(job, IMPORTS_EVENTS.approved, { attempt: job.state.progress.attempt });
      const changes: AuditChangeInput[] = [
        { field: 'status', before: 'AWAITING_REVIEW', after: 'APPROVED' },
        { field: 'counters', before: null, after: JSON.stringify(job.state.counters) },
      ];
      await recordJob(deps, job, 'approved', { events: [event], changes });
      return toJobView(job.state, account.currency);
    });
  }

  // ───────────────────────────────────────────────────────────── cancelar

  /** `CancelImport`: antes de aprobar (también en «subida» y «procesando»); descarta las celdas crudas y audita. */
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
      await recordJob(deps, job, 'cancelled', {
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
      const event = await this.publish(job, IMPORTS_EVENTS.approved, { attempt: job.state.progress.attempt });
      await recordJob(deps, job, 'retried', {
        events: [event],
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
      const event = await publishCompleted(
        deps,
        job.state,
        await deps.staging.dateRange(cmd.workspaceId, job.id),
      );
      await recordJob(deps, job, 'errors_accepted', {
        events: [event],
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
) {
  const c = s.counters;
  const eventId = deps.ids.next();
  await deps.outbox.append({
    eventId,
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
      sourceType: s.source,
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
  return { eventId, eventType: `${IMPORTS_EVENTS.completed.eventType}.v1` };
}
