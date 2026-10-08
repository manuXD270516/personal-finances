import { type LocalDate, Money, MoneyDecimal, dec, type Currency, type Decimal } from '@pf/shared-kernel';
import {
  PROJECTING_KINDS,
  ROLLOVER_KINDS,
  type BudgetLineKind,
  type BudgetNature,
  type TargetKind,
} from './budget-types.js';
import { RolloverCalculator } from './rollover-calculator.js';

/**
 * Estado de una línea (texto + icono en la UI, nunca solo color: NFR-USAB-104):
 * `UNDER | ON_TARGET | OVER` (FIXED), `WITHIN | OVER` (MAXIMUM, PERCENT_OF_INCOME), `BELOW | WITHIN | ABOVE` (RANGE),
 * `PENDING | MET` (MINIMUM) y `NO_BUDGET` (referencia 0.00).
 */
export type LineStatus =
  'UNDER' | 'ON_TARGET' | 'OVER' | 'WITHIN' | 'BELOW' | 'ABOVE' | 'PENDING' | 'MET' | 'NO_BUDGET';

export interface LineProgressInput {
  readonly kind: BudgetLineKind;
  readonly nature: BudgetNature;
  readonly currency: Currency;
  readonly planned: Decimal | null;
  readonly min: Decimal | null;
  readonly max: Decimal | null;
  readonly percent: Decimal | null;
  /** Base del `PERCENT_OF_INCOME` (ingresos esperados o reales, ya convertidos); `null` si no aplica. */
  readonly incomeBase: Decimal | null;
  /** Remanente recibido del periodo anterior (solo líneas de gasto con rollover). */
  readonly rolloverIn: Decimal | null;
  /** Gastado (o ingresado) del periodo, convertido a la moneda del plan y SIN redondear. */
  readonly actual: Decimal;
  readonly period: { readonly start: LocalDate; readonly end: LocalDate };
  /** Hoy en la zona horaria del workspace. */
  readonly today: LocalDate;
}

export interface LineProgress {
  /** Referencia contra la que se mide: planificado efectivo (FIXED/MAXIMUM/PERCENT), máximo (RANGE) o mínimo (MINIMUM). */
  readonly reference: Money;
  readonly effectivePlanned: Money;
  /** Mínimo del rango (`RANGE`) o del mínimo (`MINIMUM`). */
  readonly minimum: Money | null;
  readonly actual: Money;
  /** `referencia - gastado` (negativo cuando se excede). */
  readonly remaining: Money;
  /** `real - referencia` (líneas de ingreso: -1500.00 si falta recibir 1500.00). */
  readonly difference: Money;
  /** `gastado / referencia x 100` con 1 decimal HALF_EVEN; `null` si la referencia es 0.00. */
  readonly utilization: string | null;
  /** Proyección lineal al fin del periodo: solo MAXIMUM, RANGE y PERCENT_OF_INCOME (docs/33 D83). */
  readonly projection: Money | null;
  readonly status: LineStatus;
}

export interface AggregateLine {
  readonly nature: BudgetNature;
  readonly targetKind: TargetKind;
  readonly progress: LineProgress;
}

export interface PlanTotals {
  readonly planned: Money;
  readonly actual: Money;
  readonly remaining: Money;
  readonly availableToSpend: Money;
  readonly expectedIncome: Money;
  readonly actualIncome: Money;
  /** Solo en modo base cero: ingresos esperados - planificado de gasto (negativo si se asignó de más). */
  readonly toAssign: Money | null;
}

const DAY_MS = 86_400_000;
const epochDay = (d: LocalDate): number => Date.UTC(d.year, d.month - 1, d.day) / DAY_MS;
const present = (value: Decimal, currency: Currency): Money =>
  Money.roundToScale(value, currency, 'HALF_EVEN');

/**
 * DS `BudgetProgressCalculator` (design decisión 6), puro: planificado efectivo, restante, porcentaje, proyección,
 * estado y totales del plan. Decimal precisión 40; HALF_EVEN solo al materializar (INV-001/INV-020).
 */
export const BudgetProgressCalculator = {
  line(input: LineProgressInput): LineProgress {
    const { currency, kind } = input;
    const zero = dec('0');
    let base: Decimal;
    switch (kind) {
      case 'FIXED':
      case 'MAXIMUM':
        base = input.planned ?? zero;
        break;
      case 'MINIMUM':
        base = input.min ?? zero;
        break;
      case 'RANGE':
        base = input.max ?? zero;
        break;
      case 'PERCENT_OF_INCOME':
        // round_HALF_EVEN(percent / 100 x base) a la escala de la moneda del plan.
        base = present(
          (input.percent ?? zero).div(100).times(input.incomeBase ?? zero),
          currency,
        ).toDecimal();
        break;
    }
    const rollover = input.nature === 'EXPENSE' && ROLLOVER_KINDS.includes(kind) ? input.rolloverIn : null;
    const effective = RolloverCalculator.effectivePlanned(base, rollover);
    const effectivePlanned = present(effective, currency);
    const reference = effectivePlanned;
    const actual = present(input.actual, currency);
    const remaining = reference.subtract(actual);
    const difference = actual.subtract(reference);
    const minimum = kind === 'RANGE' || kind === 'MINIMUM' ? present(input.min ?? zero, currency) : null;

    const utilization = reference.isZero()
      ? null
      : actual.amount
          .div(reference.amount)
          .times(100)
          .toDecimalPlaces(1, MoneyDecimal.ROUND_HALF_EVEN)
          .toFixed(1);

    return {
      reference,
      effectivePlanned,
      minimum,
      actual,
      remaining,
      difference,
      utilization,
      projection: BudgetProgressCalculator.projection(input, actual),
      status: BudgetProgressCalculator.status(kind, reference, minimum, actual),
    };
  },

  /**
   * Proyección lineal `gastado / días transcurridos x días del periodo` (días en la zona del workspace, hoy incluido);
   * `= gastado` si el periodo terminó; `null` si no empezó. Solo MAXIMUM/RANGE/PERCENT_OF_INCOME de gasto: las líneas
   * FIXED y MINIMUM no proyectan (un alquiler pagado el día 1 no vale 30x; docs/33 D83).
   */
  projection(input: LineProgressInput, actual: Money): Money | null {
    if (input.nature !== 'EXPENSE' || !PROJECTING_KINDS.includes(input.kind)) return null;
    const { start, end } = input.period;
    if (input.today.compare(start) < 0) return null;
    if (input.today.compare(end) > 0) return actual;
    const periodDays = epochDay(end) - epochDay(start) + 1;
    const elapsed = epochDay(input.today) - epochDay(start) + 1;
    return present(input.actual.div(elapsed).times(periodDays), input.currency);
  },

  status(kind: BudgetLineKind, reference: Money, minimum: Money | null, actual: Money): LineStatus {
    if (reference.isZero()) return 'NO_BUDGET';
    const cmp = actual.compare(reference);
    switch (kind) {
      case 'FIXED':
        return cmp < 0 ? 'UNDER' : cmp === 0 ? 'ON_TARGET' : 'OVER';
      case 'MAXIMUM':
      case 'PERCENT_OF_INCOME':
        return cmp <= 0 ? 'WITHIN' : 'OVER';
      case 'RANGE':
        if (minimum !== null && actual.compare(minimum) < 0) return 'BELOW';
        return cmp <= 0 ? 'WITHIN' : 'ABOVE';
      case 'MINIMUM':
        return cmp < 0 ? 'PENDING' : 'MET';
    }
  },

  /**
   * Totales del plan (sin doble conteo: los objetivos no se solapan salvo los tags, que son transversales y NO entran
   * en planificado, gastado ni disponible). `disponible = Σ max(0, referencia - gastado)` sobre categorías y grupos
   * de gasto; `porAsignar = ingresos esperados - planificado de gasto` en modo base cero.
   */
  totals(lines: readonly AggregateLine[], currency: Currency, zeroBased: boolean): PlanTotals {
    let planned = Money.zero(currency);
    let actual = Money.zero(currency);
    let available = Money.zero(currency);
    let expectedIncome = Money.zero(currency);
    let actualIncome = Money.zero(currency);
    for (const l of lines) {
      const p = l.progress;
      if (l.nature === 'INCOME') {
        expectedIncome = expectedIncome.add(p.reference);
        actualIncome = actualIncome.add(p.actual);
        continue;
      }
      if (l.targetKind === 'TAG') continue;
      planned = planned.add(p.reference);
      actual = actual.add(p.actual);
      if (p.remaining.isPositive()) available = available.add(p.remaining);
    }
    return {
      planned,
      actual,
      remaining: planned.subtract(actual),
      availableToSpend: available,
      expectedIncome,
      actualIncome,
      toAssign: zeroBased ? expectedIncome.subtract(planned) : null,
    };
  },
} as const;
