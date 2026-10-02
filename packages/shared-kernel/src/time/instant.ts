import { DomainError } from '../errors/domain-error.js';

/** RFC 3339 en UTC con sufijo `Z` (mismo patrón que `components.schemas.Instant` del contrato). */
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

/**
 * Instante absoluto (precisión de milisegundos, como `timestamptz` → JS). Se serializa siempre en UTC con `Z` y
 * milisegundos (`2026-10-01T03:30:00.000Z`). Nunca se usa para fechas de negocio (ver `LocalDate`).
 */
export class Instant {
  private constructor(readonly epochMillis: number) {
    Object.freeze(this);
  }

  static ofEpochMillis(ms: number): Instant {
    if (!Number.isSafeInteger(ms)) throw new DomainError('VALIDATION_FAILED', `invalid epoch millis ${ms}`);
    return new Instant(ms);
  }

  static fromDate(date: Date): Instant {
    return Instant.ofEpochMillis(date.getTime());
  }

  /** Acepta solo RFC 3339 UTC con `Z`; un offset (`-04:00`) o una fecha sin hora se rechazan. */
  static parse(value: string): Instant {
    const m = typeof value === 'string' ? INSTANT.exec(value) : null;
    if (!m) throw new DomainError('VALIDATION_FAILED', 'instant must be RFC 3339 UTC with Z suffix');
    const ms = Date.parse(value);
    const check = new Date(ms);
    const same =
      !Number.isNaN(ms) &&
      check.getUTCFullYear() === Number(m[1]) &&
      check.getUTCMonth() + 1 === Number(m[2]) &&
      check.getUTCDate() === Number(m[3]) &&
      check.getUTCHours() === Number(m[4]) &&
      check.getUTCMinutes() === Number(m[5]) &&
      check.getUTCSeconds() === Number(m[6]);
    if (!same) throw new DomainError('VALIDATION_FAILED', 'instant is not a valid calendar instant');
    return new Instant(ms);
  }

  toDate(): Date {
    return new Date(this.epochMillis);
  }

  plusMillis(ms: number): Instant {
    return Instant.ofEpochMillis(this.epochMillis + ms);
  }

  isBefore(other: Instant): boolean {
    return this.epochMillis < other.epochMillis;
  }

  equals(other: Instant): boolean {
    return this.epochMillis === other.epochMillis;
  }

  toString(): string {
    return new Date(this.epochMillis).toISOString();
  }

  toJSON(): string {
    return this.toString();
  }
}

/** Reloj inyectable (tests con reloj fijo; nunca `new Date()` directo en dominio/aplicación). */
export interface Clock {
  now(): Instant;
}

export const systemClock: Clock = { now: () => Instant.ofEpochMillis(Date.now()) };

/** Reloj controlable para tests. */
export class FixedClock implements Clock {
  constructor(private current: Instant) {}
  now(): Instant {
    return this.current;
  }
  set(instant: Instant): void {
    this.current = instant;
  }
  advance(ms: number): void {
    this.current = this.current.plusMillis(ms);
  }
}
