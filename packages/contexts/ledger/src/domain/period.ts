import { DomainError, LocalDate } from '@pf/shared-kernel';

const YEAR_MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/**
 * VO `YearMonth` (`YYYY-MM`): granularidad del bloqueo de periodo, MENSUAL por `(workspace_id, year_month)`
 * (docs/31 D10, docs/08 §5.3 punto 6, docs/09 §10).
 */
export class YearMonth {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static parse(value: string): YearMonth {
    if (typeof value !== 'string' || !YEAR_MONTH.test(value)) {
      throw new DomainError('VALIDATION_FAILED', `period must be YYYY-MM, got '${String(value)}'`);
    }
    return new YearMonth(value);
  }

  static of(date: LocalDate): YearMonth {
    return new YearMonth(`${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}`);
  }

  contains(date: LocalDate): boolean {
    return YearMonth.of(date).value === this.value;
  }

  toString(): string {
    return this.value;
  }
}

/** Día siguiente del calendario (cálculo UTC puro, sin zona). */
export function nextDay(date: LocalDate): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return LocalDate.of(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * VO `PeriodLock`: el RANGO de fechas `[periodStart, periodEnd]` está cerrado para asientos (INV-015; ADR-0028: el
 * periodo financiero ya no es el mes calendario). Lo escribe Planning vía `LedgerPeriodLockPort`.
 * `periodStart = null` = abierto hacia atrás (primer periodo cerrado del workspace). `yearMonth` es la etiqueta del
 * periodo (clave de idempotencia). Sin rango explícito, el lock es el mes calendario de `yearMonth` (compatibilidad
 * Phase 1).
 */
export interface PeriodLock {
  readonly workspaceId: string;
  readonly yearMonth: YearMonth;
  readonly periodId: string | null;
  readonly periodStart: LocalDate | null;
  readonly periodEnd: LocalDate;
}

/** Último día del mes calendario de un `YearMonth`. */
export function lastDayOfMonth(ym: YearMonth): LocalDate {
  const [y, m] = ym.value.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m, 0));
  return LocalDate.of(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export interface PeriodLockInput {
  readonly workspaceId: string;
  readonly yearMonth: YearMonth;
  readonly periodId?: string | null;
  readonly periodStart?: LocalDate | null;
  readonly periodEnd?: LocalDate | null;
  /** Primer periodo cerrado: sin inicio (`-infinity`). */
  readonly openStart?: boolean;
}

/** Construye el lock; sin rango explícito, mes calendario (`YYYY-MM-01` .. fin de mes). */
export function newPeriodLock(input: PeriodLockInput): PeriodLock {
  const periodEnd = input.periodEnd ?? lastDayOfMonth(input.yearMonth);
  let periodStart: LocalDate | null;
  if (input.openStart) periodStart = null;
  else periodStart = input.periodStart ?? LocalDate.parse(`${input.yearMonth.value}-01`);
  if (periodStart && periodEnd.compare(periodStart) < 0) {
    throw new DomainError('VALIDATION_FAILED', 'periodEnd must be on or after periodStart');
  }
  return {
    workspaceId: input.workspaceId,
    yearMonth: input.yearMonth,
    periodId: input.periodId ?? null,
    periodStart,
    periodEnd,
  };
}
