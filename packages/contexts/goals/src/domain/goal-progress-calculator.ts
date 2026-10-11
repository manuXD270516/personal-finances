import {
  MoneyDecimal,
  convertExact,
  dec,
  present,
  type Decimal,
  type ExactRate,
  type Money,
} from '@pf/shared-kernel';

/** Porcentaje a 2 decimales, HALF_EVEN (solo al presentar). */
export const presentPercent = (value: Decimal): string =>
  value.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_EVEN).toFixed(2);

/** `part ÷ whole × 100` sin redondear (precisión 40). */
export const percentOf = (part: Decimal, whole: Decimal): Decimal => part.times(100).div(whole);

export interface GoalProgressInput {
  /** Objetivo de la meta, en su moneda. */
  readonly target: Money;
  /** Σ exacta de TODOS los movimientos de la meta por moneda (INV-018); las nulas pueden omitirse. */
  readonly sums: readonly Money[];
  /**
   * Tasa de valoración vigente al consultar (stock; FX, docs/14 §5) para convertir una moneda a la del objetivo;
   * `null` si no hay (nunca 1:1).
   */
  readonly rateFor: (currency: string) => ExactRate | null;
}

export interface GoalProgress {
  /** Σ por moneda de los movimientos, ordenado por código. */
  readonly byCurrency: readonly Money[];
  /** Saldo acumulado convertido a la moneda del objetivo SIN redondear (parte convertida). */
  readonly totalExact: Decimal;
  /** `totalExact` a la escala de la moneda del objetivo (HALF_EVEN). */
  readonly total: Money;
  /** Porcentaje completado sin redondear (puede superar 100). */
  readonly percentExact: Decimal;
  /** Porcentaje a 2 decimales (HALF_EVEN). */
  readonly percent: string;
  /** Restante (objetivo − acumulado, no negativo) sin redondear. */
  readonly remainingExact: Decimal;
  readonly remaining: Money;
  /** `false` si algún fondo quedó sin convertir por falta de tasa. */
  readonly complete: boolean;
  /** Σ por moneda de los fondos sin tasa (nunca se convierten a 1:1). */
  readonly unconverted: readonly Money[];
  /** Monedas distintas de la del objetivo que sí se convirtieron (para informar las tasas usadas). */
  readonly convertedCurrencies: readonly string[];
}

/**
 * `GoalProgressCalculator` (openspec add-savings-goals, decisión 11; FR-GOALS-003, FR-GOALS-007): saldo acumulado por
 * moneda, conversión de cada moneda ajena UNA vez con la tasa vigente (exacta, nunca una inversa redondeada),
 * porcentaje y restante. Sin redondeo intermedio (precisión 40); HALF_EVEN solo al presentar.
 */
export function calculateProgress(input: GoalProgressInput): GoalProgress {
  const { target } = input;
  const byCurrency = new Map<string, Money>();
  for (const m of input.sums) {
    const prev = byCurrency.get(m.currency.code);
    byCurrency.set(m.currency.code, prev ? prev.add(m) : m);
  }
  const ordered = [...byCurrency.values()].sort((a, b) => (a.currency.code < b.currency.code ? -1 : 1));
  let total = dec('0');
  const unconverted: Money[] = [];
  const converted: string[] = [];
  for (const sum of ordered) {
    if (sum.isZero()) continue;
    if (sum.currency.code === target.currency.code) {
      total = total.plus(sum.amount);
      continue;
    }
    const rate = input.rateFor(sum.currency.code);
    if (!rate) {
      unconverted.push(sum);
      continue;
    }
    total = total.plus(convertExact(sum, target.currency, rate));
    converted.push(sum.currency.code);
  }
  const targetExact = target.toDecimal();
  const percentExact = percentOf(total, targetExact);
  const shortfall = targetExact.minus(total);
  const remainingExact = shortfall.isNegative() ? dec('0') : shortfall;
  return {
    byCurrency: ordered,
    totalExact: total,
    total: present(total, target.currency),
    percentExact,
    percent: presentPercent(percentExact),
    remainingExact,
    remaining: present(remainingExact, target.currency),
    complete: unconverted.length === 0,
    unconverted,
    convertedCurrencies: converted,
  };
}
