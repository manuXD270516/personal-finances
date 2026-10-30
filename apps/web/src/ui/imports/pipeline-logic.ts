/**
 * Lógica pura del pipeline de importación desde documentos (openspec add-import-pipeline, tareas 7.1–7.4; docs/28 §4.7):
 * progreso por etapa, filtros de la revisión, origen por campo (propuesta de la clasificación + ediciones del usuario),
 * armado de los cuerpos de edición y de conversión, coincidencias con compromisos, saldo del extracto, deshacer y
 * perfiles. Sin React. Los montos son strings decimales (INV-001) y los textos del archivo, datos no confiables.
 */
import { type ApiProblemBody } from '../../bff/finance-api-client';
import {
  IMPORT_STAGES,
  type DuplicateConfidence,
  type FieldOrigin,
  type ImportDuplicateCandidate,
  type ImportFormat,
  type ImportJob,
  type ImportPreviewRow,
  type ImportProfile,
  type ImportProposedField,
  type ImportRevertPreview,
  type ImportRowClassification,
  type ImportStage,
} from './types';

/** Extensiones que ofrece el selector de archivo: el formato real lo fija el CONTENIDO (DOCUMENTS), no el nombre. */
export const DOCUMENT_ACCEPT = '.csv,.txt,.tsv,.ofx,.qfx,.qif,.json,.xlsx';
export const IMPORT_FORMATS: readonly ImportFormat[] = ['CSV', 'OFX', 'QIF', 'JSON', 'XLSX'];

/** ¿La importación viene de un documento (se procesa en el worker)? */
export const isDocumentJob = (job: Pick<ImportJob, 'documentId'>): boolean =>
  job.documentId !== undefined && job.documentId !== null;

// ───────────────────────────── procesamiento por etapas ─────────────────────────────

export interface StageProgress {
  readonly stage: ImportStage | null;
  /** Posición de la etapa (1..6) o 0 si aún no empezó. */
  readonly position: number;
  readonly processed: number;
  readonly fileRows: number;
  /** Porcentaje de la etapa actual, 0..100 (solo presentación). */
  readonly percent: number;
}

export function stageProgressOf(job: Pick<ImportJob, 'stage' | 'progress'>): StageProgress {
  const stage = job.stage ?? job.progress.stage ?? null;
  const processed = job.progress.processedRows ?? 0;
  const fileRows = job.progress.totalRows ?? 0;
  const percent = fileRows <= 0 ? 0 : Math.max(0, Math.min(100, Math.floor((processed * 100) / fileRows)));
  return {
    stage,
    position: stage ? IMPORT_STAGES.indexOf(stage) + 1 : 0,
    processed,
    fileRows,
    percent,
  };
}

/** Estados en los que el job espera al worker (se consulta cada `POLL_MS`). */
export const isProcessing = (status: ImportJob['status']): boolean =>
  status === 'UPLOADED' || status === 'PROCESSING';

// ───────────────────────────── filtros de la revisión ─────────────────────────────

export interface ReviewFilter {
  readonly classification: '' | ImportRowClassification;
  readonly needsCategory: boolean;
  readonly ruleId: string;
  readonly confidence: '' | DuplicateConfidence;
}

export const EMPTY_FILTER: ReviewFilter = {
  classification: '',
  needsCategory: false,
  ruleId: '',
  confidence: '',
};

export const filterIsEmpty = (f: ReviewFilter): boolean =>
  f.classification === '' && !f.needsCategory && f.ruleId === '' && f.confidence === '';

/** Parámetros del `GET .../preview` para un filtro (los vacíos no se envían). */
export function filterQuery(f: ReviewFilter): {
  classification?: ImportRowClassification;
  needsCategory?: boolean;
  ruleId?: string;
  candidateConfidence?: DuplicateConfidence;
} {
  return {
    ...(f.classification ? { classification: f.classification } : {}),
    ...(f.needsCategory ? { needsCategory: true } : {}),
    ...(f.ruleId ? { ruleId: f.ruleId } : {}),
    ...(f.confidence ? { candidateConfidence: f.confidence } : {}),
  };
}

/** Cuerpo del filtro de `bulkEditImportRows` (mismos criterios que la vista previa; sin confianza, que no admite). */
export function bulkFilterBody(f: ReviewFilter): {
  classification?: ImportRowClassification;
  needsCategory?: boolean;
  ruleId?: string;
} {
  return {
    ...(f.classification ? { classification: f.classification } : {}),
    ...(f.needsCategory ? { needsCategory: true } : {}),
    ...(f.ruleId ? { ruleId: f.ruleId } : {}),
  };
}

/** El filtro de confianza no existe en la edición en lote: avisar en vez de aplicarla a más filas de las que se ven. */
export const bulkSupportsFilter = (f: ReviewFilter): boolean => f.confidence === '';

/** Reglas que aparecen en las filas cargadas (opciones del filtro «por regla»), sin repetir. */
export function ruleOptionsOf(
  rows: readonly ImportPreviewRow[],
): readonly { readonly ruleId: string; readonly version: number | null }[] {
  const seen = new Map<string, number | null>();
  for (const row of rows) {
    const p = row.proposal;
    if (!p) continue;
    for (const field of [p.categoryId, p.counterpartyId, p.tagIds, p.description]) {
      if (field?.origin === 'RULE' && field.ruleId && !seen.has(field.ruleId))
        seen.set(field.ruleId, field.ruleVersion ?? null);
    }
  }
  return [...seen].map(([ruleId, version]) => ({ ruleId, version }));
}

// ───────────────────────────── origen por campo ─────────────────────────────

export type EditableField = 'categoryId' | 'counterpartyId' | 'tagIds' | 'description';

export interface FieldValue {
  readonly value: string | readonly string[] | null;
  readonly origin: FieldOrigin | null;
  readonly ruleId: string | null;
  readonly ruleVersion: number | null;
}

/** Lo efectivo de un campo: la edición del usuario (origen manual) sobre la propuesta (alias, regla, defecto). */
export function effectiveField(row: ImportPreviewRow, field: EditableField): FieldValue | null {
  const edits = row.edits;
  if (edits && Object.prototype.hasOwnProperty.call(edits, field) && edits[field] !== undefined) {
    return { value: edits[field] ?? null, origin: 'MANUAL', ruleId: null, ruleVersion: null };
  }
  const proposed: ImportProposedField | undefined = row.proposal?.[field];
  if (!proposed) return null;
  return {
    value: proposed.value,
    origin: proposed.origin,
    ruleId: proposed.ruleId ?? null,
    ruleVersion: proposed.ruleVersion ?? null,
  };
}

/** Clave i18n del origen (`origin.RULE`…). */
export const originKey = (origin: FieldOrigin | null): string => `origin.${origin ?? 'NONE'}`;

/** La fila no tiene categoría efectiva (ni propuesta ni edición): el filtro «sin categoría». */
export function rowNeedsCategory(row: ImportPreviewRow): boolean {
  const field = effectiveField(row, 'categoryId');
  if (field === null) return row.proposal?.needsCategory ?? true;
  return field.value === null || field.value === '';
}

/** Tipo efectivo de la fila: el marcado por el usuario, el del servidor o el que dicta la dirección. */
export function rowKindOf(row: ImportPreviewRow): 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'CONVERSION' {
  if (row.kind) return row.kind;
  if (row.transfer) return 'TRANSFER';
  if (row.conversion) return 'CONVERSION';
  return row.direction === 'IN' ? 'INCOME' : 'EXPENSE';
}

// ───────────────────────────── candidatos de duplicado ─────────────────────────────

export const CONFIDENCE_PRESENTATION: Readonly<
  Record<DuplicateConfidence, { readonly icon: string; readonly tone: 'ok' | 'warn' | 'neutral' }>
> = {
  HIGH: { icon: '●', tone: 'ok' },
  MEDIUM: { icon: '◐', tone: 'warn' },
  LOW: { icon: '○', tone: 'neutral' },
};

export const SIGNAL_KEYS = ['amount', 'date', 'description', 'counterparty', 'origin'] as const;

/** Candidatos de la fila: la lista completa o, si el servidor solo manda el primero, ese. */
export function candidatesOf(row: ImportPreviewRow): readonly ImportDuplicateCandidate[] {
  return row.candidates ?? [];
}

/** El candidato al que la fila quedó vinculada (la decisión `SKIP` apunta a uno): el preseleccionado o el primero. */
export function linkedCandidate(row: ImportPreviewRow): ImportDuplicateCandidate | undefined {
  const list = candidatesOf(row);
  return list.find((c) => c.preselected) ?? list[0];
}

/** Aviso «confianza baja»: todos los candidatos bajo el umbral de baja (decisión D325: igual exigen decisión). */
export const isLowConfidence = (row: ImportPreviewRow): boolean => {
  const list = candidatesOf(row);
  return list.length > 0 && list.every((c) => c.confidence === 'LOW');
};

/** La vinculación vigente es la que preseleccionó el sistema (nadie la decidió todavía). */
export const isPreselectedLink = (row: ImportPreviewRow): boolean =>
  row.decision === 'SKIP' && row.decidedBy === null && candidatesOf(row).some((c) => c.preselected);

// ───────────────────────────── coincidencias con compromisos ─────────────────────────────

export const MATCH_PRESENTATION = CONFIDENCE_PRESENTATION;

/** Filas con una única candidata de confianza alta y sin vínculo: lo que confirma «confirmar las de confianza alta». */
export function highConfidenceUniqueCount(rows: readonly ImportPreviewRow[]): number {
  return rows.filter((r) => {
    const list = r.occurrenceCandidates ?? [];
    return list.length === 1 && list[0]?.confidence === 'HIGH' && !r.occurrenceLink;
  }).length;
}

export const hasOccurrenceCandidates = (rows: readonly ImportPreviewRow[]): boolean =>
  rows.some((r) => (r.occurrenceCandidates?.length ?? 0) > 0);

// ───────────────────────────── cuerpos de edición ─────────────────────────────

export interface ConversionForm {
  readonly counterAccountId: string;
  readonly counterAmount: string;
  readonly fee: string;
  readonly quotedRate: string;
}

export const EMPTY_CONVERSION_FORM: ConversionForm = {
  counterAccountId: '',
  counterAmount: '',
  fee: '',
  quotedRate: '',
};

export type ConversionError = 'account' | 'amount' | 'fee' | 'rate' | 'currency';
export type ConversionResult =
  | {
      readonly ok: true;
      readonly body: {
        counterAccountId: string;
        counterAmount: { amount: string; currency: string };
        fee?: { amount: string; currency: string };
        quotedRate?: string;
      };
    }
  | { readonly ok: false; readonly errors: Partial<Record<ConversionError, true>> };

const POSITIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const isPositive = (v: string): boolean => POSITIVE_DECIMAL.test(v) && /[1-9]/.test(v);

/**
 * Valida el formulario de conversión y arma `ImportRowConversion`. El monto de la otra cuenta va en SU moneda
 * (`counterCurrency`) y con los decimales que escribió el usuario (el servidor valida la escala: INV-003); la comisión
 * va en la moneda de la fila. Montos como string decimal, nunca `number`.
 */
export function buildConversion(
  form: ConversionForm,
  input: { readonly counterCurrency: string | undefined; readonly rowCurrency: string },
): ConversionResult {
  const errors: Partial<Record<ConversionError, true>> = {};
  if (form.counterAccountId === '') errors.account = true;
  if (!input.counterCurrency) errors.currency = true;
  const counter = form.counterAmount.trim();
  if (!isPositive(counter)) errors.amount = true;
  const fee = form.fee.trim();
  if (fee !== '' && !isPositive(fee)) errors.fee = true;
  const rate = form.quotedRate.trim();
  if (rate !== '' && !isPositive(rate)) errors.rate = true;
  if (Object.keys(errors).length > 0 || !input.counterCurrency) return { ok: false, errors };
  return {
    ok: true,
    body: {
      counterAccountId: form.counterAccountId,
      counterAmount: { amount: counter, currency: input.counterCurrency },
      ...(fee !== '' ? { fee: { amount: fee, currency: input.rowCurrency } } : {}),
      ...(rate !== '' ? { quotedRate: rate } : {}),
    },
  };
}

/** Códigos de error de edición de fila con texto propio en la pantalla (el resto cae en el catálogo de errores). */
export const ROW_EDIT_ERRORS: readonly string[] = [
  'TRANSFER_CURRENCY_MISMATCH',
  'TRANSFER_SAME_ACCOUNT',
  'CONCURRENCY_CONFLICT',
];
export const isRowEditError = (p: ApiProblemBody): boolean => ROW_EDIT_ERRORS.includes(p.code ?? '');

// ───────────────────────────── tasa efectiva (vista) ─────────────────────────────

/**
 * Vista previa de la tasa efectiva de una conversión: cociente exacto entre los dos montos, calculado con enteros
 * (BigInt) sobre sus textos decimales y mostrado con 6 decimales truncados. Es solo ayuda visual: la tasa de verdad la
 * calcula el servidor. `null` si algún monto no es un decimal positivo.
 */
export function effectiveRatePreview(a: string, b: string): string | null {
  if (!isPositive(a.trim()) || !isPositive(b.trim())) return null;
  const parse = (v: string): { n: bigint; scale: number } => {
    const [i = '0', d = ''] = v.trim().split('.');
    return { n: BigInt(i + d), scale: d.length };
  };
  const x = parse(a);
  const y = parse(b);
  // Mayor sobre menor: la divisa «base» es la del monto menor (100.00 USD ↔ 696.00 BOB ⇒ 6.96).
  const xv = x.n * 10n ** BigInt(Math.max(y.scale - x.scale, 0));
  const yv = y.n * 10n ** BigInt(Math.max(x.scale - y.scale, 0));
  const [big, small] = xv >= yv ? [xv, yv] : [yv, xv];
  const digits = 6n;
  const q = (big * 10n ** digits) / small;
  const text = q.toString().padStart(Number(digits) + 1, '0');
  const intPart = text.slice(0, -Number(digits));
  const frac = text.slice(-Number(digits)).replace(/0+$/, '');
  return frac === '' ? intPart : `${intPart}.${frac}`;
}

// ───────────────────────────── saldo del extracto ─────────────────────────────

/** ¿Hay saldo final del extracto? Entonces la vista previa muestra la diferencia contra el saldo resultante. */
export const hasClosingBalance = (job: Pick<ImportJob, 'statement'>): boolean =>
  job.statement?.closingBalance !== undefined && job.statement.closingBalance !== null;

/** La diferencia es cero (el saldo resultante coincide con el del extracto). */
export function differenceIsZero(amount: string): boolean {
  return /^-?0+(?:\.0+)?$/.test(amount);
}

// ───────────────────────────── resultado ─────────────────────────────

/** `0.7193` ⇒ `71.93` (texto; sin pasar por `number`). Para mostrar «cobertura por reglas». */
export function ratioPercent(ratio: string): string {
  const m = /^(\d+)(?:\.(\d{0,4}))?$/.exec(ratio);
  if (!m) return ratio;
  const frac = (m[2] ?? '').padEnd(4, '0');
  const units = BigInt(m[1] ?? '0') * 100n + BigInt(frac.slice(0, 2));
  return `${units.toString()}.${frac.slice(2, 4)}`;
}

export const isCompleted = (status: ImportJob['status']): boolean =>
  status === 'COMPLETED' || status === 'COMPLETED_WITH_DIFFERENCE' || status === 'COMPLETED_WITH_ERRORS';

/** Se puede pedir deshacer: terminada (o ya deshecha parcialmente) y con rol de escritura. */
export const canRevert = (status: ImportJob['status'], canEdit: boolean): boolean =>
  canEdit && (isCompleted(status) || status === 'PARTIALLY_ROLLED_BACK');

export const isReverted = (status: ImportJob['status']): boolean =>
  status === 'ROLLED_BACK' || status === 'PARTIALLY_ROLLED_BACK';

/** Ruta de la reconciliación prellenada con la oferta del import (fecha y saldo del extracto). */
export function reconciliationHref(
  href: (path: string) => string,
  offer: { accountId: string; statementDate: string; statementBalance: { amount: string } },
): string {
  const q = new URLSearchParams({
    fecha: offer.statementDate,
    saldo: offer.statementBalance.amount,
  });
  return href(`/cuentas/${offer.accountId}/reconciliar?${q.toString()}`);
}

/** Clave i18n del motivo de bloqueo del deshacer. */
export const blockedReasonKey = (reason: string): string =>
  `revert.reason.${reason === 'RECONCILED' || reason === 'PERIOD_CLOSED' ? reason : 'UNKNOWN'}`;

/** ¿El `409 IMPORT_REVERT_BLOCKED` trae la lista? (`details.blocked[]`). */
export function blockedOf(problem: ApiProblemBody): ImportRevertPreview['blocked'] {
  const details = problem['details'];
  if (details && typeof details === 'object') {
    const list = (details as Record<string, unknown>)['blocked'];
    if (Array.isArray(list)) return list as ImportRevertPreview['blocked'];
  }
  return [];
}

// ───────────────────────────── rutas de la API ─────────────────────────────

export const createFromDocumentBody = (input: {
  accountId: string;
  documentId: string;
  mappingProfileId?: string | undefined;
}): { accountId: string; documentId: string; mappingProfileId?: string } => ({
  accountId: input.accountId,
  documentId: input.documentId,
  ...(input.mappingProfileId ? { mappingProfileId: input.mappingProfileId } : {}),
});

export const bulkEditPath = (base: string, id: string): string => `${base}/imports/${id}/rows/bulk-edit`;
export const reevaluatePath = (base: string, id: string): string => `${base}/imports/${id}/reevaluate-rules`;
export const confirmMatchesPath = (base: string, id: string): string =>
  `${base}/imports/${id}/occurrence-matches/confirm`;
export const statementPath = (base: string, id: string): string => `${base}/imports/${id}/statement`;
export const revertPreviewPath = (base: string, id: string): string => `${base}/imports/${id}/revert-preview`;
export const revertPath = (base: string, id: string): string => `${base}/imports/${id}/revert`;
export const profilesPath = (base: string): string => `${base}/import-profiles`;
export const profilePath = (base: string, id: string): string => `${base}/import-profiles/${id}`;

export function listProfilesPath(
  base: string,
  opts: { institutionId?: string; accountId?: string; format?: ImportFormat; includeArchived?: boolean } = {},
): string {
  const q = new URLSearchParams();
  if (opts.institutionId) q.set('institutionId', opts.institutionId);
  if (opts.accountId) q.set('accountId', opts.accountId);
  if (opts.format) q.set('format', opts.format);
  if (opts.includeArchived) q.set('includeArchived', 'true');
  q.set('limit', '100');
  return `${profilesPath(base)}?${q.toString()}`;
}

/** Agrupa perfiles por institución (clave `''` = sin institución, solo de cuenta), conservando el orden recibido. */
export function groupProfilesByInstitution(
  profiles: readonly ImportProfile[],
): readonly { readonly institutionId: string; readonly profiles: readonly ImportProfile[] }[] {
  const groups = new Map<string, ImportProfile[]>();
  for (const p of profiles) {
    const key = p.institutionId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups].map(([institutionId, list]) => ({ institutionId, profiles: list }));
}

// ───────────────────────────── cuerpo de mapeo para QIF ─────────────────────────────

export type DateOrder = 'DMY' | 'MDY';

/** Opciones `imports.profile.v1` mínimas de un QIF: solo el orden día/mes (la categoría la propone la etapa de reglas). */
export const qifDateOrderBody = (
  dateOrder: DateOrder,
): { version: 'imports.profile.v1'; dateOrder: DateOrder } => ({
  version: 'imports.profile.v1',
  dateOrder,
});
