import { dec, present, type Currency, type Decimal, type Money } from '@pf/shared-kernel';
import { PeriodComparator } from './period-comparator.js';

/** Variación de una categoría de los tops frente al periodo de comparación (Q7, openspec add-cash-flow-forecast; D389). */
export interface CategoryVariationValue {
  /** `actual − anterior`, a la escala de la moneda de reporte (HALF_EVEN solo al presentar). */
  readonly amount: Money;
  /** Porcentaje con dos decimales HALF_EVEN; `null` si el monto anterior es cero. */
  readonly percent: string | null;
  /** Nada en el periodo anterior y algo en el actual. */
  readonly isNew: boolean;
  /** En los gastos un aumento es desfavorable; en los ingresos, favorable. */
  readonly direction: 'FAVORABLE' | 'UNFAVORABLE' | 'NONE';
}

export const CategoryVariation = {
  /** `previous = null` ⇒ no disponible (sin comparación o con un monto anterior sin tasa): devuelve `null`. */
  of(input: {
    readonly current: Decimal;
    readonly previous: Decimal | null;
    readonly nature: 'EXPENSE' | 'INCOME';
    readonly reporting: Currency;
  }): CategoryVariationValue | null {
    if (input.previous === null) return null;
    const v = PeriodComparator.variation(input.current, input.previous);
    const sign = v.deltaAbs.comparedTo(dec('0'));
    const direction: CategoryVariationValue['direction'] =
      sign === 0 ? 'NONE' : sign > 0 === (input.nature === 'INCOME') ? 'FAVORABLE' : 'UNFAVORABLE';
    return {
      amount: present(v.deltaAbs, input.reporting),
      percent: v.deltaPct,
      isNew: v.isNew,
      direction,
    };
  },
} as const;
