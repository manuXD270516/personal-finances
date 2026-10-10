import { DomainError, MoneyDecimal, dec, type Decimal, type Money } from '@pf/shared-kernel';

/** Resultado de comparar un cargo con el precio vigente (openspec add-subscriptions, decisión 8; docs/35 D137, D144). */
export const CHARGE_OUTCOMES = [
  'WITHIN_TOLERANCE',
  'PRICE_CHANGE_DETECTED',
  'NOT_COMPARABLE',
  'VOIDED',
] as const;
export type ChargeOutcome = (typeof CHARGE_OUTCOMES)[number];

export interface ChargeEvaluation {
  readonly outcome: Exclude<ChargeOutcome, 'VOIDED'>;
  /** Variación con signo en % (HALF_EVEN, 2 decimales); `null` si no es comparable. */
  readonly deviationPercent: string | null;
  /** Tasa implícita (cobrado / precio) a 18 decimales; solo `NOT_COMPARABLE`. */
  readonly impliedRate: string | null;
}

/** Máxima precisión de `numeric(38,18)`. */
const RATE_SCALE = 18;
const HUNDRED = new MoneyDecimal(100);

/** Tolerancia en % como texto decimal 0.00–50.00; el límite superior es el del contrato (`numeric(5,2)`). */
export function parseTolerance(value: string): string {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) {
    throw new DomainError('VALIDATION_FAILED', 'tolerance must be a percentage between 0.00 and 50.00').at(
      '/priceTolerancePercent',
    );
  }
  const tolerance = dec(value);
  if (tolerance.lt(0) || tolerance.gt(50)) {
    throw new DomainError('VALIDATION_FAILED', 'tolerance must be a percentage between 0.00 and 50.00').at(
      '/priceTolerancePercent',
    );
  }
  return tolerance.toFixed(2);
}

/** Variación porcentual con signo a precisión completa: (nuevo − anterior) / anterior × 100. */
export function changePercent(previous: Decimal, next: Decimal): Decimal {
  return next.minus(previous).div(previous).times(HUNDRED);
}

/** Texto con signo y 2 decimales HALF_EVEN: `+20.02`, `-3.50`, `+0.00`. */
export function formatSignedPercent(value: Decimal): string {
  const rounded = value.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_EVEN);
  const text = rounded.abs().toFixed(2);
  return rounded.isNeg() && !rounded.isZero() ? `-${text}` : `+${text}`;
}

/**
 * Detector puro de cambios de precio. Compara el monto cobrado con el precio VIGENTE en la fecha nominal del cargo:
 *  - misma moneda: `|cobrado − precio| / precio × 100` en Decimal de precisión 40; propone solo si es ESTRICTAMENTE
 *    mayor que la tolerancia, comparada sin redondeo intermedio (252.51 sobre 250.00 supera 1.00 % aunque se
 *    muestre 1.00);
 *  - moneda distinta: no comparable; solo registra la tasa implícita (docs/35 D137, RISK-017). Nunca 1:1.
 */
export const PriceChangeDetector = {
  evaluate(input: {
    readonly expected: Money;
    readonly charged: Money;
    readonly tolerancePercent: string;
  }): ChargeEvaluation {
    const { expected, charged } = input;
    if (!expected.isPositive()) {
      throw new DomainError('AMOUNT_NOT_POSITIVE', 'the expected price must be positive');
    }
    if (expected.currency.code !== charged.currency.code) {
      return {
        outcome: 'NOT_COMPARABLE',
        deviationPercent: null,
        impliedRate: charged.amount
          .div(expected.amount)
          .toDecimalPlaces(RATE_SCALE, MoneyDecimal.ROUND_HALF_EVEN)
          .toFixed(),
      };
    }
    const change = changePercent(expected.amount, charged.amount);
    const exceeds = change.abs().gt(dec(parseTolerance(input.tolerancePercent)));
    return {
      outcome: exceeds ? 'PRICE_CHANGE_DETECTED' : 'WITHIN_TOLERANCE',
      deviationPercent: formatSignedPercent(change),
      impliedRate: null,
    };
  },
} as const;

/** Tasa implícita para presentar: 4 decimales HALF_EVEN (`9.8726 BOB por USD`). */
export function presentImpliedRate(rate: string): string {
  return dec(rate).toDecimalPlaces(4, MoneyDecimal.ROUND_HALF_EVEN).toFixed(4);
}
