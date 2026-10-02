import { DomainError } from '../errors/domain-error.js';
import type { Instant } from './instant.js';

/** Fecha de negocio: exactamente `YYYY-MM-DD` (mismo patrón que `components.schemas.LocalDate`). */
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const daysIn = (y: number, m: number) => (m === 2 && isLeap(y) ? 29 : (DAYS[m - 1] ?? 0));

/**
 * Fecha de negocio (NFR-USAB-004): día del calendario en la zona horaria del workspace, sin hora ni zona.
 * Nunca se convierte a otra zona: `"2026-09-30"` es el 30 de septiembre en cualquier cliente.
 */
export class LocalDate {
  private constructor(
    readonly year: number,
    readonly month: number,
    readonly day: number,
  ) {
    Object.freeze(this);
  }

  /** Rechaza fecha-hora (`2026-09-30T23:30:00-04:00`), formatos alternativos y fechas inexistentes. */
  static parse(value: string): LocalDate {
    const m = typeof value === 'string' ? LOCAL_DATE.exec(value) : null;
    if (!m) throw new DomainError('VALIDATION_FAILED', 'business date must be YYYY-MM-DD (no time, no zone)');
    return LocalDate.of(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  static of(year: number, month: number, day: number): LocalDate {
    const valid =
      Number.isInteger(year) &&
      year >= 1 &&
      year <= 9999 &&
      Number.isInteger(month) &&
      month >= 1 &&
      month <= 12 &&
      Number.isInteger(day) &&
      day >= 1 &&
      day <= daysIn(year, month);
    if (!valid) throw new DomainError('VALIDATION_FAILED', `invalid calendar date ${year}-${month}-${day}`);
    return new LocalDate(year, month, day);
  }

  /** Fecha de negocio de un instante en una zona IANA (p. ej. "hoy" del workspace en America/La_Paz). */
  static ofInstant(instant: Instant, timeZone: string): LocalDate {
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(instant.toDate());
    } catch (cause) {
      throw new DomainError('INVALID_TIMEZONE', `invalid IANA time zone '${timeZone}'`, { cause });
    }
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return LocalDate.of(get('year'), get('month'), get('day'));
  }

  compare(other: LocalDate): -1 | 0 | 1 {
    const a = this.toString();
    const b = other.toString();
    return a < b ? -1 : a > b ? 1 : 0;
  }

  equals(other: LocalDate): boolean {
    return this.compare(other) === 0;
  }

  toString(): string {
    const y = String(this.year).padStart(4, '0');
    const m = String(this.month).padStart(2, '0');
    const d = String(this.day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  toJSON(): string {
    return this.toString();
  }
}
