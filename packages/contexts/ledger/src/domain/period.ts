import { DomainError, type LocalDate } from '@pf/shared-kernel';

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

/** VO `PeriodLock`: el mes está cerrado para asientos (INV-015). Lo escribe Planning vía `LedgerPeriodLockPort`. */
export interface PeriodLock {
  readonly workspaceId: string;
  readonly yearMonth: YearMonth;
  readonly periodId: string | null;
}
