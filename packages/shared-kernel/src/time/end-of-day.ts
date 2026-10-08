import { DomainError } from '../errors/domain-error.js';
import { Instant } from './instant.js';
import { LocalDate } from './local-date.js';

/**
 * Offset (ms) de la zona IANA en un instante: (hora local como si fuera UTC) - instante. Sin librerías: `Intl`.
 */
function offsetMs(epochMs: number, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(epochMs));
  } catch (cause) {
    throw new DomainError('INVALID_TIMEZONE', `invalid IANA time zone '${timeZone}'`, { cause });
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - Math.floor(epochMs / 1000) * 1000;
}

/**
 * Último instante del día de negocio `date` en la zona del workspace (23:59:59.999 local): la tasa "vigente al cierre
 * de ese día" de los flujos (`conv_t`, docs/14 §5). Dos iteraciones bastan ante cambios de horario.
 */
export function endOfDayInstant(date: string, timeZone: string): Instant {
  const d = LocalDate.parse(date);
  const nextMidnightLocal = Date.UTC(d.year, d.month - 1, d.day + 1);
  let guess = nextMidnightLocal - offsetMs(nextMidnightLocal, timeZone);
  guess = nextMidnightLocal - offsetMs(guess, timeZone);
  return Instant.ofEpochMillis(guess - 1);
}
