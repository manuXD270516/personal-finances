import { DomainError } from '../errors/domain-error.js';
import { LocalDate } from '../time/local-date.js';

/**
 * Regla de recurrencia única (openspec add-recurrence-engine, design decisión 4; docs/04 §2.7). Las cadencias
 * predefinidas y la RRULE personalizada (subconjunto de RFC 5545) se traducen al MISMO objeto de valor, que `expand`
 * evalúa de forma pura y determinista sobre `LocalDate` (sin `Date` del proceso ni zona horaria: RISK-020).
 *
 * Desviación deliberada de RFC 5545: un `BYMONTHDAY` 29–31 en un mes sin ese día produce el ÚLTIMO día del mes
 * (FR-COMMITMENTS-005) en vez de omitir el mes. El ancla por omisión es el día (y mes, en anual) de `dtstart`.
 */
export const RECURRENCE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQUENCIES)[number];

export const CADENCES = [
  'DAILY',
  'WEEKLY',
  'BIWEEKLY',
  'SEMIMONTHLY',
  'MONTHLY',
  'BIMONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
] as const;
export type Cadence = (typeof CADENCES)[number];

/** Día de la semana (ISO 1 = lunes … 7 = domingo) con ordinal opcional (±1..±5) para reglas mensuales. */
export interface WeekdaySpec {
  readonly weekday: number;
  readonly ordinal?: number;
}

export interface RecurrenceRule {
  readonly freq: RecurrenceFreq;
  /** 1..{@link MAX_INTERVAL} períodos de `freq` entre cada ocurrencia. */
  readonly interval: number;
  /** 1..31 o -1 (último día). Vacío: el día de `dtstart`. */
  readonly byMonthDay: readonly number[];
  readonly byWeekday: readonly WeekdaySpec[];
  /** ±1..±5; selecciona posiciones dentro del conjunto del mes. */
  readonly bySetPos: readonly number[];
  readonly dtstart: LocalDate;
  readonly until: LocalDate | null;
  /** Cuenta fechas nominales de la serie desde `dtstart`. */
  readonly count: number | null;
}

export interface DateWindow {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

export const MAX_INTERVAL = 120;
export const MAX_COUNT = 1000;

type InvalidCode = 'RECURRING_INVALID_SCHEDULE' | 'INVALID_RRULE';

const invalid = (code: InvalidCode, message: string) => new DomainError(code, message);

const isIntIn = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

export interface RuleInput {
  readonly freq: RecurrenceFreq;
  readonly interval?: number;
  readonly byMonthDay?: readonly number[];
  readonly byWeekday?: readonly WeekdaySpec[];
  readonly bySetPos?: readonly number[];
  readonly dtstart: LocalDate;
  readonly until?: LocalDate | null;
  readonly count?: number | null;
}

/** Valida y normaliza (ordena, deduplica) una regla. `code` distingue cadencias (`RECURRING_INVALID_SCHEDULE`) de RRULE. */
export function createRule(
  input: RuleInput,
  code: InvalidCode = 'RECURRING_INVALID_SCHEDULE',
): RecurrenceRule {
  const interval = input.interval ?? 1;
  if (!isIntIn(interval, 1, MAX_INTERVAL)) throw invalid(code, `interval must be 1..${MAX_INTERVAL}`);
  const count = input.count ?? null;
  const until = input.until ?? null;
  if (count !== null && !isIntIn(count, 1, MAX_COUNT)) throw invalid(code, `count must be 1..${MAX_COUNT}`);
  if (count !== null && until !== null) throw invalid(code, 'count and until are mutually exclusive');
  if (until !== null && until.compare(input.dtstart) < 0)
    throw invalid(code, 'until is before the start date');

  const byMonthDay = [...new Set(input.byMonthDay ?? [])];
  for (const d of byMonthDay) {
    if (!(isIntIn(d, 1, 31) || d === -1)) throw invalid(code, `month day ${String(d)} must be 1..31 or -1`);
  }
  byMonthDay.sort((a, b) => key(a) - key(b));

  const specs = new Map<string, WeekdaySpec>();
  for (const w of input.byWeekday ?? []) {
    if (!isIntIn(w.weekday, 1, 7)) throw invalid(code, 'weekday must be 1..7');
    if (w.ordinal !== undefined && !(isIntIn(w.ordinal, 1, 5) || isIntIn(w.ordinal, -5, -1))) {
      throw invalid(code, 'weekday ordinal must be ±1..±5');
    }
    specs.set(`${w.weekday}|${w.ordinal ?? ''}`, w.ordinal === undefined ? { weekday: w.weekday } : w);
  }
  const byWeekday = [...specs.values()].sort(
    (a, b) => a.weekday - b.weekday || (a.ordinal ?? 0) - (b.ordinal ?? 0),
  );
  const bySetPos = [...new Set(input.bySetPos ?? [])];
  for (const p of bySetPos) {
    if (!(isIntIn(p, 1, 5) || isIntIn(p, -5, -1))) throw invalid(code, 'set position must be ±1..±5');
  }
  bySetPos.sort((a, b) => a - b);

  const ordinals = byWeekday.some((w) => w.ordinal !== undefined);
  switch (input.freq) {
    case 'DAILY':
    case 'WEEKLY':
      if (byMonthDay.length > 0) throw invalid(code, `month days are not allowed with ${input.freq}`);
      if (ordinals) throw invalid(code, `weekday ordinals are not allowed with ${input.freq}`);
      if (bySetPos.length > 0) throw invalid(code, `set positions are not allowed with ${input.freq}`);
      break;
    case 'MONTHLY':
      if (byMonthDay.length > 0 && byWeekday.length > 0) {
        throw invalid(code, 'month days and weekdays cannot be combined');
      }
      if (bySetPos.length > 0 && byMonthDay.length === 0 && byWeekday.length === 0) {
        throw invalid(code, 'set positions need month days or weekdays');
      }
      if (bySetPos.length > 0 && ordinals) throw invalid(code, 'set positions and weekday ordinals conflict');
      break;
    case 'YEARLY':
      if (byWeekday.length > 0) throw invalid(code, 'weekdays are not allowed with YEARLY');
      if (bySetPos.length > 0) throw invalid(code, 'set positions are not allowed with YEARLY');
      if (byMonthDay.length > 1) throw invalid(code, 'YEARLY accepts at most one month day');
      break;
  }
  return Object.freeze({
    freq: input.freq,
    interval,
    byMonthDay: Object.freeze(byMonthDay),
    byWeekday: Object.freeze(byWeekday),
    bySetPos: Object.freeze(bySetPos),
    dtstart: input.dtstart,
    until,
    count,
  });
}

/** Orden de los días del mes: 1..31 ascendente y luego -1 (el último). */
const key = (d: number) => (d === -1 ? 99 : d);

export interface CadenceInput {
  readonly cadence: Cadence;
  readonly interval?: number;
  readonly dtstart: LocalDate;
  /** `SEMIMONTHLY`: exactamente dos días distintos; mensual y derivadas, a lo sumo uno (cambia el día del ancla). */
  readonly monthDays?: readonly number[];
  readonly until?: LocalDate | null;
  readonly count?: number | null;
}

const CADENCE_MAP: Readonly<Record<Cadence, { freq: RecurrenceFreq; factor: number }>> = {
  DAILY: { freq: 'DAILY', factor: 1 },
  WEEKLY: { freq: 'WEEKLY', factor: 1 },
  BIWEEKLY: { freq: 'WEEKLY', factor: 2 },
  SEMIMONTHLY: { freq: 'MONTHLY', factor: 1 },
  MONTHLY: { freq: 'MONTHLY', factor: 1 },
  BIMONTHLY: { freq: 'MONTHLY', factor: 2 },
  QUARTERLY: { freq: 'MONTHLY', factor: 3 },
  SEMIANNUAL: { freq: 'MONTHLY', factor: 6 },
  ANNUAL: { freq: 'YEARLY', factor: 1 },
};

/** Cadencia predefinida → regla (design decisión 4). `RECURRING_INVALID_SCHEDULE` ante datos inconsistentes. */
export function ruleFromCadence(input: CadenceInput): RecurrenceRule {
  const map = CADENCE_MAP[input.cadence];
  if (!map) throw invalid('RECURRING_INVALID_SCHEDULE', `unknown cadence ${String(input.cadence)}`);
  const interval = input.interval ?? 1;
  if (!isIntIn(interval, 1, MAX_INTERVAL)) {
    throw invalid('RECURRING_INVALID_SCHEDULE', `interval must be 1..${MAX_INTERVAL}`);
  }
  const monthDays = [...new Set(input.monthDays ?? [])];
  if (input.cadence === 'SEMIMONTHLY') {
    if (monthDays.length !== 2) {
      throw invalid('RECURRING_INVALID_SCHEDULE', 'SEMIMONTHLY needs exactly two distinct month days');
    }
  } else if (map.freq === 'DAILY' || map.freq === 'WEEKLY') {
    if (monthDays.length > 0) {
      throw invalid('RECURRING_INVALID_SCHEDULE', `month days are not allowed with ${input.cadence}`);
    }
  } else if (monthDays.length > 1) {
    throw invalid('RECURRING_INVALID_SCHEDULE', `${input.cadence} accepts at most one month day`);
  }
  return createRule({
    freq: map.freq,
    interval: interval * map.factor,
    byMonthDay: monthDays,
    dtstart: input.dtstart,
    until: input.until ?? null,
    count: input.count ?? null,
  });
}

// ───────────────────────────────────────────────────────── expansión

const monthIndex = (year: number, month: number) => year * 12 + (month - 1);
const mondayWeek = (d: LocalDate) => Math.floor((d.toEpochDay() + 3) / 7);

function resolveMonthDay(day: number, length: number): number {
  if (day === -1) return length;
  return day > length ? length : day;
}

/** Fechas candidatas del mes (ordenadas, sin duplicados) según la regla, antes de filtrar por `dtstart`/ventana. */
function monthCandidates(year: number, month: number, rule: RecurrenceRule): LocalDate[] {
  const length = LocalDate.daysInMonth(year, month);
  let days: number[];
  if (rule.byWeekday.length > 0) {
    const found = new Set<number>();
    for (const spec of rule.byWeekday) {
      const matching: number[] = [];
      for (let d = 1; d <= length; d += 1) {
        if (LocalDate.of(year, month, d).dayOfWeek() === spec.weekday) matching.push(d);
      }
      if (spec.ordinal === undefined) {
        for (const d of matching) found.add(d);
      } else {
        const pick = spec.ordinal > 0 ? matching[spec.ordinal - 1] : matching[matching.length + spec.ordinal];
        if (pick !== undefined) found.add(pick);
      }
    }
    days = [...found].sort((a, b) => a - b);
  } else if (rule.byMonthDay.length > 0) {
    days = [...new Set(rule.byMonthDay.map((d) => resolveMonthDay(d, length)))].sort((a, b) => a - b);
  } else {
    days = [Math.min(rule.dtstart.day, length)];
  }
  if (rule.bySetPos.length > 0) {
    const picked = new Set<number>();
    for (const pos of rule.bySetPos) {
      const d = pos > 0 ? days[pos - 1] : days[days.length + pos];
      if (d !== undefined) picked.add(d);
    }
    days = [...picked].sort((a, b) => a - b);
  }
  return days.map((d) => LocalDate.of(year, month, d));
}

/** Fechas (ordenadas, únicas) de un bloque de la serie: mes, semana, año o día según `freq`. */
function* blocks(
  rule: RecurrenceRule,
  from: LocalDate,
  to: LocalDate,
  skipAhead: boolean,
): Generator<LocalDate[]> {
  const step = rule.interval;
  const { dtstart } = rule;
  switch (rule.freq) {
    case 'DAILY': {
      const first = skipAhead ? Math.max(0, Math.ceil((from.toEpochDay() - dtstart.toEpochDay()) / step)) : 0;
      for (let k = first; ; k += 1) {
        const date = dtstart.plusDays(k * step);
        if (date.compare(to) > 0) return;
        if (rule.byWeekday.length > 0 && !rule.byWeekday.some((w) => w.weekday === date.dayOfWeek())) {
          yield [];
        } else {
          yield [date];
        }
      }
    }
    case 'WEEKLY': {
      const w0 = mondayWeek(dtstart);
      const weekdays =
        rule.byWeekday.length > 0 ? rule.byWeekday.map((w) => w.weekday) : [dtstart.dayOfWeek()];
      const first = skipAhead ? Math.max(0, Math.floor((mondayWeek(from) - w0) / step)) : 0;
      for (let k = first; ; k += 1) {
        const monday = (w0 + k * step) * 7 - 3;
        if (monday > to.toEpochDay()) return;
        yield weekdays.map((wd) => LocalDate.ofEpochDay(monday + wd - 1));
      }
    }
    case 'MONTHLY': {
      const m0 = monthIndex(dtstart.year, dtstart.month);
      const first = skipAhead ? Math.max(0, Math.floor((monthIndex(from.year, from.month) - m0) / step)) : 0;
      for (let k = first; ; k += 1) {
        const m = m0 + k * step;
        const year = Math.floor(m / 12);
        const month = (m % 12) + 1;
        if (LocalDate.of(year, month, 1).compare(to) > 0) return;
        yield monthCandidates(year, month, rule);
      }
    }
    case 'YEARLY': {
      const first = skipAhead ? Math.max(0, Math.floor((from.year - dtstart.year) / step)) : 0;
      for (let k = first; ; k += 1) {
        const year = dtstart.year + k * step;
        if (year > to.year) return;
        const length = LocalDate.daysInMonth(year, dtstart.month);
        const day =
          rule.byMonthDay.length > 0
            ? resolveMonthDay(rule.byMonthDay[0] as number, length)
            : Math.min(dtstart.day, length);
        yield [LocalDate.of(year, dtstart.month, day)];
      }
    }
  }
}

/**
 * Fechas NOMINALES de la serie dentro de la ventana inclusiva, estrictamente crecientes y sin duplicados. Pura y
 * determinista. `until` y `count` acotan la serie desde `dtstart` (el conteo incluye las fechas anteriores a la ventana).
 */
export function expand(rule: RecurrenceRule, window: DateWindow): LocalDate[] {
  if (window.to.compare(window.from) < 0) return [];
  const limit = rule.until !== null && rule.until.compare(window.to) < 0 ? rule.until : window.to;
  if (limit.compare(window.from) < 0 || limit.compare(rule.dtstart) < 0) return [];
  const out: LocalDate[] = [];
  const counted = rule.count !== null;
  let emitted = 0;
  for (const block of blocks(rule, window.from, limit, !counted)) {
    for (const date of block) {
      if (date.compare(rule.dtstart) < 0) continue;
      if (date.compare(limit) > 0) continue;
      emitted += 1;
      if (counted && emitted > (rule.count as number)) return out;
      if (date.compare(window.from) >= 0) out.push(date);
    }
    if (counted && emitted >= (rule.count as number)) break;
  }
  return out;
}

/** Las primeras `n` fechas nominales desde `from` (inclusive), dentro de `maxYears` años; vista previa de la UI. */
export function nextDates(rule: RecurrenceRule, from: LocalDate, n: number, maxYears = 10): LocalDate[] {
  const out: LocalDate[] = [];
  let cursor = from;
  const end = LocalDate.of(Math.min(9999, from.year + maxYears), 12, 31);
  while (out.length < n && cursor.compare(end) <= 0) {
    const to = LocalDate.of(Math.min(9999, cursor.year + 1), 12, 31);
    const chunk = expand(rule, { from: cursor, to: to.compare(end) > 0 ? end : to });
    for (const d of chunk) {
      if (out.length < n) out.push(d);
    }
    if (to.compare(end) >= 0) break;
    cursor = to.plusDays(1);
  }
  return out;
}
