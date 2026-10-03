import { formatDecimal } from '../AuditHistory';
import type { Money, Translate } from './types';

/**
 * Formato de presentación del Home. La API ya entrega los montos redondeados (HALF_EVEN) a la escala de la moneda
 * de reporte: aquí solo se formatea el string decimal con los separadores del locale, sin pasar por `number`.
 */
export const formatMoney = (money: Money, locale: string): string =>
  `${formatDecimal(money.amount, locale)} ${money.currency}`;

/** `true` si el decimal es negativo (y distinto de cero). */
export const isNegative = (amount: string): boolean => amount.startsWith('-') && !isZero(amount);

/** `true` si el decimal es cero (`0`, `0.00`, `-0.00`). */
export const isZero = (amount: string): boolean => /^[-+]?0*(\.0*)?$/.test(amount);

/** Decimal con signo explícito (`+105,00`, `-30,00`, `0,00`). */
export function formatSignedDecimal(amount: string, locale: string): string {
  const unsigned = amount.replace(/^[-+]/, '');
  if (isZero(amount)) return formatDecimal(unsigned, locale);
  return `${amount.startsWith('-') ? '-' : '+'}${formatDecimal(unsigned, locale)}`;
}

export const formatSignedMoney = (money: Money, locale: string): string =>
  `${formatSignedDecimal(money.amount, locale)} ${money.currency}`;

/** Antigüedad legible de una tasa a partir de `ageSeconds` ("hace 6 min", "hace 8 h", "hace 3 d"). */
export function formatAge(ageSeconds: number, t: Translate): string {
  if (ageSeconds < 60) return t('age.now');
  if (ageSeconds < 3600) return t('age.minutes', { n: Math.floor(ageSeconds / 60) });
  if (ageSeconds < 86400) return t('age.hours', { n: Math.floor(ageSeconds / 3600) });
  return t('age.days', { n: Math.floor(ageSeconds / 86400) });
}

/** Instante en la zona horaria del workspace. */
export const formatInstant = (iso: string, locale: string, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    new Date(iso),
  );

/** Fecha de negocio `YYYY-MM-DD` (sin desplazamiento de zona). */
export const formatLocalDate = (date: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
