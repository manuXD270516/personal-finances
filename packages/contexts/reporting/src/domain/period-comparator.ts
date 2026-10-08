import { DomainError, endOfDayInstant, LocalDate, MoneyDecimal, type Decimal } from '@pf/shared-kernel';

// `endOfDayInstant` vive en el shared-kernel (add-budgets, docs/33 D109); se re-exporta para el dominio de Reporting.
export { endOfDayInstant };

export interface DateRange {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

export type CompareMode = 'PREVIOUS_PERIOD_TO_DATE' | 'PREVIOUS_PERIOD' | 'NONE';

export interface Comparison {
  readonly mode: Exclude<CompareMode, 'NONE'>;
  /** Tramo del periodo actual que se compara (días 1..N si es "a la fecha"). */
  readonly current: DateRange;
  readonly previous: DateRange;
}

export interface Variation {
  readonly deltaAbs: Decimal;
  /** % con 2 decimales HALF_EVEN; `null` si el anterior es cero. */
  readonly deltaPct: string | null;
  /** Nada en el periodo anterior y algo en el actual ("nuevo"). */
  readonly isNew: boolean;
}

const DAY_MS = 86_400_000;
const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const lastDay = (y: number, m: number) =>
  m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;

const epochDay = (d: LocalDate) => Date.UTC(d.year, d.month - 1, d.day) / DAY_MS;
const fromEpochDay = (n: number) => {
  const dt = new Date(n * DAY_MS);
  return LocalDate.of(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};
const plusDays = (d: LocalDate, n: number) => fromEpochDay(epochDay(d) + n);

const monthRange = (year: number, month: number): DateRange => ({
  from: LocalDate.of(year, month, 1),
  to: LocalDate.of(year, month, lastDay(year, month)),
});
const previousMonth = (d: LocalDate): readonly [number, number] =>
  d.month === 1 ? [d.year - 1, 12] : [d.year, d.month - 1];

const isFullMonth = (r: DateRange) =>
  r.from.day === 1 &&
  r.from.year === r.to.year &&
  r.from.month === r.to.month &&
  r.to.day === lastDay(r.to.year, r.to.month);

/**
 * DS `PeriodComparator` (docs/14 §6; design.md decisión 4), puro. Periodo = mes calendario por fecha de negocio en la
 * zona del workspace (o rango libre). `PREVIOUS_PERIOD_TO_DATE` con el periodo en curso compara días 1..N contra
 * 1..N del mes anterior, acotando N a su último día (31-oct → 1..30 sep); un periodo cerrado se compara completo.
 */
export const PeriodComparator = {
  month(yearMonth: string): DateRange {
    const m = YEAR_MONTH.exec(yearMonth);
    if (!m) throw new DomainError('VALIDATION_FAILED', 'month must be YYYY-MM').at('/month');
    return monthRange(Number(m[1]), Number(m[2]));
  },

  currentMonth(today: LocalDate): DateRange {
    return monthRange(today.year, today.month);
  },

  range(dateFrom: string, dateTo: string): DateRange {
    const from = LocalDate.parse(dateFrom);
    const to = LocalDate.parse(dateTo);
    if (from.compare(to) > 0) {
      throw new DomainError('VALIDATION_FAILED', 'dateFrom must be on or before dateTo').at('/dateFrom');
    }
    return { from, to };
  },

  contains(range: DateRange, date: LocalDate): boolean {
    return range.from.compare(date) <= 0 && date.compare(range.to) <= 0;
  },

  comparison(period: DateRange, today: LocalDate, mode: CompareMode): Comparison | null {
    if (mode === 'NONE') return null;
    const toDate = mode === 'PREVIOUS_PERIOD_TO_DATE' && PeriodComparator.contains(period, today);
    if (isFullMonth(period)) {
      const [py, pm] = previousMonth(period.from);
      const prev = monthRange(py, pm);
      if (!toDate) return { mode, current: period, previous: prev };
      const n = Math.min(today.day, prev.to.day);
      return {
        mode,
        current: { from: period.from, to: today },
        previous: { from: prev.from, to: LocalDate.of(py, pm, n) },
      };
    }
    const length = epochDay(period.to) - epochDay(period.from) + 1;
    const prevFrom = plusDays(period.from, -length);
    if (!toDate)
      return { mode, current: period, previous: { from: prevFrom, to: plusDays(period.from, -1) } };
    const elapsed = epochDay(today) - epochDay(period.from);
    return {
      mode,
      current: { from: period.from, to: today },
      previous: { from: prevFrom, to: plusDays(prevFrom, elapsed) },
    };
  },

  variation(current: Decimal, previous: Decimal): Variation {
    const deltaAbs = current.minus(previous);
    if (previous.isZero()) return { deltaAbs, deltaPct: null, isNew: !current.isZero() };
    const pct = deltaAbs.div(previous.abs()).times(100).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_EVEN);
    return { deltaAbs, deltaPct: pct.toFixed(2), isNew: false };
  },
} as const;
