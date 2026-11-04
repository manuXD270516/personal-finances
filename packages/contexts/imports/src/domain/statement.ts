import type { RowIssue } from './types.js';

/**
 * Registro de un extracto ya leído de un formato autodescrito (OFX, QIF, JSON, XLSX) o producido por la normalización
 * de un CSV con perfil (openspec add-import-pipeline, decisión 5). Es la entrada común de las etapas de validación,
 * clasificación y duplicados. Los montos son SIEMPRE texto decimal exacto (nunca `number`, INV-001): con signo, la
 * salida es negativa.
 */

export const STATEMENT_FORMATS = ['CSV', 'OFX', 'QIF', 'JSON', 'XLSX', 'PDF'] as const;
export type StatementFormat = (typeof STATEMENT_FORMATS)[number];

/** Formatos tabulares: el mapeo de columnas (perfil o manual) define fecha, descripción y monto. */
export const TABULAR_FORMATS: readonly StatementFormat[] = ['CSV', 'XLSX'];

export interface StatementRecord {
  /** Posición del registro en el archivo (1 = primer movimiento; para CSV, el número de línea). */
  readonly line: number;
  /** Fecha de negocio `YYYY-MM-DD` en la zona del workspace; `null` si no es interpretable. */
  readonly bookingDate: string | null;
  /** Hora local `HH:mm:ss` si el formato la trae. */
  readonly time: string | null;
  /** Fecha valor `YYYY-MM-DD` (se guarda, no cambia la fecha de negocio). */
  readonly valueDate: string | null;
  /** Monto con signo (salida negativa), texto decimal exacto; `null` si no es interpretable. */
  readonly amount: string | null;
  /** Moneda del registro si el formato la declara (OFX `CURDEF`, JSON `currency`). */
  readonly currency: string | null;
  readonly description: string | null;
  /** Identificador del banco (OFX `FITID`, JSON `externalId`, CSV con referencia única). */
  readonly externalId: string | null;
  /** Número de cheque o referencia NO única. */
  readonly reference: string | null;
  /** Contraparte tal como viene en el archivo (se resuelve por alias en la clasificación). */
  readonly counterparty: string | null;
  /** Saldo corrido después del movimiento. */
  readonly runningBalance: string | null;
  readonly issues: readonly RowIssue[];
}

/** Saldos y periodo que declara el extracto (OFX `LEDGERBAL`, JSON `statement`, `PUT .../statement`). */
export interface StatementBalance {
  readonly openingBalance: string | null;
  readonly closingBalance: string | null;
  /** Fecha del saldo final (`YYYY-MM-DD`). */
  readonly closingDate: string | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
}

export interface ParseFailure {
  /** `IMPORT_PARSE_FAILED` salvo `IMPORT_TOO_MANY_ROWS`. */
  readonly code: 'IMPORT_PARSE_FAILED' | 'IMPORT_TOO_MANY_ROWS';
  /** Puntero JSON o descripción técnica sin texto del archivo (NFR-SEC-015). */
  readonly pointer: string | null;
}

export interface ParseOptions {
  /** Zona IANA del workspace (fecha de negocio de OFX con desfase). */
  readonly timeZone: string;
  /** Tope de filas de datos (`IMPORT_MAX_ROWS`); la lectura se corta al exceder. */
  readonly maxRows: number;
  /** Moneda de la cuenta (QIF y XLSX no la declaran). */
  readonly accountCurrency: string;
  /** Orden de la fecha para QIF y XLSX en texto cuando el perfil lo fija. */
  readonly dateOrder?: 'DMY' | 'MDY' | undefined;
  /** Escala de la moneda de la cuenta (XLSX: exceso de decimales ⇒ `IMPORT_INVALID_AMOUNT`). */
  readonly currencyScale: number;
}

export interface ParsedStatement {
  readonly format: StatementFormat;
  readonly records: readonly StatementRecord[];
  readonly statement: StatementBalance | null;
  /** Moneda declarada por el archivo (`CURDEF`, `currency`). */
  readonly declaredCurrency: string | null;
  /** Fallo estructural: el archivo no se pudo leer (`PARSE_FAILED`) o excede los límites. */
  readonly failure: ParseFailure | null;
  /** `AWAITING_MAPPING` por un dato que el perfil debe aportar (p. ej. orden de fecha de QIF). */
  readonly needsMapping: readonly { readonly code: 'IMPORT_AMBIGUOUS_DATE' | 'IMPORT_AMBIGUOUS_NUMBER' }[];
}

export interface SniffResult {
  readonly format: StatementFormat;
  readonly confidence: 'HIGH' | 'LOW';
}

/** Puerto `StatementParser` (decisión 5): un lector por formato; el de PDF (change propio) producirá los mismos registros. */
export interface StatementParser {
  readonly format: StatementFormat;
  /** Detecta por contenido (primeros KiB), nunca por nombre. `null` si no es de este formato. */
  sniff(head: Uint8Array): SniffResult | null;
  parse(bytes: Uint8Array, options: ParseOptions): ParsedStatement;
}

export type StatementRowIssue = RowIssue;
