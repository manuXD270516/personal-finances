/**
 * Fechas en la zona del workspace (America/La_Paz por defecto, docs/28 §8.5): las fechas de negocio son
 * `YYYY-MM-DD` civiles (sin conversión de zona) y los instantes viajan en UTC (`…Z`).
 */

export const DEFAULT_TIME_ZONE = 'America/La_Paz';
export const DEFAULT_FORMAT_LOCALE = 'es-BO';

function partsIn(instant: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** Fecha de negocio de hoy en la zona del workspace. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const p = partsIn(now, timeZone);
  return `${p['year']}-${p['month']}-${p['day']}`;
}

/** Valor para `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`) del instante en la zona dada. */
export function localDateTimeIn(timeZone: string, now: Date = new Date()): string {
  const p = partsIn(now, timeZone);
  return `${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}`;
}

/** Desfase (ms) de la zona respecto de UTC en ese instante. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(
    Number(p['year']),
    Number(p['month']) - 1,
    Number(p['day']),
    Number(p['hour']),
    Number(p['minute']),
    Number(p['second']),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Hora local de la zona (`YYYY-MM-DDTHH:mm`) → instante RFC 3339 UTC (`…Z`, sin milisegundos), p. ej.
 * `2026-09-30T14:42` en La Paz (UTC−4) = `2026-09-30T18:42:00Z`. `null` si el valor no es válido.
 */
export function zonedLocalToInstant(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let utc = guess - offsetMs(new Date(guess), timeZone);
  utc = guess - offsetMs(new Date(utc), timeZone);
  return new Date(utc).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Rango del mes (`YYYY-MM-01`..último día) de una fecha de negocio. */
export function monthRange(date: string): { from: string; to: string } {
  const [y, mo] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const mm = String(mo).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}
