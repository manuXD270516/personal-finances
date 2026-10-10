/**
 * Lógica pura del asistente "Importar CSV" (openspec add-basic-csv-import 6.1; docs/28 §4.7): validación y armado del
 * mapeo de columnas, reglas de habilitación de acciones, presentación de clasificaciones y consultas. Sin React ni zona
 * horaria del proceso. Los montos son strings decimales (INV-001); los textos del archivo son datos no confiables.
 */
import type { ApiProblemBody } from '../../bff/finance-api-client';
import type { StatusPresentation } from '../recurring/logic';
import {
  DATE_FORMATS,
  type DecimalSeparator,
  type ImportCreated,
  type ImportDateFormat,
  type ImportJob,
  type ImportJobStatus,
  type ImportMapping,
  type ImportPreviewCandidate,
  type ImportPreviewRow,
  type ImportPreviewSummary,
  type ImportRowClassification,
  type ImportRowDecision,
  type ImportRowDecisionResult,
  type SignConvention,
} from './types';

/** Tope del archivo (`IMPORT_CSV_MAX_BYTES`, 2 MiB): cortesía del cliente; el servidor manda (413). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_EXTENSIONS: readonly string[] = ['.csv', '.txt', '.tsv'];
export const POLL_MS = 2000;
export const PREVIEW_LIMIT = 50;
export const LIST_LIMIT = 50;
export const MAX_SKIP_ROWS = 50;
/** Máximo de columnas que acepta el servidor (50); los índices del contrato llegan a 199. */
export const MAX_COLUMNS = 50;

// ───────────────────────────── archivo ─────────────────────────────

export type FileCheck = 'ok' | 'none' | 'empty' | 'tooLarge' | 'extension';

/** Valida nombre y tamaño antes de subir (cortesía; el servidor revisa el contenido real). */
export function checkFile(
  file: { readonly name: string; readonly size: number } | null | undefined,
): FileCheck {
  if (!file) return 'none';
  if (file.size === 0) return 'empty';
  if (file.size > MAX_FILE_BYTES) return 'tooLarge';
  const lower = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'extension';
  return 'ok';
}

/** Tamaño legible (KiB/MiB) sin pasar por decimales binarios raros. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

// ───────────────────────────── pasos y estados ─────────────────────────────

export type WizardStep = 1 | 2 | 3 | 4;
export const WIZARD_STEPS: readonly WizardStep[] = [1, 2, 3, 4];

/** Paso del asistente que corresponde a un estado (sin job ⇒ paso 1, subir el archivo). */
export function stepOf(status: ImportJobStatus | undefined): WizardStep {
  switch (status) {
    case undefined:
      return 1;
    case 'AWAITING_MAPPING':
      return 2;
    case 'AWAITING_REVIEW':
      return 3;
    default:
      return 4;
  }
}

/** La persistencia corre en segundo plano: la pantalla consulta el estado cada `POLL_MS`. */
export const isPolling = (status: ImportJobStatus | undefined): boolean =>
  status === 'APPROVED' || status === 'PERSISTING';

export const isFinal = (status: ImportJobStatus): boolean =>
  status === 'COMPLETED' ||
  status === 'COMPLETED_WITH_ERRORS' ||
  status === 'CANCELLED' ||
  status === 'PARTIALLY_FAILED';

/** Se puede cancelar mientras no esté aprobada. */
export const isCancellable = (status: ImportJobStatus): boolean =>
  status === 'AWAITING_MAPPING' || status === 'AWAITING_REVIEW';

/** Se puede retomar desde la lista (todavía requiere acción del usuario). */
export const isResumable = (status: ImportJobStatus): boolean =>
  status === 'AWAITING_MAPPING' || status === 'AWAITING_REVIEW' || status === 'PARTIALLY_FAILED';

/** Enteros de progreso `n / m` y porcentaje acotado (solo presentación; no son importes). */
export function progressPercent(done: number, batchCount: number): number {
  if (batchCount <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((done * 100) / batchCount)));
}

// ───────────────────────────── mapeo ─────────────────────────────

export type AmountMode = 'SIGNED' | 'DEBIT_CREDIT';

/**
 * Estado del formulario del mapeo. Los índices viajan como string (valor del `<select>`; vacío = sin elegir). El
 * formato de fecha, el separador decimal y la convención de signo son EXPLÍCITOS: nunca se adivinan por fila.
 */
export interface MappingForm {
  readonly hasHeader: boolean;
  readonly skipRows: string;
  readonly dateIndex: string;
  readonly descriptionIndex: string;
  readonly amountMode: AmountMode;
  readonly amountIndex: string;
  readonly signConvention: '' | SignConvention;
  readonly debitIndex: string;
  readonly creditIndex: string;
  readonly dateFormat: '' | ImportDateFormat;
  readonly decimalSeparator: '' | DecimalSeparator;
}

export const EMPTY_MAPPING_FORM: MappingForm = {
  hasHeader: true,
  skipRows: '0',
  dateIndex: '',
  descriptionIndex: '',
  amountMode: 'SIGNED',
  amountIndex: '',
  signConvention: '',
  debitIndex: '',
  creditIndex: '',
  dateFormat: '',
  decimalSeparator: '',
};

/** Precarga del formulario desde un mapeo (el sugerido por la API o el ya aplicado al reabrir el paso). */
export function mappingFormOf(mapping: ImportMapping | null | undefined): MappingForm {
  if (!mapping) return EMPTY_MAPPING_FORM;
  const a = mapping.columns.amount;
  return {
    hasHeader: mapping.hasHeader,
    skipRows: String(mapping.skipRows ?? 0),
    dateIndex: String(mapping.columns.date.index),
    descriptionIndex: String(mapping.columns.description.index),
    amountMode: a.mode,
    amountIndex: a.mode === 'SIGNED' ? String(a.index) : '',
    signConvention: a.mode === 'SIGNED' ? a.signConvention : '',
    debitIndex: a.mode === 'DEBIT_CREDIT' ? String(a.debitIndex) : '',
    creditIndex: a.mode === 'DEBIT_CREDIT' ? String(a.creditIndex) : '',
    dateFormat: mapping.dateFormat,
    decimalSeparator: mapping.decimalSeparator,
  };
}

export type MappingField =
  | 'skipRows'
  | 'dateIndex'
  | 'descriptionIndex'
  | 'amountIndex'
  | 'signConvention'
  | 'debitIndex'
  | 'creditIndex'
  | 'dateFormat'
  | 'decimalSeparator';

export type MappingErrorCode = 'required' | 'range' | 'duplicate' | 'skipRows';
export type MappingErrors = Partial<Record<MappingField, MappingErrorCode>>;

export type MappingResult =
  | { readonly ok: true; readonly mapping: ImportMapping }
  | { readonly ok: false; readonly errors: MappingErrors };

const parseIndex = (raw: string, columnCount: number): number | 'required' | 'range' => {
  if (raw.trim() === '') return 'required';
  if (!/^\d+$/.test(raw)) return 'range';
  const n = Number(raw);
  return n < columnCount ? n : 'range';
};

/**
 * Valida el formulario contra el número de columnas del archivo y arma el `ImportMapping` del contrato (índices base 0).
 * Fecha, descripción y monto deben ser columnas distintas; débito y crédito también.
 */
export function buildMapping(form: MappingForm, columnCount: number): MappingResult {
  const errors: { -readonly [K in MappingField]?: MappingErrorCode } = {};
  const limit = Math.min(columnCount, MAX_COLUMNS);

  const skip = form.skipRows.trim() === '' ? 0 : /^\d+$/.test(form.skipRows) ? Number(form.skipRows) : -1;
  if (skip < 0 || skip > MAX_SKIP_ROWS) errors.skipRows = 'skipRows';

  const date = parseIndex(form.dateIndex, limit);
  const description = parseIndex(form.descriptionIndex, limit);
  if (typeof date === 'string') errors.dateIndex = date;
  if (typeof description === 'string') errors.descriptionIndex = description;

  let amount: ImportMapping['columns']['amount'] | undefined;
  const used: { field: MappingField; index: number }[] = [];
  if (typeof date === 'number') used.push({ field: 'dateIndex', index: date });
  if (typeof description === 'number') used.push({ field: 'descriptionIndex', index: description });

  if (form.amountMode === 'SIGNED') {
    const index = parseIndex(form.amountIndex, limit);
    if (typeof index === 'string') errors.amountIndex = index;
    else used.push({ field: 'amountIndex', index });
    if (form.signConvention === '') errors.signConvention = 'required';
    if (typeof index === 'number' && form.signConvention !== '')
      amount = { mode: 'SIGNED', index, signConvention: form.signConvention };
  } else {
    const debit = parseIndex(form.debitIndex, limit);
    const credit = parseIndex(form.creditIndex, limit);
    if (typeof debit === 'string') errors.debitIndex = debit;
    else used.push({ field: 'debitIndex', index: debit });
    if (typeof credit === 'string') errors.creditIndex = credit;
    else used.push({ field: 'creditIndex', index: credit });
    if (typeof debit === 'number' && typeof credit === 'number')
      amount = { mode: 'DEBIT_CREDIT', debitIndex: debit, creditIndex: credit };
  }

  // Una columna no puede cumplir dos papeles: se marca el segundo campo que la repite.
  const seen = new Map<number, MappingField>();
  for (const u of used) {
    if (seen.has(u.index) && !errors[u.field]) errors[u.field] = 'duplicate';
    else seen.set(u.index, u.field);
  }

  if (form.dateFormat === '') errors.dateFormat = 'required';
  if (form.decimalSeparator === '') errors.decimalSeparator = 'required';

  if (Object.keys(errors).length > 0 || amount === undefined) return { ok: false, errors };
  return {
    ok: true,
    mapping: {
      hasHeader: form.hasHeader,
      skipRows: skip,
      columns: {
        date: { index: date as number },
        description: { index: description as number },
        amount,
      },
      dateFormat: form.dateFormat as ImportDateFormat,
      decimalSeparator: form.decimalSeparator as DecimalSeparator,
    },
  };
}

/** Primer campo con error en el orden visual del formulario (para llevar el foco). */
export const MAPPING_FIELD_ORDER: readonly MappingField[] = [
  'skipRows',
  'dateIndex',
  'descriptionIndex',
  'amountIndex',
  'signConvention',
  'debitIndex',
  'creditIndex',
  'dateFormat',
  'decimalSeparator',
];
export const firstMappingError = (errors: MappingErrors): MappingField | undefined =>
  MAPPING_FIELD_ORDER.find((f) => errors[f] !== undefined);

/** Recorta un texto del archivo para una opción de lista (el contenido completo sigue en la tabla de muestra). */
export function truncate(text: string, max = 40): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * Nombre de cada columna: el encabezado solo cuando el primer registro ES el encabezado (con encabezado y sin filas
 * previas que saltar); si no, cada columna queda sin nombre y se identifica por su número.
 */
export function columnNames(
  header: readonly string[],
  hasHeader: boolean,
  skipRows: string,
): readonly (string | undefined)[] {
  const skip = /^\d+$/.test(skipRows) ? Number(skipRows) : 0;
  return header.map((name) => (hasHeader && skip === 0 && name.trim() !== '' ? name : undefined));
}

/** Registros que se muestran en la muestra: el primero del archivo y hasta 20 más (`sampleRows`). */
export function sampleRecords(
  header: readonly string[],
  sampleRows: readonly (readonly string[])[] | undefined,
): readonly (readonly string[])[] {
  return [header, ...(sampleRows ?? [])];
}

/** Mapeo con el que se abre el paso: el sugerido por la API si viene, si no el ya aplicado, si no vacío. */
export function initialMappingOf(created: Pick<ImportCreated, 'suggestedMapping' | 'mapping'>): MappingForm {
  return mappingFormOf(created.suggestedMapping ?? created.mapping);
}

export const DATE_FORMAT_OPTIONS: readonly ImportDateFormat[] = DATE_FORMATS;

// ───────────────────────────── vista previa y decisiones ─────────────────────────────

export type ClassificationFilter = '' | ImportRowClassification;

export const CLASSIFICATION_PRESENTATION: Readonly<Record<ImportRowClassification, StatusPresentation>> = {
  NEW: { icon: '✓', tone: 'ok' },
  DUPLICATE_EXACT: { icon: '⧉', tone: 'neutral' },
  DUPLICATE_PROBABLE: { icon: '⚠', tone: 'warn' },
  INVALID: { icon: '✕', tone: 'danger' },
};

/** Decisiones que admite una fila: nueva ⇒ crear/excluir; posible duplicado ⇒ crear/omitir/excluir; el resto no admite. */
export function allowedDecisions(
  row: Pick<ImportPreviewRow, 'classification'>,
): readonly ImportRowDecision[] {
  switch (row.classification) {
    case 'NEW':
      return ['CREATE', 'EXCLUDE'];
    case 'DUPLICATE_PROBABLE':
      return ['CREATE', 'SKIP', 'EXCLUDE'];
    default:
      return [];
  }
}

/** ¿Se muestran los botones de decisión de la fila? (EDITOR/OWNER, en revisión, fila que admite decisión). */
export const canDecide = (
  row: Pick<ImportPreviewRow, 'classification'>,
  canEdit: boolean,
  status: ImportJobStatus,
): boolean => canEdit && status === 'AWAITING_REVIEW' && allowedDecisions(row).length > 0;

/** Posible duplicado que espera una decisión (bloquea la aprobación). */
export const needsDecision = (row: Pick<ImportPreviewRow, 'classification' | 'decision'>): boolean =>
  row.classification === 'DUPLICATE_PROBABLE' && row.decision === null;

/** El candidato es una pata de transferencia o conversión: posible pago de tarjeta o transferencia propia. */
export const isTransferCandidate = (candidate: ImportPreviewCandidate | null): boolean =>
  candidate !== null && (candidate.kind === 'TRANSFER' || candidate.kind === 'CONVERSION');

export const hasTransferCandidates = (rows: readonly Pick<ImportPreviewRow, 'candidate'>[]): boolean =>
  rows.some((r) => isTransferCandidate(r.candidate));

const CANDIDATE_KINDS: ReadonlySet<string> = new Set([
  'EXPENSE',
  'INCOME',
  'TRANSFER',
  'CONVERSION',
  'REFUND',
  'ADJUSTMENT',
]);
/** Clave i18n del tipo del candidato (`candidate.kind.EXPENSE`…); `UNKNOWN` si no viene o no se reconoce. */
export const candidateKindKey = (kind: string | null): string =>
  `candidate.kind.${kind !== null && CANDIDATE_KINDS.has(kind) ? kind : 'UNKNOWN'}`;

/** Códigos de problema de fila/advertencia con texto propio (`issues.<code>`). */
export const ROW_ISSUE_CODES: readonly string[] = [
  'IMPORT_INVALID_DATE',
  'IMPORT_INVALID_AMOUNT',
  'IMPORT_FUTURE_DATE',
  'PERIOD_CLOSED',
  'ACCOUNT_CLOSED',
  'IMPORT_DESCRIPTION_TRUNCATED',
];
export const issueKey = (code: string): string =>
  `issues.${ROW_ISSUE_CODES.includes(code) ? code : 'UNKNOWN'}`;

/** Aplica el resultado de una decisión a la fila correspondiente (la respuesta trae la fila completa). */
export function applyDecision(
  rows: readonly ImportPreviewRow[],
  result: ImportRowDecisionResult,
): readonly ImportPreviewRow[] {
  return rows.map((r) => {
    if (r.id !== result.id) return r;
    const { version: _version, counters: _counters, ...row } = result;
    return row;
  });
}

/** ¿Se puede aprobar? Solo en revisión, con rol de escritura, sin decisiones pendientes y con algo que importar. */
export function canApprove(input: {
  readonly canEdit: boolean;
  readonly status: ImportJobStatus;
  readonly summary: ImportPreviewSummary | undefined;
  readonly busy: boolean;
}): boolean {
  const { canEdit, status, summary, busy } = input;
  if (!canEdit || busy || status !== 'AWAITING_REVIEW' || !summary) return false;
  if (summary.counts.pendingDecisions > 0) return false;
  return summary.counts.toCreate + summary.counts.skipped > 0;
}

/** `pendingDecisions` de un 409 `IMPORT_REVIEW_INCOMPLETE` (extensión del problem; también bajo `details`). */
export function pendingDecisionsOf(problem: ApiProblemBody): number | undefined {
  const direct = problem['pendingDecisions'];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const details = problem['details'];
  if (details && typeof details === 'object') {
    const nested = (details as Record<string, unknown>)['pendingDecisions'];
    if (typeof nested === 'number' && Number.isFinite(nested)) return nested;
  }
  return undefined;
}

// ───────────────────────────── resultado ─────────────────────────────

export interface ResultSummary {
  readonly rows: number;
  readonly created: number;
  readonly skipped: number;
  readonly alreadyImported: number;
  readonly invalid: number;
  readonly failed: number;
}

export function resultSummaryOf(job: Pick<ImportJob, 'counters'>): ResultSummary {
  const c = job.counters;
  return {
    rows: c.rows,
    created: c.created,
    skipped: c.skipped,
    alreadyImported: c.alreadyImported,
    invalid: c.invalid,
    failed: c.failed,
  };
}

/** Primeras líneas afectadas de un grupo de errores y cuántas más hay (la API entrega hasta 100). */
export function errorLines(
  group: { readonly count: number; readonly lines: readonly number[] },
  max = 10,
): { readonly shown: readonly number[]; readonly more: number } {
  const shown = group.lines.slice(0, max);
  return { shown, more: Math.max(0, group.count - shown.length) };
}

/** Acciones del resultado parcial (reintentar o aceptar) solo para quien escribe y con el import en ese estado. */
export const canResolveFailures = (canEdit: boolean, status: ImportJobStatus): boolean =>
  canEdit && status === 'PARTIALLY_FAILED';

/** La advertencia de archivo ya importado (no bloquea). */
export const fileAlreadyImported = (
  job: Pick<ImportJob, 'warnings'>,
): ImportJob['warnings'][number] | undefined =>
  job.warnings.find((w) => w.code === 'IMPORT_FILE_ALREADY_IMPORTED');

// ───────────────────────────── rutas de la API ─────────────────────────────

export const importsPath = (base: string): string => `${base}/imports`;
export const importPath = (base: string, importId: string): string => `${base}/imports/${importId}`;
export const listImportsPath = (base: string, accountId?: string): string =>
  `${importsPath(base)}?${accountId ? `accountId=${encodeURIComponent(accountId)}&` : ''}limit=${LIST_LIMIT}`;
export const lastImportPath = (base: string, accountId: string): string =>
  `${importsPath(base)}?accountId=${encodeURIComponent(accountId)}&limit=1`;

export function previewPath(
  base: string,
  importId: string,
  opts: { classification?: ClassificationFilter; cursor?: string | null; limit?: number } = {},
): string {
  const q = new URLSearchParams();
  if (opts.classification) q.set('classification', opts.classification);
  if (opts.cursor) q.set('cursor', opts.cursor);
  q.set('limit', String(opts.limit ?? PREVIEW_LIMIT));
  return `${importPath(base, importId)}/preview?${q.toString()}`;
}

/** Solo el resumen (una fila): se recarga tras cada decisión sin perder las páginas ya cargadas. */
export const summaryPath = (base: string, importId: string): string =>
  previewPath(base, importId, { limit: 1 });

// ───────────────────────────── presentación ─────────────────────────────

/** Estado del import con texto + icono (NFR-USAB-104): el icono es decorativo y el color solo refuerza. */
export const JOB_PRESENTATION: Readonly<Record<ImportJobStatus, StatusPresentation>> = {
  AWAITING_MAPPING: { icon: '◔', tone: 'neutral' },
  AWAITING_REVIEW: { icon: '⚠', tone: 'warn' },
  APPROVED: { icon: '⟳', tone: 'neutral' },
  PERSISTING: { icon: '⟳', tone: 'neutral' },
  COMPLETED: { icon: '✓', tone: 'ok' },
  PARTIALLY_FAILED: { icon: '⚠', tone: 'warn' },
  COMPLETED_WITH_ERRORS: { icon: '⚠', tone: 'warn' },
  CANCELLED: { icon: '✕', tone: 'neutral' },
};

/** Ejemplo de cada formato de fecha (31 de diciembre de 2026) para que la elección sea inequívoca. */
export const DATE_FORMAT_EXAMPLE: Readonly<Record<ImportDateFormat, string>> = {
  'dd/MM/yyyy': '31/12/2026',
  'dd-MM-yyyy': '31-12-2026',
  'dd/MM/yy': '31/12/26',
  'yyyy-MM-dd': '2026-12-31',
  'MM/dd/yyyy': '12/31/2026',
};

export type ColumnRole = 'date' | 'description' | 'amount' | 'debit' | 'credit';

/** Papel que cumple una columna con el formulario actual (para rotularla en la tabla de muestra). */
export function roleOfColumn(form: MappingForm, index: number): ColumnRole | undefined {
  const is = (raw: string) => raw !== '' && /^\d+$/.test(raw) && Number(raw) === index;
  if (is(form.dateIndex)) return 'date';
  if (is(form.descriptionIndex)) return 'description';
  if (form.amountMode === 'SIGNED') return is(form.amountIndex) ? 'amount' : undefined;
  if (is(form.debitIndex)) return 'debit';
  if (is(form.creditIndex)) return 'credit';
  return undefined;
}
