import { dec, type Currency, type Decimal, type Money } from '@pf/shared-kernel';
import { convertExact, sumByCurrency, type ExactRate } from './valuation.js';

/** Resultado de consolidar en la moneda de reporte, SIN redondear. */
export interface Consolidated {
  /** Σ convertida a precisión completa (se redondea solo al presentar). */
  readonly total: Decimal;
  /** `false` si algún monto no nulo quedó sin tasa. */
  readonly complete: boolean;
  /** Montos nativos excluidos por falta de tasa, Σ por moneda, ordenados por código (nunca 1:1). */
  readonly unconverted: readonly Money[];
  /** Monedas distintas de la de reporte que sí se convirtieron (para informar las tasas usadas). */
  readonly convertedCurrencies: readonly string[];
}

/** Flujo fechado (fecha de negocio `YYYY-MM-DD`) para la conversión con la tasa de su fecha (`conv_t`). */
export interface DatedAmount {
  readonly date: string;
  readonly amount: Money;
}

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

  consolidateFlows(
    rows: readonly DatedAmount[],
    target: Currency,
    rateFor: (currency: string, date: string) => ExactRate | null,
  ): Consolidated {
    const byDay = new Map<string, Money>();
    for (const r of rows) {
      const key = `${r.date}|${r.amount.currency.code}`;
      const prev = byDay.get(key);
      byDay.set(key, prev ? prev.add(r.amount) : r.amount);
    }
    let total = dec('0');
    const missing: Money[] = [];
    const converted = new Set<string>();
    for (const key of [...byDay.keys()].sort()) {
      const sum = byDay.get(key) as Money;
      const date = key.slice(0, key.indexOf('|'));
      if (sum.isZero()) continue;
      if (sum.currency.code === target.code) {
        total = total.plus(sum.amount);
        continue;
      }
      const rate = rateFor(sum.currency.code, date);
      if (!rate) {
        missing.push(sum);
        continue;
      }
      total = total.plus(convertExact(sum, target, rate));
      converted.add(sum.currency.code);
    }
    const unconverted = sumByCurrency(missing).filter((m) => !m.isZero());
    return {
      total,
      complete: missing.length === 0,
      unconverted,
      convertedCurrencies: [...converted].sort(),
    };
  },
} as const;
