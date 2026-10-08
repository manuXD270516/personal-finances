import {
  convertExact,
  dec,
  FlowValuation,
  sumByCurrency,
  type Consolidated,
  type Currency,
  type DatedAmount,
  type ExactRate,
  type Money,
} from '@pf/shared-kernel';

export type { Consolidated, DatedAmount };

/**
 * DS `ConsolidationService` (docs/14 §5, design.md decisión 3), puro:
 *   - stocks (`conv_v`): Σ por moneda → UNA conversión por moneda con la tasa de valoración;
 *   - flujos (`conv_t`): Σ por día y moneda → UNA conversión por agregado con la tasa vigente al cierre de ese día.
 * Sin redondeo intermedio; los montos sin tasa se excluyen y se informan en su moneda original.
 */
export const ConsolidationService = {
  consolidate(
    amounts: readonly Money[],
    target: Currency,
    rateFor: (currency: string) => ExactRate | null,
  ): Consolidated {
    let total = dec('0');
    const unconverted: Money[] = [];
    const converted: string[] = [];
    for (const sum of sumByCurrency(amounts)) {
      if (sum.isZero()) continue;
      if (sum.currency.code === target.code) {
        total = total.plus(sum.amount);
        continue;
      }
      const rate = rateFor(sum.currency.code);
      if (!rate) {
        unconverted.push(sum);
        continue;
      }
      total = total.plus(convertExact(sum, target, rate));
      converted.push(sum.currency.code);
    }
    return { total, complete: unconverted.length === 0, unconverted, convertedCurrencies: converted };
  },

  /** Flujos fechados: la implementación vive en `FlowValuation` (shared-kernel, docs/33 D109). */
  consolidateFlows(
    rows: readonly DatedAmount[],
    target: Currency,
    rateFor: (currency: string, date: string) => ExactRate | null,
  ): Consolidated {
    return FlowValuation.consolidate(rows, target, rateFor);
  },
} as const;
