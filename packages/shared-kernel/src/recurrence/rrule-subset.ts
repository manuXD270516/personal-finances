import { DomainError } from '../errors/domain-error.js';
import { LocalDate } from '../time/local-date.js';
import {
  RECURRENCE_FREQUENCIES,
  createRule,
  expand,
  type RecurrenceFreq,
  type RecurrenceRule,
  type WeekdaySpec,
} from './recurrence-rule.js';

/**
 * Subconjunto de RRULE (RFC 5545) soportado (FR-COMMITMENTS-003, Should; design decisión 4): `FREQ`, `INTERVAL`,
 * `BYDAY` (con ordinal opcional), `BYMONTHDAY` (1..31 y -1), `BYSETPOS` (±1..±5), `COUNT` y `UNTIL` (fecha). Cualquier
 * otra parte, `COUNT` junto con `UNTIL` o una regla sin fechas en 5 años ⇒ `INVALID_RRULE`.
 */
const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const ALLOWED_PARTS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYSETPOS', 'COUNT', 'UNTIL']);
const BYDAY = /^([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/;
const INT = /^[+-]?\d{1,4}$/;

/** Años que debe producir al menos una fecha una regla personalizada. */
export const RRULE_LOOKAHEAD_YEARS = 5;

const fail = (message: string) => new DomainError('INVALID_RRULE', message);

function parseInts(value: string, part: string): number[] {
  return value.split(',').map((raw) => {
    if (!INT.test(raw)) throw fail(`${part} has a non numeric value`);
    return Number(raw);
  });
}

function parseUntil(value: string): LocalDate {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value);
  if (!m) throw fail('UNTIL must be a date (YYYYMMDD)');
  try {
    return LocalDate.of(Number(m[1]), Number(m[2]), Number(m[3]));
  } catch {
    throw fail('UNTIL is not a valid calendar date');
  }
}

export const RRuleSubset = {
  /** Parsea y normaliza; `dtstart` es la fecha de inicio de la definición (la RRULE no la lleva). */
  parse(text: string, dtstart: LocalDate): RecurrenceRule {
    if (typeof text !== 'string' || text.trim() === '') throw fail('RRULE is empty');
    const body = text.trim().replace(/^RRULE:/i, '');
    const parts = new Map<string, string>();
    for (const chunk of body.split(';')) {
      const eq = chunk.indexOf('=');
      if (eq <= 0) throw fail(`malformed RRULE part '${chunk}'`);
      const name = chunk.slice(0, eq).toUpperCase();
      const value = chunk.slice(eq + 1).toUpperCase();
      if (!ALLOWED_PARTS.has(name)) throw fail(`RRULE part ${name} is not supported`);
      if (parts.has(name)) throw fail(`RRULE part ${name} is repeated`);
      if (value === '') throw fail(`RRULE part ${name} is empty`);
      parts.set(name, value);
    }
    const freq = parts.get('FREQ');
    if (!freq || !(RECURRENCE_FREQUENCIES as readonly string[]).includes(freq)) {
      throw fail('FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY');
    }
    if (parts.has('COUNT') && parts.has('UNTIL')) throw fail('COUNT and UNTIL cannot be combined');

    const byWeekday: WeekdaySpec[] = [];
    for (const token of (parts.get('BYDAY') ?? '').split(',').filter((t) => t !== '')) {
      const m = BYDAY.exec(token);
      if (!m) throw fail(`BYDAY value '${token}' is not supported`);
      const weekday = WEEKDAY_CODES.indexOf(m[2] as (typeof WEEKDAY_CODES)[number]) + 1;
      byWeekday.push(m[1] === undefined ? { weekday } : { weekday, ordinal: Number(m[1]) });
    }
    const interval = parts.has('INTERVAL') ? parseInts(parts.get('INTERVAL') as string, 'INTERVAL') : [1];
    const count = parts.has('COUNT') ? parseInts(parts.get('COUNT') as string, 'COUNT') : [];
    if (interval.length !== 1 || count.length > 1) throw fail('INTERVAL and COUNT take a single value');

    const rule = createRule(
      {
        freq: freq as RecurrenceFreq,
        interval: interval[0] as number,
        byMonthDay: parts.has('BYMONTHDAY') ? parseInts(parts.get('BYMONTHDAY') as string, 'BYMONTHDAY') : [],
        byWeekday,
        bySetPos: parts.has('BYSETPOS') ? parseInts(parts.get('BYSETPOS') as string, 'BYSETPOS') : [],
        dtstart,
        until: parts.has('UNTIL') ? parseUntil(parts.get('UNTIL') as string) : null,
        count: count[0] ?? null,
      },
      'INVALID_RRULE',
    );
    const horizon = LocalDate.of(Math.min(9998, dtstart.year + RRULE_LOOKAHEAD_YEARS), 12, 31);
    if (expand(rule, { from: dtstart, to: horizon }).length === 0) {
      throw fail(`RRULE produces no dates within ${RRULE_LOOKAHEAD_YEARS} years`);
    }
    return rule;
  },

  /** Forma normalizada (orden fijo de partes, mayúsculas, `UNTIL` como `YYYYMMDD`); `parse(format(r)) = r`. */
  format(rule: RecurrenceRule): string {
    const out = [`FREQ=${rule.freq}`, `INTERVAL=${rule.interval}`];
    if (rule.byWeekday.length > 0) {
      out.push(
        `BYDAY=${rule.byWeekday.map((w) => `${w.ordinal === undefined ? '' : w.ordinal}${WEEKDAY_CODES[w.weekday - 1]}`).join(',')}`,
      );
    }
    if (rule.byMonthDay.length > 0) out.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
    if (rule.bySetPos.length > 0) out.push(`BYSETPOS=${rule.bySetPos.join(',')}`);
    if (rule.count !== null) out.push(`COUNT=${rule.count}`);
    if (rule.until !== null) out.push(`UNTIL=${rule.until.toString().replaceAll('-', '')}`);
    return out.join(';');
  },
} as const;
