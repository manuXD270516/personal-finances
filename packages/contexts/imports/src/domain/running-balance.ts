import { Money } from '@pf/shared-kernel';

/**
 * Verificación del saldo corrido y del saldo final del extracto (FR-IMPORTS-011, openspec add-import-pipeline
 * decisión 14). Aritmética exacta con `Money` (nunca `number`, INV-001). El orden es el del ARCHIVO, no el de la fecha
 * (fichas de formato: el saldo corrido sigue el orden impreso).
 */
export interface BalanceRow {
  /** Línea del archivo. */
  readonly line: number;
  /** Monto con signo (salida negativa); `null` si la fila es inválida. */
  readonly amount: string | null;
  readonly runningBalance: string | null;
}

export interface RunningBalanceGap {
  readonly line: number;
  /** Saldo que traía el archivo. */
  readonly actual: string;
  /** Saldo anterior + monto de la fila. */
  readonly expected: string;
  /** `actual − expected`, con signo. */
  readonly difference: string;
  /** `|actual − expected|`: lo que muestra la advertencia `IMPORT_RUNNING_BALANCE_GAP`. */
  readonly absoluteDifference: string;
}

/**
 * Cada saldo debe ser el anterior más el monto de la fila. La primera fila con saldo se contrasta con `openingBalance`
 * si se conoce; si no, solo fija la base. Tras una ruptura la base pasa a ser el saldo declarado (una sola advertencia
 * por quiebre). Las filas inválidas o sin saldo propagan la base esperada sin advertir.
 */
export function verifyRunningBalance(
  rows: readonly BalanceRow[],
  currencyCode: string,
  scale: number,
  openingBalance: string | null = null,
): RunningBalanceGap[] {
  const money = (v: string) => Money.parse(v, currencyCode, scale);
  const gaps: RunningBalanceGap[] = [];
  let base: Money | null = openingBalance === null ? null : money(openingBalance);
  for (const row of rows) {
    if (row.amount === null) continue;
    const amount = money(row.amount);
    const expected = base === null ? null : base.add(amount);
    if (row.runningBalance === null) {
      base = expected;
      continue;
    }
    const actual = money(row.runningBalance);
    if (expected !== null && !actual.equals(expected)) {
      const diff = actual.subtract(expected);
      gaps.push({
        line: row.line,
        actual: actual.toJSON().amount,
        expected: expected.toJSON().amount,
        difference: diff.toJSON().amount,
        absoluteDifference: diff.abs().toJSON().amount,
      });
    }
    base = actual;
  }
  return gaps;
}

export interface StatementDifference {
  /** Saldo final del extracto. */
  readonly closingBalance: string;
  /** Saldo resultante de la cuenta tras el import. */
  readonly resultingBalance: string;
  /** `closing − resulting`, con signo. */
  readonly difference: string;
  readonly absoluteDifference: string;
  readonly matches: boolean;
}

/** Diferencia entre el saldo final del extracto y el saldo resultante (vista previa y reconciliación final). */
export function statementDifference(
  closingBalance: string,
  resultingBalance: string,
  currencyCode: string,
  scale: number,
): StatementDifference {
  const closing = Money.parse(closingBalance, currencyCode, scale);
  const resulting = Money.parse(resultingBalance, currencyCode, scale);
  const diff = closing.subtract(resulting);
  return {
    closingBalance: closing.toJSON().amount,
    resultingBalance: resulting.toJSON().amount,
    difference: diff.toJSON().amount,
    absoluteDifference: diff.abs().toJSON().amount,
    matches: diff.isZero(),
  };
}
