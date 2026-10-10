import { DomainError, dec } from '@pf/shared-kernel';
import type { AmountType } from '../types.js';

/** Ventana de fechas por omisión, en días (docs/35 D120). */
export const DEFAULT_DATE_WINDOW_DAYS = 5;
/** Rango admitido de la ventana configurable por definición. */
export const MAX_DATE_WINDOW_DAYS = 15;
/** Tolerancia de monto por omisión según el tipo de monto, en % (docs/35 D120). `VARIABLE` no compara monto. */
export const DEFAULT_AMOUNT_TOLERANCE_PCT: Readonly<Record<AmountType, string>> = {
  FIXED: '2',
  ESTIMATED: '25',
  MIN_MAX: '5',
  VARIABLE: '0',
};

/** Tolerancias efectivas con las que se compara una transacción con una ocurrencia. */
export interface MatchTolerances {
  /** Porcentaje (0..100) como texto decimal. */
  readonly amountTolerancePct: string;
  readonly dateWindowDays: number;
}

/** Anotación de la definición: `null` = usar el valor por omisión del tipo de monto. */
export interface MatchToleranceOverrides {
  readonly amountTolerancePct: string | null;
  readonly dateWindowDays: number | null;
}

export const NO_TOLERANCE_OVERRIDES: MatchToleranceOverrides = {
  amountTolerancePct: null,
  dateWindowDays: null,
};

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

/**
 * Valida la anotación de tolerancias de una definición: porcentaje en 0..100 con a lo sumo 2 decimales y ventana
 * entera en 0..15; `null` restablece el valor por omisión.
 */
export function validateToleranceOverrides(input: {
  readonly amountTolerancePercent?: string | null | undefined;
  readonly dateWindowDays?: number | null | undefined;
}): { amountTolerancePct?: string | null; dateWindowDays?: number | null } {
  const out: { amountTolerancePct?: string | null; dateWindowDays?: number | null } = {};
  if (input.amountTolerancePercent !== undefined) {
    if (input.amountTolerancePercent === null) {
      out.amountTolerancePct = null;
    } else {
      const text = String(input.amountTolerancePercent).trim();
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) {
        throw invalid(
          'amountTolerancePercent must be a decimal between 0 and 100 with at most 2 decimals',
          '/matching/amountTolerancePercent',
        );
      }
      const value = dec(text);
      if (value.lt(0) || value.gt(100)) {
        throw invalid('amountTolerancePercent must be between 0 and 100', '/matching/amountTolerancePercent');
      }
      out.amountTolerancePct = value.toFixed(2);
    }
  }
  if (input.dateWindowDays !== undefined) {
    if (input.dateWindowDays === null) {
      out.dateWindowDays = null;
    } else {
      const days = input.dateWindowDays;
      if (!Number.isInteger(days) || days < 0 || days > MAX_DATE_WINDOW_DAYS) {
        throw invalid(
          `dateWindowDays must be an integer between 0 and ${MAX_DATE_WINDOW_DAYS}`,
          '/matching/dateWindowDays',
        );
      }
      out.dateWindowDays = days;
    }
  }
  return out;
}

/** Tolerancias efectivas: la anotación de la definición manda sobre el valor por omisión del tipo de monto. */
export function resolveTolerances(type: AmountType, overrides: MatchToleranceOverrides): MatchTolerances {
  return {
    amountTolerancePct: overrides.amountTolerancePct ?? DEFAULT_AMOUNT_TOLERANCE_PCT[type],
    dateWindowDays: overrides.dateWindowDays ?? DEFAULT_DATE_WINDOW_DAYS,
  };
}
