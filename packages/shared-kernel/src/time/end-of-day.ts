import { DomainError } from '../errors/domain-error.js';
import { Instant } from './instant.js';
import { LocalDate } from './local-date.js';

/**
 * Offset (ms) de la zona IANA en un instante: (hora local como si fuera UTC) - instante. Sin librerías: `Intl`.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Formateador de la zona, construido una sola vez por zona: crear un `Intl.DateTimeFormat` cuesta ~0,05 ms y la
 * valoración de reportes pide el cierre de ~2 000 días por petición (fix-trends-report-perf). Una zona inválida lanza
 * al construirse y no se guarda.
 */
function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    if (formatters.size >= 64) formatters.clear(); // zonas IANA hay pocas; el tope evita crecer sin límite
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function offsetMs(epochMs: number, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterOf(timeZone).formatToParts(new Date(epochMs));
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
