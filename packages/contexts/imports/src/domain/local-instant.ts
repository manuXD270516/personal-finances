import { DomainError, Instant, LocalDate, endOfDayInstant } from '@pf/shared-kernel';

/**
 * Instante de ejecución de un movimiento importado (openspec add-import-pipeline decisión 12; D326): con la hora de la
 * fila (`HH:mm` o `HH:mm:ss`, BCP y Ganadero la traen) es esa hora local en la zona del workspace; sin hora, el FIN
 * del día de negocio (23:59:59.999 local), de modo que la conversión toma la última tasa registrada ese día. Sin
 * librerías: `Intl`.
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

const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

export function executionInstant(date: string, time: string | null, timeZone: string): Instant {
  if (time === null) return endOfDayInstant(date, timeZone);
  const m = TIME.exec(time);
  if (!m) return endOfDayInstant(date, timeZone);
  const d = LocalDate.parse(date);
  const localAsUtc = Date.UTC(d.year, d.month - 1, d.day, Number(m[1]), Number(m[2]), Number(m[3] ?? 0));
  let guess = localAsUtc - offsetMs(localAsUtc, timeZone);
  guess = localAsUtc - offsetMs(guess, timeZone);
  return Instant.ofEpochMillis(guess);
}
