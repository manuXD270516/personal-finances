import { DomainError, type Instant } from '@pf/shared-kernel';

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SECONDS_PER_DAY = 86_400;

const secondsOfDay = (hhmm: string): number => {
  const m = HH_MM.exec(hhmm);
  if (!m) throw new DomainError('VALIDATION_FAILED', 'quiet hours must be HH:mm (00:00–23:59)');
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
};

/** Segundos transcurridos del día local de `instant` en la zona IANA (sin librerías: `Intl`). */
export function localSecondsOfDay(instant: Instant, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant.toDate());
  } catch (cause) {
    throw new DomainError('INVALID_TIMEZONE', `invalid IANA time zone '${timeZone}'`, { cause });
  }
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 3600 + get('minute') * 60 + get('second');
}

/**
 * Horario de silencio (FR-NOTIFY-003, design decisión 10): `[start, end)` en la zona horaria del usuario, que puede
 * cruzar la medianoche (22:00–07:00). Solo difiere el email; el in-app se crea siempre en el momento.
 */
export class QuietHours {
  private constructor(
    readonly start: string,
    readonly end: string,
  ) {}

  /** Rechaza formatos que no sean `HH:mm` y horarios de inicio igual al fin (ventana vacía o de 24 h ambigua). */
  static of(start: string, end: string): QuietHours {
    const s = secondsOfDay(start);
    const e = secondsOfDay(end);
    if (s === e) {
      throw new DomainError('VALIDATION_FAILED', 'quiet hours start and end must differ').at('/quietHours');
    }
    return new QuietHours(start, end);
  }

  /** ¿`instant` cae dentro del horario de silencio en la zona del usuario? */
  contains(instant: Instant, timeZone: string): boolean {
    const now = localSecondsOfDay(instant, timeZone);
    const s = secondsOfDay(this.start);
    const e = secondsOfDay(this.end);
    return s < e ? now >= s && now < e : now >= s || now < e;
  }

  /**
   * Primer instante permitido para enviar: `instant` si está fuera del horario; si no, el instante en que la hora
   * local llega a `end`. Nunca es anterior a `instant`. Ante un cambio de horario (DST) puede desviarse una hora: el
   * despacho vuelve a evaluar el horario vigente (decisión 10).
   */
  nextAllowed(instant: Instant, timeZone: string): Instant {
    if (!this.contains(instant, timeZone)) return instant;
    const now = localSecondsOfDay(instant, timeZone);
    const e = secondsOfDay(this.end);
    const wait = (((e - now) % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
    return instant.plusMillis(wait * 1000);
  }
}
