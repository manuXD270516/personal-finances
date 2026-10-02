import { DomainError } from '@pf/shared-kernel';

/** Alias IANA canónicos que `Intl.supportedValuesOf` puede no listar pero son válidos. */
const CANONICAL_ALIASES = new Set(['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT']);
const SHAPE = /^[A-Za-z][A-Za-z0-9_+\-/]*$/;
let supported: ReadonlySet<string> | undefined;

function isSupported(id: string): boolean {
  if (!SHAPE.test(id)) return false;
  supported ??= new Set(Intl.supportedValuesOf('timeZone'));
  if (supported.has(id) || CANONICAL_ALIASES.has(id)) return true;
  // Alias IANA válidos (p. ej. `America/Buenos_Aires`): el motor los acepta y los resuelve a un id canónico.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

/** Zona horaria IANA (`America/La_Paz`). Inválida → `INVALID_TIMEZONE`. */
export class TimeZoneId {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(value: string): TimeZoneId {
    if (typeof value !== 'string' || value.length === 0 || value.length > 64 || !isSupported(value)) {
      throw new DomainError('INVALID_TIMEZONE', `invalid IANA time zone '${String(value)}'`);
    }
    return new TimeZoneId(value);
  }

  equals(other: TimeZoneId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
