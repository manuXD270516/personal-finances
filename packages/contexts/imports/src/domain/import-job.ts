import { DomainError, LifecycleMachine, type StateTransition } from '@pf/shared-kernel';
import type { CsvMapping } from './csv-mapping.js';
import type { CsvDelimiter, CsvEncoding } from './csv-sniffer.js';
import type { ProfileMapping } from './profile-options.js';
import type { StatementFormat } from './statement.js';
import type { ImportStatus } from './types.js';

/**
 * Agregado `ImportJob` (docs/13 §3; openspec add-basic-csv-import decisión 1 y add-import-pipeline decisión 4, D151).
 * La máquina de Phase 6 se declara como `IMPORT_JOB_LIFECYCLE` (recorrido en AUDIT):
 *
 *   ∅ ─CREATE─▶ AWAITING_MAPPING (CSV por multipart)   ∅ ─CREATE_FROM_DOCUMENT─▶ UPLOADED ─START─▶ PROCESSING
 *   PROCESSING ─▶ AWAITING_MAPPING | AWAITING_REVIEW | PARSE_FAILED
 *   AWAITING_MAPPING ─APPLY_MAPPING─▶ PROCESSING (job de documento) | AWAITING_REVIEW (ruta síncrona)
 *   AWAITING_REVIEW ─APPROVE─▶ APPROVED ─▶ PERSISTING ─▶ COMPLETED | COMPLETED_WITH_DIFFERENCE | PARTIALLY_FAILED
 *   PARTIALLY_FAILED ─RETRY─▶ PERSISTING | ─ACCEPT_ERRORS─▶ COMPLETED_WITH_ERRORS
 *   UPLOADED | PROCESSING | AWAITING_* ─CANCEL─▶ CANCELLED
 *   COMPLETED* ─REVERT─▶ REVERTING ─▶ ROLLED_BACK | PARTIALLY_ROLLED_BACK ─REVERT─▶ REVERTING
 *
 * Las etapas del worker (`PARSE`…`MATCH`) son un atributo de `PROCESSING`, no estados (decisión 4).
 */
export const IMPORT_JOB_AGGREGATE = 'ImportJob';

export type ImportJobTransition =
  | 'CREATE'
  | 'CREATE_FROM_DOCUMENT'
  | 'START'
  | 'AWAIT_MAPPING'
  | 'APPLY_MAPPING'
  | 'READY_FOR_REVIEW'
  | 'FAIL_PARSE'
  | 'APPROVE'
  | 'BEGIN_PERSISTING'
  | 'COMPLETE'
  | 'COMPLETE_WITH_DIFFERENCE'
  | 'PARTIAL_FAILURE'
  | 'RETRY'
  | 'ACCEPT_ERRORS'
  | 'CANCEL'
  | 'REVERT'
  | 'FINISH_REVERT';
export type ImportJobTransitionRecord = StateTransition<ImportStatus, ImportJobTransition>;

const COMPLETED_STATES: readonly ImportStatus[] = [
  'COMPLETED',
  'COMPLETED_WITH_DIFFERENCE',
  'COMPLETED_WITH_ERRORS',
];

export const IMPORT_JOB_LIFECYCLE = LifecycleMachine.define({
  aggregateType: IMPORT_JOB_AGGREGATE,
  machineVersion: 1,
  states: [
    { code: 'UPLOADED', terminal: false },
    { code: 'PROCESSING', terminal: false },
    { code: 'AWAITING_MAPPING', terminal: false },
    { code: 'AWAITING_REVIEW', terminal: false },
    { code: 'APPROVED', terminal: false },
    { code: 'PERSISTING', terminal: false },
    { code: 'PARTIALLY_FAILED', terminal: false },
    { code: 'COMPLETED', terminal: false },
    { code: 'COMPLETED_WITH_DIFFERENCE', terminal: false },
    { code: 'COMPLETED_WITH_ERRORS', terminal: false },
    { code: 'REVERTING', terminal: false },
    { code: 'ROLLED_BACK', terminal: true },
    { code: 'PARTIALLY_ROLLED_BACK', terminal: false },
    { code: 'PARSE_FAILED', terminal: true },
    { code: 'CANCELLED', terminal: true },
  ],
  transitions: [
    {
      code: 'CREATE',
      from: [],
      to: ['AWAITING_MAPPING'],
      guard: 'OWNER o EDITOR; archivo CSV de la ruta multipart; cuenta activa',
      events: [],
    },
    {
      code: 'CREATE_FROM_DOCUMENT',
      from: [],
      to: ['UPLOADED'],
      guard: 'OWNER o EDITOR; cuenta activa; documento disponible de propósito «extracto para importar»',
      events: ['imports.ImportFileUploaded.v1'],
    },
    {
      code: 'START',
      from: ['UPLOADED'],
      to: ['PROCESSING'],
      guard: 'sistema: el worker toma la importación',
      events: [],
    },
    {
      code: 'AWAIT_MAPPING',
      from: ['PROCESSING'],
      to: ['AWAITING_MAPPING'],
      guard: 'sistema: ningún perfil aplica o el formato exige un dato del mapeo',
      events: [],
    },
    {
      code: 'APPLY_MAPPING',
      from: ['AWAITING_MAPPING', 'AWAITING_REVIEW'],
      to: ['PROCESSING', 'AWAITING_REVIEW'],
      guard: 'OWNER o EDITOR; mapeo o perfil válidos; en un job de documento se reprocesa en el worker',
      events: ['imports.ImportFileUploaded.v1'],
    },
    {
      code: 'READY_FOR_REVIEW',
      from: ['PROCESSING'],
      to: ['AWAITING_REVIEW'],
      guard: 'sistema: etapas terminadas',
      events: ['imports.ImportPreviewReady.v1'],
    },
    {
      code: 'FAIL_PARSE',
      from: ['UPLOADED', 'PROCESSING'],
      to: ['PARSE_FAILED'],
      guard: 'sistema: error estructural del archivo o límites excedidos',
      events: ['imports.ImportFailed.v1'],
    },
    {
      code: 'APPROVE',
      from: ['AWAITING_REVIEW'],
      to: ['APPROVED'],
      guard: 'OWNER o EDITOR; sin decisiones pendientes',
      events: ['imports.ImportApproved.v1'],
    },
    {
      code: 'BEGIN_PERSISTING',
      from: ['APPROVED'],
      to: ['PERSISTING'],
      guard: 'sistema: el worker toma la importación aprobada',
      events: [],
    },
    {
      code: 'COMPLETE',
      from: ['PERSISTING'],
      to: ['COMPLETED'],
      guard: 'sistema: sin filas fallidas y sin diferencia contra el extracto',
      events: ['imports.ImportCompleted.v1'],
    },
    {
      code: 'COMPLETE_WITH_DIFFERENCE',
      from: ['PERSISTING'],
      to: ['COMPLETED_WITH_DIFFERENCE'],
      guard: 'sistema: el saldo de la cuenta difiere del saldo final del extracto',
      events: ['imports.ImportCompleted.v1'],
    },
    {
      code: 'PARTIAL_FAILURE',
      from: ['PERSISTING'],
      to: ['PARTIALLY_FAILED'],
      guard: 'sistema: quedaron filas con error',
      events: [],
    },
    {
      code: 'RETRY',
      from: ['PARTIALLY_FAILED'],
      to: ['PERSISTING'],
      guard: 'OWNER o EDITOR',
      events: ['imports.ImportApproved.v1'],
    },
    {
      code: 'ACCEPT_ERRORS',
      from: ['PARTIALLY_FAILED'],
      to: ['COMPLETED_WITH_ERRORS'],
      guard: 'OWNER o EDITOR',
      events: ['imports.ImportCompleted.v1'],
    },
    {
      code: 'CANCEL',
      from: ['UPLOADED', 'PROCESSING', 'AWAITING_MAPPING', 'AWAITING_REVIEW'],
      to: ['CANCELLED'],
      guard: 'OWNER o EDITOR, o el sistema al vencer la revisión',
      events: [],
    },
    {
      code: 'REVERT',
      from: [...COMPLETED_STATES, 'PARTIALLY_ROLLED_BACK'],
      to: ['REVERTING'],
      guard: 'OWNER o EDITOR; sin bloqueadas o con deshacer parcial explícito',
      events: ['imports.ImportRevertRequested.v1'],
    },
    {
      code: 'FINISH_REVERT',
      from: ['REVERTING'],
      to: ['ROLLED_BACK', 'PARTIALLY_ROLLED_BACK'],
      guard: 'sistema: todas anuladas, o quedan bloqueadas aceptadas',
      events: ['imports.ImportReverted.v1'],
    },
  ],
});

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

/** Etapas del worker dentro de `PROCESSING` (decisión 4). */
export const IMPORT_STAGES = ['PARSE', 'NORMALIZE', 'VALIDATE', 'CLASSIFY', 'DEDUPE', 'MATCH'] as const;
export type ImportStage = (typeof IMPORT_STAGES)[number];

export interface ImportProgress {
  /** Intento de persistencia (1 = primera aprobación; +1 por reintento). */
  readonly attempt: number;
  readonly batchCount: number;
  readonly batchesDone: number;
  /** Etapa del procesamiento en el worker (solo `PROCESSING`). */
  readonly stage?: ImportStage | null;
  /** Filas procesadas de la etapa actual / total de filas del archivo. */
  readonly processedRows?: number;
  readonly totalRows?: number;
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

export const IMPORT_SOURCES = ['FILE_CSV', 'FILE_OFX', 'FILE_QIF', 'FILE_JSON', 'FILE_XLSX'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const sourceOfFormat = (format: StatementFormat): ImportSource => `FILE_${format}`;

/** Falla estructural del archivo (`PARSE_FAILED`): código y ubicación, nunca texto del archivo (NFR-SEC-015). */
export interface ImportFailure {
  readonly code: 'IMPORT_PARSE_FAILED' | 'IMPORT_TOO_MANY_ROWS' | 'IMPORT_UNSUPPORTED_FORMAT';
  readonly pointer: string | null;
  readonly detail?: string;
}

export interface ProfileCandidateInfo {
  readonly profileId: string;
  readonly version: number;
  readonly name: string;
  readonly missingColumns: readonly string[];
}

/** Ayuda del estado «esperando mapeo»: perfiles candidatos y columnas que faltan (decisión 6). */
export interface MappingHelp {
  readonly profileCandidates: readonly ProfileCandidateInfo[];
  readonly missingColumns: readonly string[];
  /** Datos del mapeo que el formato exige (p. ej. orden de la fecha de QIF). */
  readonly needs: readonly ('IMPORT_AMBIGUOUS_DATE' | 'IMPORT_AMBIGUOUS_NUMBER')[];
}

/** Saldos y periodo del extracto (archivo o `PUT .../statement`); decimales exactos en la moneda de la cuenta. */
export interface ImportStatementInfo {
  readonly openingBalance: string | null;
  readonly closingBalance: string | null;
  readonly closingDate: string | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
}

/** Resultado de la reconciliación contra el saldo final del extracto (decisión 14; sin ajuste automático). */
export interface ImportReconciliation {
  readonly outcome: 'MATCHED' | 'DIFFERENCE';
  readonly statementBalance: string;
  readonly accountBalance: string;
  /** `statementBalance − accountBalance`. */
  readonly difference: string;
  readonly statementDate: string;
}

export interface ImportRevertSummary {
  readonly allowPartial: boolean;
  readonly requested: number;
  readonly voided: number;
  readonly alreadyVoided: number;
  readonly blocked: number;
  readonly requestedBy: string;
}

/** Cobertura de reglas del resumen final (decisión del requirement «Resumen final con la cobertura de reglas»). */
export interface ImportRulesSummary {
  readonly rows: number;
  readonly classifiedByRule: number;
  readonly withoutCategory: number;
  /** Texto decimal de 4 decimales (`classifiedByRule / rows`). */
  readonly ratio: string;
  /** La evaluación de reglas no estuvo disponible (`IMPORT_RULES_UNAVAILABLE`). */
  readonly rulesUnavailable: boolean;
}

export interface ImportMappingRef {
  readonly id: string;
  readonly version: number;
}

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
  // ── Phase 6 (add-import-pipeline): todos opcionales para los jobs de la ruta CSV básica.
  readonly source: ImportSource;
  readonly documentId: string | null;
  readonly format: StatementFormat | null;
  readonly mappingProfile: ImportMappingRef | null;
  /** Mapeo tabular efectivo de un job de documento (perfil aplicado o mapeo enviado), con posiciones resueltas. */
  readonly profileMapping: ProfileMapping | null;
  /** Dato que el formato exige para leerse (orden de la fecha de QIF) cuando el perfil no lo trae. */
  readonly readOptions: { readonly dateOrder: 'DMY' | 'MDY' | null } | null;
  readonly mappingHelp: MappingHelp | null;
  readonly statement: ImportStatementInfo | null;
  readonly reconciliation: ImportReconciliation | null;
  readonly revert: ImportRevertSummary | null;
  readonly revertedAt: string | null;
  readonly revertedBy: string | null;
  readonly rulesSummary: ImportRulesSummary | null;
  readonly failure: ImportFailure | null;
}

const transition = (from: ImportStatus, to: ImportStatus) =>
  new DomainError('INVALID_STATUS_TRANSITION', `an import in ${from} cannot move to ${to}`);

const REVIEWABLE: readonly ImportStatus[] = ['AWAITING_MAPPING', 'AWAITING_REVIEW'];
const CANCELLABLE: readonly ImportStatus[] = [
  'UPLOADED',
  'PROCESSING',
  'AWAITING_MAPPING',
  'AWAITING_REVIEW',
];
const NO_PHASE6 = {
  source: 'FILE_CSV',
  documentId: null,
  format: null,
  mappingProfile: null,
  profileMapping: null,
  readOptions: null,
  mappingHelp: null,
  statement: null,
  reconciliation: null,
  revert: null,
  revertedAt: null,
  revertedBy: null,
  rulesSummary: null,
  failure: null,
} as const;

export class ImportJob {
  private current: ImportJobState;
  private persisted: number;
  private transitionRecord: ImportJobTransitionRecord | null = null;
  private changed = new Set<string>();

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
    const job = new ImportJob(
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
        ...NO_PHASE6,
      },
      0,
    );
    job.transitionRecord = { transition: 'CREATE', from: null, to: 'AWAITING_MAPPING' };
    return job;
  }

  /** Importación de un documento ya disponible (`UPLOADED`): todavía no se lee su contenido (decisión 2). */
  static createFromDocument(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly accountId: string;
    readonly createdBy: string;
    readonly now: string;
    readonly documentId: string;
    readonly format: StatementFormat;
    readonly originalName: string | null;
    readonly fileChecksum: string;
    readonly fileSizeBytes: number;
    readonly warnings: readonly ImportWarning[];
    readonly mappingProfile: ImportMappingRef | null;
  }): ImportJob {
    const job = new ImportJob(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        status: 'UPLOADED',
        originalName: input.originalName,
        fileChecksum: input.fileChecksum,
        fileSizeBytes: input.fileSizeBytes,
        // Neutros: el contrato `detected` es requerido; los formatos que no son CSV no tienen codificación propia.
        encoding: 'utf-8',
        delimiter: ',',
        rowCount: 0,
        columnCount: 1,
        header: [],
        mapping: null,
        counters: EMPTY_COUNTERS,
        progress: { attempt: 0, batchCount: 0, batchesDone: 0 },
        errors: [],
        warnings: input.warnings,
        approvedBy: null,
        approvedAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        expiresAt: null,
        createdBy: input.createdBy,
        createdAt: input.now,
        updatedAt: input.now,
        version: 1,
        ...NO_PHASE6,
        source: sourceOfFormat(input.format),
        documentId: input.documentId,
        format: input.format,
        mappingProfile: input.mappingProfile,
      },
      0,
    );
    job.transitionRecord = { transition: 'CREATE_FROM_DOCUMENT', from: null, to: 'UPLOADED' };
    return job;
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

  /** Transición aplicada por la última operación (`null` si fue una anotación), para el recorrido. */
  get lastTransition(): ImportJobTransitionRecord | null {
    return this.transitionRecord;
  }

  get changedFields(): readonly string[] {
    return [...this.changed];
  }

  /** `true` si el job viene de un documento (se procesa en el worker). */
  get isDocumentJob(): boolean {
    return this.current.documentId !== null;
  }

  private update(patch: Partial<ImportJobState>, now: string): void {
    this.changed = new Set(Object.keys(patch));
    this.transitionRecord = null;
    this.current = { ...this.current, ...patch, updatedAt: now, version: this.current.version + 1 };
  }

  private move(
    code: ImportJobTransition,
    to: ImportStatus,
    patch: Partial<ImportJobState>,
    now: string,
  ): void {
    const def = IMPORT_JOB_LIFECYCLE.transitionDefinition(code);
    const from = this.current.status;
    if (!def || !def.from.includes(from) || !def.to.includes(to)) throw transition(from, to);
    this.update({ ...patch, status: to }, now);
    this.changed.add('status');
    this.transitionRecord = { transition: code, from, to };
  }

  /** La base confirmó la escritura: la versión persistida alcanza a la del agregado. */
  markPersisted(): void {
    this.persisted = this.current.version;
  }

  // ───────────────────────────────────────────────────────────── procesamiento en el worker

  /**
   * El worker toma el job: `UPLOADED → PROCESSING` (etapa `PARSE`). Re-entregar el evento con el job ya en
   * `PROCESSING` no cambia nada (idempotente); devuelve `false` si no hay nada que hacer en este estado.
   */
  beginProcessing(now: string): boolean {
    if (this.current.status === 'PROCESSING') return true;
    if (this.current.status !== 'UPLOADED') return false;
    this.move(
      'START',
      'PROCESSING',
      { progress: { ...this.current.progress, stage: 'PARSE', processedRows: 0, totalRows: 0 } },
      now,
    );
    return true;
  }

  /** Punto de control: etapa actual y filas procesadas (anotación; informa el avance al usuario). */
  checkpoint(input: { stage: ImportStage; processedRows: number; totalRows: number; now: string }): void {
    if (this.current.status !== 'PROCESSING') throw transition(this.current.status, 'PROCESSING');
    this.update(
      {
        progress: {
          ...this.current.progress,
          stage: input.stage,
          processedRows: input.processedRows,
          totalRows: input.totalRows,
        },
      },
      input.now,
    );
  }

  /** `PROCESSING → AWAITING_MAPPING`: ningún perfil aplica o falta un dato del mapeo; hay celdas en el staging. */
  awaitMapping(input: {
    readonly help: MappingHelp;
    readonly rowCount: number;
    readonly columnCount: number;
    readonly header: readonly string[];
    readonly encoding: CsvEncoding;
    readonly delimiter: CsvDelimiter;
    readonly statement: ImportStatementInfo | null;
    readonly expiresAt: string;
    readonly now: string;
  }): void {
    this.move(
      'AWAIT_MAPPING',
      'AWAITING_MAPPING',
      {
        mappingHelp: input.help,
        rowCount: input.rowCount,
        columnCount: Math.max(1, input.columnCount),
        header: input.header,
        encoding: input.encoding,
        delimiter: input.delimiter,
        statement: input.statement ?? this.current.statement,
        counters: { ...EMPTY_COUNTERS, rows: input.rowCount },
        progress: { ...this.current.progress, stage: null },
        expiresAt: input.expiresAt,
      },
      input.now,
    );
  }

  /**
   * Aplicar un mapeo o perfil. En un job de documento deja el procesamiento al worker
   * (`AWAITING_MAPPING → PROCESSING`, etapa `NORMALIZE`); en la ruta CSV síncrona recalcula los conteos y deja el job
   * en revisión. Se puede volver a enviar mientras no esté aprobado.
   */
  applyMapping(input: {
    readonly mapping: CsvMapping | null;
    readonly counters: ImportCounters;
    readonly now: string;
    readonly profile?: ImportMappingRef | null;
    readonly profileMapping?: ProfileMapping | null;
    /** Etapa desde la que el worker reanuda un job de documento (por omisión, la normalización). */
    readonly restartStage?: ImportStage;
    readonly readOptions?: ImportJobState['readOptions'];
  }): void {
    if (!REVIEWABLE.includes(this.current.status)) {
      throw transition(this.current.status, 'AWAITING_REVIEW');
    }
    if (this.isDocumentJob) {
      this.move(
        'APPLY_MAPPING',
        'PROCESSING',
        {
          mapping: input.mapping,
          profileMapping: input.profileMapping ?? null,
          readOptions: input.readOptions ?? this.current.readOptions,
          mappingProfile: input.profile ?? null,
          mappingHelp: null,
          expiresAt: null,
          progress: { ...this.current.progress, stage: input.restartStage ?? 'NORMALIZE', processedRows: 0 },
        },
        input.now,
      );
      return;
    }
    this.move(
      'APPLY_MAPPING',
      'AWAITING_REVIEW',
      {
        mapping: input.mapping,
        mappingProfile: input.profile ?? this.current.mappingProfile,
        counters: { ...input.counters, created: 0, failed: 0 },
      },
      input.now,
    );
  }

  /** Aplica el mapeo/perfil fijado por la lectura automática (el worker, sin reprocesar el evento). */
  applyProfileAutomatically(input: {
    readonly profileMapping: ProfileMapping | null;
    readonly profile: ImportMappingRef | null;
    readonly now: string;
  }): void {
    if (this.current.status !== 'PROCESSING') throw transition(this.current.status, 'PROCESSING');
    this.update(
      { profileMapping: input.profileMapping, mappingProfile: input.profile, mappingHelp: null },
      input.now,
    );
  }

  /** `PROCESSING → AWAITING_REVIEW`: etapas terminadas, con los conteos de la vista previa. */
  readyForReview(input: {
    readonly counters: ImportCounters;
    readonly rowCount: number;
    readonly statement: ImportStatementInfo | null;
    readonly rulesSummary: ImportRulesSummary | null;
    readonly expiresAt: string;
    readonly now: string;
  }): void {
    this.move(
      'READY_FOR_REVIEW',
      'AWAITING_REVIEW',
      {
        counters: { ...input.counters, created: 0, failed: 0 },
        rowCount: input.rowCount,
        statement: input.statement ?? this.current.statement,
        rulesSummary: input.rulesSummary,
        expiresAt: input.expiresAt,
        progress: {
          ...this.current.progress,
          stage: null,
          processedRows: input.rowCount,
          totalRows: input.rowCount,
        },
      },
      input.now,
    );
  }

  /** `UPLOADED | PROCESSING → PARSE_FAILED`: error estructural; sin filas ni texto del archivo. */
  failParse(input: { readonly failure: ImportFailure; readonly now: string }): void {
    this.move(
      'FAIL_PARSE',
      'PARSE_FAILED',
      { failure: input.failure, expiresAt: null, progress: { ...this.current.progress, stage: null } },
      input.now,
    );
  }

  /** Saldo/periodo del extracto fijado por el usuario (`PUT .../statement`) o leído del archivo. */
  setStatement(statement: ImportStatementInfo, now: string): void {
    if (!REVIEWABLE.includes(this.current.status) && this.current.status !== 'PROCESSING') {
      throw transition(this.current.status, 'AWAITING_REVIEW');
    }
    this.update({ statement }, now);
  }

  /** Anotación del recorrido: se reevaluaron las reglas (conteos nuevos y cobertura). */
  reevaluated(input: { rulesSummary: ImportRulesSummary; counters: ImportCounters; now: string }): void {
    this.assertAwaitingReview();
    this.update(
      { rulesSummary: input.rulesSummary, counters: { ...input.counters, created: 0, failed: 0 } },
      input.now,
    );
  }

  // ───────────────────────────────────────────────────────────── revisión

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
    this.move(
      'APPROVE',
      'APPROVED',
      {
        approvedBy: input.userId,
        approvedAt: input.now,
        expiresAt: null,
        progress: { attempt: 1, batchCount: input.batchCount, batchesDone: 0 },
      },
      input.now,
    );
  }

  cancel(input: { readonly actor: ImportActor; readonly now: string }): void {
    if (!CANCELLABLE.includes(this.current.status)) throw transition(this.current.status, 'CANCELLED');
    this.move(
      'CANCEL',
      'CANCELLED',
      {
        cancelledAt: input.now,
        cancelledBy: input.actor,
        expiresAt: null,
        progress: { ...this.current.progress, stage: null },
      },
      input.now,
    );
  }

  // ───────────────────────────────────────────────────────────── persistencia

  /** El consumidor toma el job: `APPROVED → PERSISTING`; re-entregar el evento en `PERSISTING` es idempotente. */
  beginPersisting(now: string): void {
    if (this.current.status === 'PERSISTING') return;
    if (this.current.status !== 'APPROVED') throw transition(this.current.status, 'PERSISTING');
    this.move('BEGIN_PERSISTING', 'PERSISTING', {}, now);
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

  /**
   * Fin de la persistencia: `PARTIALLY_FAILED` si quedan filas fallidas; si no `COMPLETED`, o
   * `COMPLETED_WITH_DIFFERENCE` cuando la reconciliación contra el extracto encontró una diferencia.
   */
  finish(input: {
    readonly failed: number;
    readonly errors: readonly ImportErrorGroup[];
    readonly now: string;
    readonly reconciliation?: ImportReconciliation | null;
    /** Cobertura de reglas de lo que se creó (resumen final). */
    readonly rulesSummary?: ImportRulesSummary | null;
  }): ImportStatus {
    if (this.current.status !== 'PERSISTING') throw transition(this.current.status, 'COMPLETED');
    const reconciliation = input.reconciliation ?? this.current.reconciliation;
    const status: ImportStatus =
      input.failed > 0
        ? 'PARTIALLY_FAILED'
        : reconciliation?.outcome === 'DIFFERENCE'
          ? 'COMPLETED_WITH_DIFFERENCE'
          : 'COMPLETED';
    const code: ImportJobTransition =
      status === 'PARTIALLY_FAILED'
        ? 'PARTIAL_FAILURE'
        : status === 'COMPLETED_WITH_DIFFERENCE'
          ? 'COMPLETE_WITH_DIFFERENCE'
          : 'COMPLETE';
    const completed = status !== 'PARTIALLY_FAILED';
    this.move(
      code,
      status,
      {
        counters: { ...this.current.counters, failed: input.failed },
        errors: input.failed === 0 ? [] : input.errors,
        completedAt: completed ? input.now : null,
        reconciliation: reconciliation ?? null,
        rulesSummary: input.rulesSummary ?? this.current.rulesSummary,
        progress: { ...this.current.progress, batchesDone: this.current.progress.batchCount },
      },
      input.now,
    );
    return status;
  }

  /** Reintento de las filas fallidas: `PARTIALLY_FAILED → PERSISTING` con un intento más. */
  retry(now: string): void {
    if (this.current.status !== 'PARTIALLY_FAILED') throw transition(this.current.status, 'PERSISTING');
    this.move(
      'RETRY',
      'PERSISTING',
      {
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
    this.move('ACCEPT_ERRORS', 'COMPLETED_WITH_ERRORS', { completedAt: now }, now);
  }

  // ───────────────────────────────────────────────────────────── deshacer

  /** `COMPLETED* | PARTIALLY_ROLLED_BACK → REVERTING` (la decisión sobre bloqueadas la toma el caso de uso). */
  requestRevert(input: {
    readonly userId: string;
    readonly allowPartial: boolean;
    readonly requested: number;
    readonly blocked: number;
    readonly now: string;
  }): void {
    this.move(
      'REVERT',
      'REVERTING',
      {
        revert: {
          allowPartial: input.allowPartial,
          requested: input.requested,
          voided: 0,
          alreadyVoided: 0,
          blocked: input.blocked,
          requestedBy: input.userId,
        },
      },
      input.now,
    );
  }

  /** Avance del deshacer (por lote): suma las anuladas y las ya anuladas (anotación). */
  recordRevertBatch(input: { voided: number; alreadyVoided: number; now: string }): void {
    const revert = this.current.revert;
    if (this.current.status !== 'REVERTING' || !revert) throw transition(this.current.status, 'REVERTING');
    this.update(
      {
        revert: {
          ...revert,
          voided: revert.voided + input.voided,
          alreadyVoided: revert.alreadyVoided + input.alreadyVoided,
        },
      },
      input.now,
    );
  }

  /** `REVERTING → ROLLED_BACK` (sin bloqueadas) o `PARTIALLY_ROLLED_BACK`. */
  finishRevert(input: { readonly blocked: number; readonly now: string }): ImportStatus {
    const revert = this.current.revert;
    if (this.current.status !== 'REVERTING' || !revert) throw transition(this.current.status, 'ROLLED_BACK');
    const status: ImportStatus = input.blocked === 0 ? 'ROLLED_BACK' : 'PARTIALLY_ROLLED_BACK';
    this.move(
      'FINISH_REVERT',
      status,
      {
        revert: { ...revert, blocked: input.blocked },
        revertedAt: input.now,
        revertedBy: revert.requestedBy,
      },
      input.now,
    );
    return status;
  }
}
