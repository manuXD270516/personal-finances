import { LocalDate } from '@pf/shared-kernel';
import { spanishMonth } from './spanish-months.js';

/**
 * Fechas y horas exactas de los diseños (decisión 9): formato declarado por el diseño y validación de calendario
 * (`31/02` ⇒ `INVALID`). Sin `Date`, sin locale, sin zona. La fecha de negocio es la fecha literal impresa.
 */
export type PdfDateFormat = 'YYYYMMDD' | 'DD/MM/YYYY' | 'DD-MM-YYYY';
export type PdfTimeFormat = 'HH:mm:ss' | 'HH:mm';

export type DateParse =
  /** La forma coincide y el día existe. */
  | { readonly kind: 'OK'; readonly iso: string }
  /** La forma es de fecha pero el calendario la rechaza. */
  | { readonly kind: 'INVALID' }
  | { readonly kind: 'NOT_DATE' };

const digits = (s: string): boolean => s !== '' && [...s].every((c) => c >= '0' && c <= '9');

function build(y: string, m: string, d: string): DateParse {
  try {
    return { kind: 'OK', iso: LocalDate.of(Number(y), Number(m), Number(d)).toString() };
  } catch {
    return { kind: 'INVALID' };
  }
}

export function parsePdfDate(text: string, format: PdfDateFormat): DateParse {
  const t = text.trim();
  switch (format) {
    case 'YYYYMMDD':
      return t.length === 8 && digits(t)
        ? build(t.slice(0, 4), t.slice(4, 6), t.slice(6, 8))
        : { kind: 'NOT_DATE' };
    case 'DD/MM/YYYY':
    case 'DD-MM-YYYY': {
      const sep = format === 'DD/MM/YYYY' ? '/' : '-';
      const p = t.split(sep);
      if (p.length !== 3) return { kind: 'NOT_DATE' };
      const [d, m, y] = p as [string, string, string];
      if (d.length !== 2 || m.length !== 2 || y.length !== 4 || !digits(d) || !digits(m) || !digits(y)) {
        return { kind: 'NOT_DATE' };
      }
      return build(y, m, d);
    }
  }
}

/** Hora local `HH:mm:ss` (la de `HH:mm` se completa con `:00`); `null` si no cumple el formato o el rango. */
export function parsePdfTime(text: string, format: PdfTimeFormat): string | null {
  const p = text
    .trim()
    .replace(/\s*hs\.?$/iu, '')
    .split(':');
  const expected = format === 'HH:mm:ss' ? 3 : 2;
  if (p.length !== expected || p.some((x) => x.length !== 2 || !digits(x))) return null;
  const [h, m, s = '00'] = p as [string, string, string?];
  if (Number(h) > 23 || Number(m) > 59 || Number(s) > 59) return null;
  return `${h}:${m}:${s}`;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `Marzo 2026` ⇒ `2026-03-01..2026-03-31`. */
export function parseMonthYear(text: string): { from: string; to: string } | null {
  const parts = text.trim().split(/\s+/u);
  if (parts.length !== 2) return null;
  const month = spanishMonth(parts[0] as string);
  const year = parts[1] as string;
  if (month === null || year.length !== 4 || !digits(year)) return null;
  const from = build(year, String(month), '1');
  const to = build(year, String(month), String(daysInMonth(Number(year), month)));
  return from.kind === 'OK' && to.kind === 'OK' ? { from: from.iso, to: to.iso } : null;
}

/** `01 de marzo, 2026` ⇒ `2026-03-01`. */
export function parseLongDate(text: string): string | null {
  const tokens = text
    .replace(/,/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter((t) => t.toLowerCase() !== 'de');
  if (tokens.length !== 3) return null;
  const [d, mName, y] = tokens as [string, string, string];
  const month = spanishMonth(mName);
  if (month === null || !digits(d) || y.length !== 4 || !digits(y)) return null;
  const r = build(y, String(month), d);
  return r.kind === 'OK' ? r.iso : null;
}
