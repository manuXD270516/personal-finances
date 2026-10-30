/** Tipos compartidos del dominio de IMPORTS (subconjunto CSV básico, openspec add-basic-csv-import). */

export const IMPORT_STATUSES = [
  'UPLOADED',
  'PROCESSING',
  'PARSE_FAILED',
  'AWAITING_MAPPING',
  'AWAITING_REVIEW',
  'APPROVED',
  'PERSISTING',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'COMPLETED_WITH_DIFFERENCE',
  'COMPLETED_WITH_ERRORS',
  'REVERTING',
  'ROLLED_BACK',
  'PARTIALLY_ROLLED_BACK',
  'CANCELLED',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** Dirección del movimiento respecto de la cuenta destino: salida (gasto) o entrada (ingreso). */
export type Direction = 'IN' | 'OUT';

export const CLASSIFICATIONS = ['NEW', 'DUPLICATE_EXACT', 'DUPLICATE_PROBABLE', 'INVALID'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const DECISIONS = ['CREATE', 'SKIP', 'EXCLUDE'] as const;
export type Decision = (typeof DECISIONS)[number];

/** Códigos de fila (enum abierto `ImportRowIssueCode`, no HTTP). */
export const ROW_ISSUE_CODES = [
  'IMPORT_INVALID_DATE',
  'IMPORT_INVALID_AMOUNT',
  'IMPORT_FUTURE_DATE',
  'PERIOD_CLOSED',
  'ACCOUNT_CLOSED',
  'IMPORT_DESCRIPTION_TRUNCATED',
  // Phase 6 (add-import-pipeline): enum abierto `ImportRowIssueCode`.
  'IMPORT_CURRENCY_MISMATCH',
  'IMPORT_AMBIGUOUS_DATE',
  'IMPORT_AMBIGUOUS_NUMBER',
  'IMPORT_RUNNING_BALANCE_GAP',
  'IMPORT_RULES_UNAVAILABLE',
  'IMPORT_OCCURRENCE_LINK_SKIPPED',
] as const;
export type RowIssueCode = (typeof ROW_ISSUE_CODES)[number];

export interface RowIssue {
  readonly code: RowIssueCode;
  /** Advertencia (no bloquea) o error (la fila queda inválida). */
  readonly severity: 'ERROR' | 'WARNING';
  /** Dato técnico sin texto del archivo (p. ej. la diferencia de un quiebre del saldo corrido). */
  readonly detail?: string;
}

export const IMPORT_FILE_ALREADY_IMPORTED = 'IMPORT_FILE_ALREADY_IMPORTED' as const;

export interface MoneyAmount {
  readonly amount: string;
  readonly currency: string;
}
