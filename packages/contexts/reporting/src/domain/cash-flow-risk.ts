import {
  convertExact,
  dec,
  present,
  Money,
  type Currency,
  type Decimal,
  type ExactRate,
} from '@pf/shared-kernel';
import type { CashFlowCurrencyBlock, CashFlowLowest } from './cash-flow-calendar.js';

/**
 * Riesgo de déficit por moneda y consolidado informativo del calendario (openspec add-cash-flow-forecast, design.md
 * decisiones 6, 8 y 9; docs/14 §8; FR-REPORTING-015). Puro: sin reloj ni E/S.
 */

export type CashFlowRisk = 'NONE' | 'LOW' | 'POSSIBLE' | 'HIGH';

/** Margen del riesgo `LOW`: 10 % del total de egresos del horizonte (D384, docs/14). */
export const LOW_RISK_MARGIN = dec('0.10');

export const CASH_FLOW_RISK_ORDER: Readonly<Record<CashFlowRisk, number>> = {
  NONE: 0,
  LOW: 1,
  POSSIBLE: 2,
  HIGH: 3,
};

export interface CashFlowRiskAssessment {
  readonly risk: CashFlowRisk;
  readonly threshold: Money;
  readonly thresholdSource: 'MINIMUM_RESERVE' | 'ZERO';
  /** Primera fecha con el saldo más bajo del día bajo el umbral (en la serie que determina el riesgo). */
  readonly firstShortfallDate: string | null;
  /** `umbral − saldo más bajo` de la serie que determina el riesgo. */
  readonly shortfallAmount: Money | null;
  /** El saldo más bajo de esa serie es negativo. */
  readonly belowZero: boolean;
}

/** Primera fecha de la serie con `low < umbral`. */
function firstBelow(series: readonly { date: string; low: Money }[], threshold: Money): string | null {
  return series.find((p) => p.low.compare(threshold) < 0)?.date ?? null;
}

export const CashFlowRiskPolicy = {
  /**
   * Umbral `τ_k` = reserva mínima de liquidez si está en la moneda `k`, 0 en otro caso (D214: la reserva vive en su moneda
   * y no se convierte). `HIGH` si `lowest < τ`; si no, `POSSIBLE` si con el gasto planificado `lowestPlanned < τ`; si no,
   * `LOW` si `lowest < τ + 10 % × egresos`; si no, `NONE`.
   */
  assess(block: CashFlowCurrencyBlock, minimumReserve: Money | null): CashFlowRiskAssessment {
    const reserve = minimumReserve?.currency.code === block.currency.code ? minimumReserve : null;
    const threshold = reserve ?? Money.zero(block.currency);
    const thresholdSource = reserve ? 'MINIMUM_RESERVE' : 'ZERO';
    const lowest = block.lowest.amount;
    if (lowest.compare(threshold) < 0) {
      return {
        risk: 'HIGH',
        threshold,
        thresholdSource,
        firstShortfallDate: firstBelow(block.series, threshold),
        shortfallAmount: threshold.subtract(lowest),
        belowZero: lowest.isNegative(),
      };
    }
    const planned = block.planned;
    if (planned && planned.lowest.amount.compare(threshold) < 0) {
      return {
        risk: 'POSSIBLE',
        threshold,
        thresholdSource,
        firstShortfallDate: firstBelow(planned.series, threshold),
        shortfallAmount: threshold.subtract(planned.lowest.amount),
        belowZero: planned.lowest.amount.isNegative(),
      };
    }
    const margin = block.outflowTotal.toDecimal().times(LOW_RISK_MARGIN);
    const limit = threshold.toDecimal().plus(margin);
    const risk: CashFlowRisk = lowest.toDecimal().lt(limit) ? 'LOW' : 'NONE';
    return {
      risk,
      threshold,
      thresholdSource,
      firstShortfallDate: null,
      shortfallAmount: null,
      belowZero: false,
    };
  },

  /** Moneda con el riesgo más alto (empate: mayor faltante, luego código); `null` si todas son `NONE`. */
  worst<
    T extends { readonly risk: CashFlowRisk; readonly shortfallAmount: Money | null; readonly code: string },
  >(list: readonly T[]): T | null {
    const risky = list.filter((c) => c.risk !== 'NONE');
    if (risky.length === 0) return null;
    return [...risky].sort((a, b) => {
      const byRisk = CASH_FLOW_RISK_ORDER[b.risk] - CASH_FLOW_RISK_ORDER[a.risk];
      if (byRisk !== 0) return byRisk;
      const sa = a.shortfallAmount?.toDecimal() ?? dec('0');
      const sb = b.shortfallAmount?.toDecimal() ?? dec('0');
      const byShortfall = sb.comparedTo(sa);
      return byShortfall !== 0 ? byShortfall : a.code < b.code ? -1 : 1;
    })[0] as T;
  },
} as const;

export interface CashFlowConsolidation {
  readonly lowest: CashFlowLowest | null;
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
  readonly convertedCurrencies: readonly string[];
}

export const CashFlowConsolidator = {
  /**
   * Saldo más bajo consolidado: `min_d Σ_k conv(low_k(d))` con la tasa de valoración vigente al consultar (una por moneda).
   * Una moneda sin tasa se excluye y el resultado queda incompleto (nunca 1:1); su mínimo propio se informa sin convertir.
   * Sin redondeo intermedio; HALF_EVEN solo al presentar. Informativo: no define el riesgo.
   */
  lowest(
    blocks: readonly CashFlowCurrencyBlock[],
    reporting: Currency,
    rateFor: (currency: string) => ExactRate | null,
  ): CashFlowConsolidation {
    const converters: { block: CashFlowCurrencyBlock; rate: ExactRate | null }[] = blocks.map((block) => ({
      block,
      rate: block.currency.code === reporting.code ? null : rateFor(block.currency.code),
    }));
    const included = converters.filter((c) => c.block.currency.code === reporting.code || c.rate !== null);
    const excluded = converters.filter((c) => !included.includes(c));
    const unconverted = excluded.map((c) => c.block.lowest.amount);
    if (included.length === 0) {
      return { lowest: null, complete: excluded.length === 0, unconverted, convertedCurrencies: [] };
    }
    const days = (included[0] as (typeof included)[number]).block.series.map((p) => p.date);
    let best: { value: Decimal; date: string } | null = null;
    days.forEach((date, i) => {
      let sum = dec('0');
      for (const { block, rate } of included) {
        const low = (block.series[i] as { low: Money }).low;
        sum = sum.plus(rate ? convertExact(low, reporting, rate) : low.toDecimal());
      }
      if (best === null || sum.lt(best.value)) best = { value: sum, date };
    });
    const found = best as { value: Decimal; date: string } | null;
    return {
      lowest: found ? { amount: present(found.value, reporting), date: found.date } : null,
      complete: excluded.length === 0,
      unconverted,
      convertedCurrencies: included.filter((c) => c.rate !== null).map((c) => c.block.currency.code),
    };
  },
} as const;

export interface CashFlowSuggestion {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  /** Equivalente aproximado en `fromCurrency` del faltante de `toCurrency` (HALF_EVEN). */
  readonly approxAmount: Money;
  readonly before: string;
  /** Tasa usada (para informarla). */
  readonly rate: ExactRate;
}

export const CashFlowSuggester = {
  /**
   * Sugerencia de conversión (Could): para cada moneda `k` con riesgo `HIGH`, otra moneda `j` cuyo saldo más bajo menos su
   * umbral cubre el faltante convertido con la tasa vigente `j → k`. Nunca ejecuta nada; el monto es aproximado.
   */
  suggest(input: {
    readonly blocks: readonly {
      readonly block: CashFlowCurrencyBlock;
      readonly assessment: CashFlowRiskAssessment;
    }[];
    /** Tasa exacta de 1 `from` en `to` (o la inversa orientada); `null` sin tasa vigente. */
    readonly rateFor: (from: string, to: string) => ExactRate | null;
  }): CashFlowSuggestion[] {
    const out: CashFlowSuggestion[] = [];
    for (const target of input.blocks) {
      if (target.assessment.risk !== 'HIGH' || target.assessment.shortfallAmount === null) continue;
      if (target.assessment.firstShortfallDate === null) continue;
      for (const source of input.blocks) {
        if (source.block.currency.code === target.block.currency.code) continue;
        const rate = input.rateFor(source.block.currency.code, target.block.currency.code);
        if (!rate) continue;
        // faltante (en k) → equivalente en j: se divide por la tasa j→k.
        const needed = convertExact(target.assessment.shortfallAmount, source.block.currency, rate);
        const spare = source.block.lowest.amount.toDecimal().minus(source.assessment.threshold.toDecimal());
        if (spare.lt(needed)) continue;
        out.push({
          fromCurrency: source.block.currency.code,
          toCurrency: target.block.currency.code,
          approxAmount: present(needed, source.block.currency),
          before: target.assessment.firstShortfallDate,
          rate,
        });
        break;
      }
    }
    return out;
  },
} as const;
