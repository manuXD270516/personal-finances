import type { LocalDate } from '@pf/shared-kernel';
import type { NormalizedRow } from './row-normalizer.js';
import type { RowIssue } from './types.js';

/**
 * `RowValidator` (decisión 6 de add-basic-csv-import): reglas de negocio de una fila ya normalizada. Una fila con
 * errores de normalización conserva solo esos errores (no se apilan avisos sobre un dato que no se pudo leer).
 */

export interface ClosedPeriodRange {
  /** `YYYY-MM-DD` inclusive. */
  readonly start: string;
  readonly end: string;
}

export interface ValidationContext {
  /** "Hoy" en la zona horaria del workspace. */
  readonly today: LocalDate;
  /** Tolerancia de fechas futuras en días (`IMPORT_FUTURE_DATE_TOLERANCE_DAYS`, por defecto 3). */
  readonly futureToleranceDays: number;
  readonly closedPeriods: readonly ClosedPeriodRange[];
}

export const hasErrors = (issues: readonly RowIssue[]): boolean => issues.some((i) => i.severity === 'ERROR');

/** Todas las incidencias de la fila (normalización + negocio). Una fila es válida si no hay ninguna de severidad `ERROR`. */
export function validateRow(row: NormalizedRow, ctx: ValidationContext): readonly RowIssue[] {
  if (hasErrors(row.issues)) return row.issues;
  const issues: RowIssue[] = [...row.issues];
  if (row.direction === null) {
    issues.push({ code: 'IMPORT_INVALID_AMOUNT', severity: 'ERROR' });
  }
  if (row.bookingDate !== null) {
    if (row.bookingDate > ctx.today.plusDays(ctx.futureToleranceDays).toString()) {
      issues.push({ code: 'IMPORT_FUTURE_DATE', severity: 'ERROR' });
    }
    if (
      ctx.closedPeriods.some(
        (p) => row.bookingDate !== null && p.start <= row.bookingDate && row.bookingDate <= p.end,
      )
    ) {
      issues.push({ code: 'PERIOD_CLOSED', severity: 'ERROR' });
    }
  }
  return issues;
}
