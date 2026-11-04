import type { PdfDateFormat, PdfTimeFormat } from './date-grammar.js';
import type { PdfNumberFormat } from './number-grammar.js';

/**
 * Diseño declarativo de un extracto PDF por institución (`imports.pdf-layout.v1`, openspec add-pdf-statement-parser
 * decisión 6). Es DATO validado por JSON Schema (`contracts/imports/pdf-layout.v1.schema.json`): sin expresiones
 * regulares ni código. Una versión publicada es inmutable (`pdf-layouts.lock.json`).
 */
export const COLUMN_ROLES = [
  'DATE',
  'TIME',
  'DESCRIPTION',
  'AMOUNT',
  'DEBIT',
  'CREDIT',
  'BALANCE',
  'REFERENCE',
  'IGNORE',
] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

export interface PdfLayoutColumn {
  /** Rótulos aceptados del encabezado de la tabla (cualquiera de ellos identifica la columna). */
  readonly labels: readonly string[];
  readonly role: ColumnRole;
  readonly align: 'LEFT' | 'RIGHT';
}

/** Dónde está un saldo: el valor a la derecha de un rótulo, o la celda de saldo de una fila omitida. */
export type BalanceSource =
  | { readonly kind: 'LABEL'; readonly label: string; readonly occurrence?: 'FIRST' | 'LAST' }
  | { readonly kind: 'SKIP_ROW'; readonly description: string };

export type PeriodSource =
  | { readonly kind: 'MONTH_YEAR'; readonly label: string }
  /** Dos fechas con el formato del diseño en un mismo texto (`DEL 01/03/2026 AL 31/03/2026`). */
  | { readonly kind: 'DATE_RANGE' }
  /** `del 01 de marzo, 2026 al 31 de marzo, 2026`. */
  | { readonly kind: 'LONG_DATE_RANGE' };

export interface PdfLayoutSection {
  readonly id: string;
  readonly startLabel: string;
  readonly totalLabel: string;
  /** `CREDIT`: los montos de la sección suman; `DEBIT`: restan. */
  readonly sign: 'CREDIT' | 'DEBIT';
}

export interface PdfLayout {
  readonly id: string;
  readonly version: number;
  readonly institutionCode?: string;
  /** Etiqueta impresa ⇒ moneda (`Bolivianos` ⇒ BOB). */
  readonly currencyLabels: readonly { readonly label: string; readonly currency: string }[];
  readonly detect: { readonly literals: readonly string[] };
  readonly header: {
    readonly account?: { readonly label: string };
    readonly period?: PeriodSource;
    readonly openingBalance?: BalanceSource;
    readonly closingBalance?: BalanceSource;
    /** Resumen impreso que se verifica contra las filas (`Total de débitos` / `Total de créditos`). */
    readonly totalDebits?: { readonly label: string };
    readonly totalCredits?: { readonly label: string };
    readonly totalPages?:
      { readonly kind: 'LABEL'; readonly label: string } | { readonly kind: 'PAGE_N_OF_M' };
  };
  readonly table: {
    readonly columns: readonly PdfLayoutColumn[];
    readonly rowAnchor: 'DATE' | 'AMOUNT';
    /** Holgura (en alturas de línea) a la izquierda del rótulo de una columna alineada a la derecha. */
    readonly rightSlackEm?: number;
    readonly sections?: readonly PdfLayoutSection[];
    /** Filas de la tabla que aportan un saldo y no son movimientos (`Saldo anterior`). */
    readonly skipRows?: readonly { readonly description: string }[];
    /** Un renglón que contiene alguno de estos literales cierra la tabla de la página (totales del pie). */
    readonly endLabels?: readonly string[];
    /** A partir de una línea de glosa que empieza con alguno de estos literales, el texto es la contraparte. */
    readonly counterpartyStarts?: readonly string[];
    /** Líneas de glosa que empiezan con alguno de estos literales se descartan (repiten al titular). */
    readonly dropLinePrefixes?: readonly string[];
  };
  readonly page: {
    readonly repeatedLiterals: readonly string[];
    readonly footerLiterals: readonly string[];
    readonly blankPageLiterals: readonly string[];
    readonly discardLiterals: readonly string[];
  };
  readonly number: PdfNumberFormat;
  readonly date: PdfDateFormat;
  readonly time: PdfTimeFormat;
  readonly reference: { readonly unique: boolean };
  /** Literales con comodín `{n}` que se quitan SOLO de la descripción usada en la huella. */
  readonly volatileFragments: readonly string[];
}

export interface PdfLayoutRef {
  readonly id: string;
  readonly version: number;
}
