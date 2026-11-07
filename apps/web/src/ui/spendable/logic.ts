import type { Money } from '../common/fx-types';
import { isNegative, isZero } from '../dashboard/format';
import type { SpendableCurrencyTerms, SpendableSummary } from './types';

/** Días del periodo a partir del cual la tarjeta enlaza a los próximos pagos del periodo siguiente (design.md decisión 11). */
export const PERIOD_END_LINK_DAYS = 7;

export const SPENDABLE_PATH = '/disponible';
export const UPCOMING_PATH = '/pagos-proximos';
export const BUDGETS_PATH = '/planificacion/presupuestos';
export const SPENDABLE_SETTINGS_PATH = '/disponible/ajustes';

/** Término que resta del disponible, mostrado con signo negativo (`−5000.00`); un cero no lleva signo. */
export function subtracted(money: Money): Money {
  if (isZero(money.amount)) return money;
  return {
    currency: money.currency,
    amount: money.amount.startsWith('-') ? money.amount.slice(1) : `-${money.amount}`,
  };
}

/** Fecha de negocio `YYYY-MM-DD` de un instante en la zona del workspace (RISK-020: nunca la zona del navegador). */
export function businessDateOf(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Días que faltan para el fin del periodo (0 el último día); negativo si ya pasó. */
export function daysUntil(end: string, generatedAt: string, timeZone: string): number {
  return dayNumber(end) - dayNumber(businessDateOf(generatedAt, timeZone));
}

/** Cerca del fin del periodo la tarjeta enlaza a Q8 ("próximos pagos del periodo siguiente"). */
export const nearPeriodEnd = (end: string, generatedAt: string, timeZone: string): boolean => {
  const days = daysUntil(end, generatedAt, timeZone);
  return days >= 0 && days <= PERIOD_END_LINK_DAYS;
};

/** El disponible de una moneda está en negativo (se muestra con signo y alerta, nunca como 0.00). */
export const isShort = (terms: SpendableCurrencyTerms): boolean => isNegative(terms.spendable.amount);

/**
 * Horizonte usado por el disponible: el periodo financiero (por omisión), «hasta el próximo ingreso» con su ocurrencia o
 * el respaldo de 30 días cuando no hay un ingreso esperado. `undefined` en una API anterior al horizonte.
 */
export type HorizonView =
  | { readonly kind: 'PERIOD'; readonly label: string; readonly from: string; readonly to: string }
  | {
      readonly kind: 'NEXT_INCOME';
      readonly name: string;
      readonly date: string;
      readonly from: string;
      readonly to: string;
    }
  | { readonly kind: 'FALLBACK'; readonly from: string; readonly to: string };

export function horizonView(summary: SpendableSummary): HorizonView | undefined {
  const h = summary.horizon;
  if (!h) return undefined;
  if (h.mode === 'NEXT_INCOME') {
    if (h.nextIncome && !h.fallback) {
      return {
        kind: 'NEXT_INCOME',
        name: h.nextIncome.name,
        date: h.nextIncome.date,
        from: h.from,
        to: h.to,
      };
    }
    return { kind: 'FALLBACK', from: h.from, to: h.to };
  }
  return { kind: 'PERIOD', label: summary.period.label, from: h.from, to: h.to };
}
