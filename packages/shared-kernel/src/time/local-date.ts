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

  /** Días desde 1970-01-01 (algoritmo civil de Howard Hinnant; no depende de la zona ni del `Date` del proceso). */
  toEpochDay(): number {
    const y = this.month <= 2 ? this.year - 1 : this.year;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const mp = (this.month + 9) % 12;
    const doy = Math.floor((153 * mp + 2) / 5) + this.day - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }

  static ofEpochDay(epochDay: number): LocalDate {
    const z = epochDay + 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor(
      (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
    );
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const month = mp < 10 ? mp + 3 : mp - 9;
    const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
    return LocalDate.of(year, month, day);
  }

  plusDays(days: number): LocalDate {
    return LocalDate.ofEpochDay(this.toEpochDay() + days);
  }

  /** Día de la semana ISO: 1 = lunes … 7 = domingo. */
  dayOfWeek(): number {
    // 1970-01-01 fue jueves (4).
    return ((((this.toEpochDay() + 3) % 7) + 7) % 7) + 1;
  }

  /** Último día del mes de esta fecha (28..31). */
  lengthOfMonth(): number {
    return daysIn(this.year, this.month);
  }

  /** Cantidad de días del mes `month` del año `year`. */
  static daysInMonth(year: number, month: number): number {
    return daysIn(year, month);
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
