/**
 * Celdas CSV seguras (RFC 4180; docs/12 §11, docs/14 §12, NFR-SEC-015): misma regla que las exportaciones de AUDIT
 * (recorrido y log) e IDENTITY (export del workspace). Un texto que empieza con `=`, `+`, `-`, `@`, tabulador o retorno
 * se neutraliza con el prefijo `'` (inyección de fórmulas) salvo que sea un decimal exacto (`-12.50` no cambia); se
 * entrecomilla si contiene comillas, comas o saltos de línea, duplicando las comillas internas.
 */
const FORMULA_START = /^[=+\-@\t\r]/u;
const DECIMAL = /^-?\d+(\.\d+)?$/u;
const NEEDS_QUOTES = /[",\r\n]/u;

export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) && !DECIMAL.test(value) ? `'${value}` : value;
}

export function csvCell(value: string): string {
  const safe = neutralizeFormula(value);
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

/** BOM UTF-8: Excel reconoce la codificación (tildes, ñ). */
export const UTF8_BOM = '\uFEFF';
