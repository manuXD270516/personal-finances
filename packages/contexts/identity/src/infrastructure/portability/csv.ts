/**
 * CSV RFC 4180 UTF-8 del export (openspec add-workspace-export, requirement "Formato abierto y versionado"):
 * separador `,`, fin de línea CRLF, comillas dobles escapadas duplicándolas, punto decimal. Neutralización de CSV
 * injection (docs/12 §7): una celda de TEXTO que empiece con `=`, `+`, `-`, `@`, tabulación o retorno se antepone con
 * una comilla simple. Los montos (cadenas decimales generadas por el sistema, p. ej. `-45.90`) se escriben tal cual
 * con `numeric: true` para no romper su valor numérico: solo se aceptan si coinciden con un decimal estricto.
 */
export const CSV_BOM = '﻿';

const FORMULA_START = /^[=+\-@\t\r]/u;
const STRICT_DECIMAL = /^-?\d+(?:\.\d+)?$/u;

export interface CsvCellOptions {
  /** Cadena decimal exacta generada por el sistema (no se neutraliza). Si no es un decimal estricto, se trata como texto. */
  readonly numeric?: boolean;
}

/** Neutraliza una celda de texto contra fórmulas de hoja de cálculo. */
export function neutralizeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function csvCell(
  value: string | number | boolean | null | undefined,
  options: CsvCellOptions = {},
): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (!(options.numeric === true && STRICT_DECIMAL.test(text))) text = neutralizeCell(text);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export class CsvWriter {
  private readonly rows: string[] = [];

  constructor(columns: readonly string[]) {
    this.rows.push(columns.map((c) => csvCell(c)).join(','));
  }

  /** Cada celda: texto, o `{ n: "45.90" }` para un decimal exacto. */
  row(
    cells: readonly (string | number | boolean | null | undefined | { readonly n: string | null })[],
  ): void {
    this.rows.push(
      cells
        .map((c) => (c !== null && typeof c === 'object' ? csvCell(c.n, { numeric: true }) : csvCell(c)))
        .join(','),
    );
  }

  toBuffer(): Buffer {
    return Buffer.from(`${CSV_BOM}${this.rows.join('\r\n')}\r\n`, 'utf8');
  }
}
