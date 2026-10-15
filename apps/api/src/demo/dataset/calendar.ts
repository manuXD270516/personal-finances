/** Aritmética de fechas de negocio `YYYY-MM-DD` sin reloj (determinista; UTC solo como calendario). */
const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(value: string): { readonly y: number; readonly m: number; readonly d: number } {
  const match = DATE.exec(value);
  if (!match) throw new RangeError(`fecha inválida: ${value}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function epochDay(value: string): number {
  const { y, m, d } = parseDate(value);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromEpochDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  return fromEpochDay(epochDay(value) + days);
}

export function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = domingo … 6 = sábado. */
export function weekday(value: string): number {
  return new Date(epochDay(value) * DAY_MS).getUTCDay();
}

/** Último día hábil (lunes a viernes) del mes. */
export function lastBusinessDay(y: number, m: number): string {
  let date = ymd(y, m, daysInMonth(y, m));
  while (weekday(date) === 0 || weekday(date) === 6) date = addDays(date, -1);
  return date;
}

/** Mes `i` contando desde `start` (`YYYY-MM`). */
export function monthAt(
  startYear: number,
  startMonth: number,
  i: number,
): { readonly y: number; readonly m: number } {
  const index = startYear * 12 + (startMonth - 1) + i;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

/** Último día de un mes (`YYYY-MM-DD` de `y`-`m`). */
export function monthEnd(y: number, m: number): string {
  return ymd(y, m, daysInMonth(y, m));
}

/**
 * Paso de `months` meses (negativo = hacia atrás) con el mismo día del mes; si el mes destino no tiene ese día,
 * el último día del mes (misma regla que los cronogramas de los motores; design.md decisión 4).
 */
export function addMonthsClamped(value: string, months: number): string {
  const { y, m, d } = parseDate(value);
  const target = monthAt(y, m, months);
  return ymd(target.y, target.m, Math.min(d, daysInMonth(target.y, target.m)));
}

/** Primer día del mes de `value`. */
export function monthStart(value: string): string {
  const { y, m } = parseDate(value);
  return ymd(y, m, 1);
}

/** Día del mes de `value` (1..31). */
export function dayOfMonth(value: string): number {
  return parseDate(value).d;
}

/** `YYYY-MM-DD` con el día `day` del mes de `value` (último día si no existe). */
export function withDay(value: string, day: number): string {
  const { y, m } = parseDate(value);
  return ymd(y, m, Math.min(day, daysInMonth(y, m)));
}
