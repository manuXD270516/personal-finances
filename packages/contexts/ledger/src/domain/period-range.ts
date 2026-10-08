import { DomainError, type LocalDate } from '@pf/shared-kernel';
import { nextDay, type PeriodLock } from './period.js';

type Range = Pick<PeriodLock, 'periodStart' | 'periodEnd'>;

/** ¿La fecha cae en el rango cerrado `[periodStart, periodEnd]` (inicio nulo = abierto hacia atrás)? */
export function isInRange(range: Range, date: LocalDate): boolean {
  return (
    (range.periodStart === null || date.compare(range.periodStart) >= 0) && date.compare(range.periodEnd) <= 0
  );
}

/** ¿La fecha pertenece a algún rango cerrado? (ADR-0028; espejo de `ledger.assert_period_open`). */
export function isDateLocked(locks: readonly Range[], date: LocalDate): boolean {
  return locks.some((l) => isInRange(l, date));
}

/** Primera fecha abierta `>= date`: salta mientras la fecha caiga en un lock (fecha = `periodEnd` + 1 día). */
export function firstOpenDateOnOrAfter(locks: readonly Range[], date: LocalDate): LocalDate {
  let current = date;
  for (;;) {
    const hit = locks.find((l) => isInRange(l, current));
    if (!hit) return current;
    if (current.year >= 9999 && hit.periodEnd.year >= 9999) {
      throw new DomainError('VALIDATION_FAILED', 'no open date available');
    }
    current = nextDay(hit.periodEnd);
  }
}
