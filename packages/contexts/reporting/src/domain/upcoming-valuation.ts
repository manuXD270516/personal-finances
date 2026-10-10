import {
  convertExact,
  FlowValuation,
  present,
  sumByCurrency,
  type Currency,
  type ExactRate,
  type Money,
} from '@pf/shared-kernel';

export interface ValuedTotal {
  /** Σ por moneda original, sin convertir. */
  readonly byCurrency: readonly Money[];
  readonly consolidated: {
    /** Consolidado en la moneda de reporte, HALF_EVEN a su escala (único punto de redondeo). */
    readonly amount: Money;
    /** `false` si algún agregado quedó sin tasa vigente. */
    readonly complete: boolean;
    /** Agregados nativos sin tasa, excluidos del consolidado (nunca 1:1). */
    readonly unconverted: readonly Money[];
  };
}

/**
 * Valoración de los próximos pagos (design.md decisión 7): cada monto se presenta con `date = hoy`, de modo que
 * `FlowValuation` agrega por moneda, convierte UNA vez por agregado con la tasa vigente al consultar y redondea solo al
 * presentar. Las fechas futuras no tienen tasa propia: lo que se debe se valora hoy (`conv_v(hoy)`, docs/14 §3).
 */
export const UpcomingValuation = {
  value(
    lines: readonly Money[],
    today: string,
    target: Currency,
    rateFor: (currency: string, date: string) => ExactRate | null,
  ): ValuedTotal {
    const consolidated = FlowValuation.consolidate(
      lines.map((amount) => ({ date: today, amount })),
      target,
      rateFor,
    );
    return {
      byCurrency: sumByCurrency(lines),
      consolidated: {
        amount: present(consolidated.total, target),
        complete: consolidated.complete,
        unconverted: consolidated.unconverted,
      },
    };
  },

  /** Monto de un ítem en la moneda de reporte, solo para mostrarlo; `null` sin tasa vigente (nunca 1:1). */
  convert(
    amount: Money,
    today: string,
    target: Currency,
    rateFor: (currency: string, date: string) => ExactRate | null,
  ): Money | null {
    if (amount.currency.code === target.code) return amount;
    const rate = rateFor(amount.currency.code, today);
    return rate ? present(convertExact(amount, target, rate), target) : null;
  },
} as const;
