/** Tipos compartidos del dominio de IMPORTS (subconjunto CSV básico, openspec add-basic-csv-import). */

export const IMPORT_STATUSES = [
  'AWAITING_MAPPING',
  'AWAITING_REVIEW',
  'APPROVED',
  'PERSISTING',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'COMPLETED_WITH_ERRORS',
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
] as const;
export type RowIssueCode = (typeof ROW_ISSUE_CODES)[number];

export interface RowIssue {
  readonly code: RowIssueCode;
  /** Advertencia (no bloquea) o error (la fila queda inválida). */
  readonly severity: 'ERROR' | 'WARNING';
}

export const IMPORT_FILE_ALREADY_IMPORTED = 'IMPORT_FILE_ALREADY_IMPORTED' as const;

export interface MoneyAmount {
  readonly amount: string;
  readonly currency: string;
}
