import { DomainError } from '@pf/shared-kernel';
import type { CsvMapping } from './csv-mapping.js';
import type { CsvDelimiter, CsvEncoding } from './csv-sniffer.js';
import type { ImportStatus } from './types.js';

/**
 * Agregado `ImportJob` (docs/13 §3, subconjunto de Phase 3; decisión 1 de add-basic-csv-import):
 *
 *   AWAITING_MAPPING ⇄ AWAITING_REVIEW → APPROVED → PERSISTING → COMPLETED | PARTIALLY_FAILED
 *   PARTIALLY_FAILED → PERSISTING (reintento) | COMPLETED_WITH_ERRORS (aceptar)
 *   AWAITING_MAPPING | AWAITING_REVIEW → CANCELLED (usuario o expiración)
 *
 * Phase 6 agrega CREATED/UPLOADED/PARSING/…; la columna `status` es `text` ampliable. Solo auditoría del job
 * (docs/35 D151): no declara máquina de recorrido.
 */

/** Conteos de filas del job (nombres sin sufijos monetarios: son recuentos, nunca importes). */
export interface ImportCounters {
  /** Filas de datos en el staging. */
  readonly rows: number;
  readonly newRows: number;
  readonly alreadyImported: number;
  readonly probableDuplicates: number;
  readonly invalid: number;
  /** Filas decididas `CREATE`/`SKIP`/`EXCLUDE` (las nuevas valen `CREATE` por omisión). */
  readonly toCreate: number;
  readonly skipped: number;
  readonly excluded: number;
  /** Resultado de la persistencia. */
  readonly created: number;
  readonly failed: number;
}

export const EMPTY_COUNTERS: ImportCounters = {
  rows: 0,
  newRows: 0,
  alreadyImported: 0,
  probableDuplicates: 0,
  invalid: 0,
  toCreate: 0,
  skipped: 0,
  excluded: 0,
  created: 0,
  failed: 0,
};

export interface ImportProgress {
  /** Intento de persistencia (1 = primera aprobación; +1 por reintento). */
  readonly attempt: number;
  readonly batchCount: number;
  readonly batchesDone: number;
}

export interface ImportErrorGroup {
  readonly code: string;
  readonly count: number;
  /** Primeras líneas del archivo afectadas (tope 100). */
  readonly lines: readonly number[];
}

export interface ImportWarning {
  readonly code: 'IMPORT_FILE_ALREADY_IMPORTED';
  readonly previousImportId: string;
  /** Fecha de negocio (zona del workspace) en que terminó la importación anterior. */
  readonly previousImportedAt: string;
}

export type ImportActor = { readonly type: 'USER'; readonly userId: string } | { readonly type: 'SYSTEM' };

export interface ImportJobState {
  readonly id: string;
  readonly workspaceId: string;
  readonly accountId: string;
  readonly status: ImportStatus;
  readonly originalName: string | null;
  /** SHA-256 hexadecimal del archivo. */
  readonly fileChecksum: string;
  readonly fileSizeBytes: number;
  readonly encoding: CsvEncoding;
  readonly delimiter: CsvDelimiter;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly header: readonly string[];
  readonly mapping: CsvMapping | null;
  readonly counters: ImportCounters;
  readonly progress: ImportProgress;
  readonly errors: readonly ImportErrorGroup[];
  readonly warnings: readonly ImportWarning[];
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledBy: ImportActor | null;
  readonly expiresAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

const transition = (from: ImportStatus, to: ImportStatus) =>
  new DomainError('INVALID_STATUS_TRANSITION', `an import in ${from} cannot move to ${to}`);

const REVIEWABLE: readonly ImportStatus[] = ['AWAITING_MAPPING', 'AWAITING_REVIEW'];

export class ImportJob {
  private current: ImportJobState;
  private persisted: number;

  private constructor(state: ImportJobState, persistedVersion: number) {
    this.current = state;
    this.persisted = persistedVersion;
  }

  /** Nuevo job tras leer el archivo: espera el mapeo y caduca a los `ttlMs` si nadie lo aprueba. */
  static create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly accountId: string;
    readonly createdBy: string;
    readonly now: string;
    readonly originalName: string | null;
    readonly fileChecksum: string;
    readonly fileSizeBytes: number;
    readonly encoding: CsvEncoding;
    readonly delimiter: CsvDelimiter;
    readonly rowCount: number;
    readonly columnCount: number;
    readonly header: readonly string[];
    readonly warnings: readonly ImportWarning[];
    readonly expiresAt: string;
  }): ImportJob {
    return new ImportJob(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        status: 'AWAITING_MAPPING',
        originalName: input.originalName,
        fileChecksum: input.fileChecksum,
        fileSizeBytes: input.fileSizeBytes,
        encoding: input.encoding,
        delimiter: input.delimiter,
        rowCount: input.rowCount,
        columnCount: input.columnCount,
        header: input.header,
        mapping: null,
        counters: { ...EMPTY_COUNTERS, rows: input.rowCount },
        progress: { attempt: 0, batchCount: 0, batchesDone: 0 },
        errors: [],
        warnings: input.warnings,
        approvedBy: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        expiresAt: input.expiresAt,
        createdBy: input.createdBy,
        createdAt: input.now,
        updatedAt: input.now,
        version: 1,
      },
      0,
    );
  }

  static rehydrate(state: ImportJobState): ImportJob {
    return new ImportJob(state, state.version);
  }

  get state(): ImportJobState {
    return this.current;
  }

  /** Versión leída de la base (control optimista del repositorio). */
  get persistedVersion(): number {
    return this.persisted;
  }

  get id(): string {
    return this.current.id;
  }

  private update(patch: Partial<ImportJobState>, now: string): void {
    this.current = { ...this.current, ...patch, updatedAt: now, version: this.current.version + 1 };
  }

  /** La base confirmó la escritura: la versión persistida alcanza a la del agregado. */
  markPersisted(): void {
    this.persisted = this.current.version;
  }

  /** Aplicar o volver a enviar el mapeo (mientras no esté aprobado): recalcula conteos y deja el job en revisión. */
  applyMapping(input: {
    readonly mapping: CsvMapping;
    readonly counters: ImportCounters;
    readonly now: string;
  }): void {
    if (!REVIEWABLE.includes(this.current.status)) {
      throw transition(this.current.status, 'AWAITING_REVIEW');
    }
    this.update(
      {
        status: 'AWAITING_REVIEW',
        mapping: input.mapping,
        counters: { ...input.counters, created: 0, failed: 0 },
      },
      input.now,
    );
  }

  /** Las decisiones de fila cambian los conteos de la revisión (solo en `AWAITING_REVIEW`). */
  updateReviewCounters(counters: ImportCounters, now: string): void {
    if (this.current.status !== 'AWAITING_REVIEW') throw transition(this.current.status, 'AWAITING_REVIEW');
    this.update({ counters: { ...counters, created: 0, failed: 0 } }, now);
  }

  assertAwaitingReview(): void {
    if (this.current.status !== 'AWAITING_REVIEW') throw transition(this.current.status, 'AWAITING_REVIEW');
  }

  approve(input: { readonly userId: string; readonly now: string; readonly batchCount: number }): void {
    if (this.current.status !== 'AWAITING_REVIEW') throw transition(this.current.status, 'APPROVED');
    this.update(
      {
        status: 'APPROVED',
        approvedBy: input.userId,
        approvedAt: input.now,
        expiresAt: null,
        progress: { attempt: 1, batchCount: input.batchCount, batchesDone: 0 },
      },
      input.now,
    );
  }

  cancel(input: { readonly actor: ImportActor; readonly now: string }): void {
    if (!REVIEWABLE.includes(this.current.status)) throw transition(this.current.status, 'CANCELLED');
    this.update(
      { status: 'CANCELLED', cancelledAt: input.now, cancelledBy: input.actor, expiresAt: null },
      input.now,
    );
  }

  /** El consumidor toma el job: `APPROVED → PERSISTING`; re-entregar el evento en `PERSISTING` es idempotente. */
  beginPersisting(now: string): void {
    if (this.current.status === 'PERSISTING') return;
    if (this.current.status !== 'APPROVED') throw transition(this.current.status, 'PERSISTING');
    this.update({ status: 'PERSISTING' }, now);
  }

  /** Un lote persistido: suma las creadas y las que ya existían (carrera con otro job) y avanza el progreso. */
  recordBatch(input: {
    readonly created: number;
    readonly alreadyExisting?: number;
    readonly now: string;
  }): void {
    if (this.current.status !== 'PERSISTING') throw transition(this.current.status, 'PERSISTING');
    const counters = this.current.counters;
    this.update(
      {
        counters: {
          ...counters,
          created: counters.created + input.created,
          alreadyImported: counters.alreadyImported + (input.alreadyExisting ?? 0),
        },
        progress: { ...this.current.progress, batchesDone: this.current.progress.batchesDone + 1 },
      },
      input.now,
    );
  }

  /** Fin de la persistencia: `COMPLETED` si no quedan filas fallidas, si no `PARTIALLY_FAILED`. */
  finish(input: {
    readonly failed: number;
    readonly errors: readonly ImportErrorGroup[];
    readonly now: string;
  }): ImportStatus {
    if (this.current.status !== 'PERSISTING') throw transition(this.current.status, 'COMPLETED');
    const status: ImportStatus = input.failed === 0 ? 'COMPLETED' : 'PARTIALLY_FAILED';
    this.update(
      {
        status,
        counters: { ...this.current.counters, failed: input.failed },
        errors: input.failed === 0 ? [] : input.errors,
        completedAt: status === 'COMPLETED' ? input.now : null,
        progress: { ...this.current.progress, batchesDone: this.current.progress.batchCount },
      },
      input.now,
    );
    return status;
  }

  /** Reintento de las filas fallidas: `PARTIALLY_FAILED → PERSISTING` con un intento más. */
  retry(now: string): void {
    if (this.current.status !== 'PARTIALLY_FAILED') throw transition(this.current.status, 'PERSISTING');
    this.update(
      {
        status: 'PERSISTING',
        errors: [],
        progress: { ...this.current.progress, attempt: this.current.progress.attempt + 1, batchesDone: 0 },
      },
      now,
    );
  }

  /** Aceptar el resultado parcial: `PARTIALLY_FAILED → COMPLETED_WITH_ERRORS`. */
  acceptErrors(now: string): void {
    if (this.current.status !== 'PARTIALLY_FAILED')
      throw transition(this.current.status, 'COMPLETED_WITH_ERRORS');
    this.update({ status: 'COMPLETED_WITH_ERRORS', completedAt: now }, now);
  }
}
