import {
  dec,
  Money,
  present,
  type Currency,
  type Decimal,
  type ExactRate,
  convertExact,
} from '@pf/shared-kernel';
import type { FlowCounterpart } from './liquidity-flow-report.js';

export interface DecomposerFlow {
  readonly date: string;
  readonly currency: string;
  readonly counterpart: FlowCounterpart;
  /** Con el signo del conjunto de cuentas del patrimonio. */
  readonly amount: Money;
}

export interface Revaluation {
  readonly currency: string;
  /** `FX` para monedas fiat (revalorización cambiaria); `ASSET` para las demás (de activos). */
  readonly kind: 'FX' | 'ASSET';
  readonly amount: Money;
}

export interface NetWorthDecomposition {
  readonly opening: Money;
  readonly closing: Money;
  readonly savings: Money;
  readonly conversionResult: Money;
  readonly adjustments: Money;
  readonly otherMovements: Money;
  readonly fxRevaluation: Money;
  readonly assetRevaluation: Money;
  readonly revaluationByCurrency: readonly Revaluation[];
  readonly complete: boolean;
  /** Saldo (cierre o, si es cero, apertura) de las monedas que no se pudieron valorar. */
  readonly unvalued: readonly Money[];
  /** Cambio exacto del patrimonio y suma exacta de componentes (precisión 40): son iguales por construcción. */
  readonly deltaExact: Decimal;
  readonly componentsExact: Decimal;
}

type Component = 'savings' | 'conversionResult' | 'adjustments' | 'otherMovements';

const COMPONENT_OF: Readonly<Record<FlowCounterpart, Component>> = {
  INCOME: 'savings',
  EXPENSE: 'savings',
  FX_TRADING: 'conversionResult',
  OPENING_BALANCE: 'adjustments',
  ADJUSTMENTS: 'adjustments',
  OUTSIDE_ASSET: 'otherMovements',
  OUTSIDE_LIABILITY: 'otherMovements',
};

/**
 * `NetWorthDecomposer` (reporte 8, INV-031; design decisión 5): ΔNW = ahorro + resultado de conversiones + ajustes +
 * otros movimientos + Σ revalorización por moneda, EXACTAMENTE (precisión 40, HALF_EVEN solo al presentar).
 *   reval_c = bal_c(d1)·r_c(d1) − bal_c(d0⁻)·r_c(d0⁻) − Σ_t flow_c(t)·r_c(t)   (0 para la moneda de reporte).
 * Una moneda sin tasa en d0⁻ (con saldo), d1 (con saldo) o en un día con flujos queda fuera de TODA la descomposición
 * (`unvalued`, incompleta): nunca se atribuye su diferencia a otro componente. Puro.
 */
export const NetWorthDecomposer = {
  decompose(input: {
    readonly target: Currency;
    readonly currencies: ReadonlyMap<string, Currency>;
    /** Tipo de cada moneda (`FIAT`, `CRYPTO`, …) para agrupar la revalorización. */
    readonly kinds: ReadonlyMap<string, string>;
    /** Saldos contables del conjunto al cierre del día anterior al inicio y al cierre del último día. */
    readonly opening: readonly Money[];
    readonly closing: readonly Money[];
    readonly openingDate: string;
    readonly closingDate: string;
    readonly flows: readonly DecomposerFlow[];
    readonly rateFor: (currency: string, date: string) => ExactRate | null;
  }): NetWorthDecomposition {
    const { target } = input;
    const codes = new Set<string>([
      ...input.opening.map((m) => m.currency.code),
      ...input.closing.map((m) => m.currency.code),
      ...input.flows.map((f) => f.amount.currency.code),
    ]);
    const value = (m: Money, date: string): Decimal | null => {
      if (m.currency.code === target.code) return m.toDecimal();
      if (m.isZero()) return dec('0');
      const rate = input.rateFor(m.currency.code, date);
      return rate ? convertExact(m, target, rate) : null;
    };
    const zeroOf = (code: string) => Money.zero(input.currencies.get(code) as Currency);
    const sums: Record<Component, Decimal> = {
      savings: dec('0'),
      conversionResult: dec('0'),
      adjustments: dec('0'),
      otherMovements: dec('0'),
    };
    let openExact = dec('0');
    let closeExact = dec('0');
    let fx = dec('0');
    let asset = dec('0');
    const byCurrency: Revaluation[] = [];
    const unvalued: Money[] = [];
    for (const code of [...codes].sort()) {
      const open = input.opening.find((m) => m.currency.code === code) ?? zeroOf(code);
      const close = input.closing.find((m) => m.currency.code === code) ?? zeroOf(code);
      const flows = input.flows.filter((f) => f.amount.currency.code === code);
      const vOpen = value(open, input.openingDate);
      const vClose = value(close, input.closingDate);
      const vFlows = flows.map((f) => ({ f, v: value(f.amount, f.date) }));
      if (vOpen === null || vClose === null || vFlows.some((x) => x.v === null)) {
        unvalued.push(close.isZero() ? open : close);
        continue;
      }
      const perComponent: Record<Component, Decimal> = {
        savings: dec('0'),
        conversionResult: dec('0'),
        adjustments: dec('0'),
        otherMovements: dec('0'),
      };
      let flowExact = dec('0');
      for (const { f, v } of vFlows) {
        const value40 = v as Decimal;
        perComponent[COMPONENT_OF[f.counterpart]] = perComponent[COMPONENT_OF[f.counterpart]].plus(value40);
        flowExact = flowExact.plus(value40);
      }
      for (const k of Object.keys(sums) as Component[]) sums[k] = sums[k].plus(perComponent[k]);
      openExact = openExact.plus(vOpen);
      closeExact = closeExact.plus(vClose);
      const reval = vClose.minus(vOpen).minus(flowExact);
      if (code !== target.code) {
        const kind = input.kinds.get(code) === 'FIAT' ? 'FX' : 'ASSET';
        if (kind === 'FX') fx = fx.plus(reval);
        else asset = asset.plus(reval);
        byCurrency.push({ currency: code, kind, amount: present(reval, target) });
      }
    }
    const componentsExact = sums.savings
      .plus(sums.conversionResult)
      .plus(sums.adjustments)
      .plus(sums.otherMovements)
      .plus(fx)
      .plus(asset);
    return {
      opening: present(openExact, target),
      closing: present(closeExact, target),
      savings: present(sums.savings, target),
      conversionResult: present(sums.conversionResult, target),
      adjustments: present(sums.adjustments, target),
      otherMovements: present(sums.otherMovements, target),
      fxRevaluation: present(fx, target),
      assetRevaluation: present(asset, target),
      revaluationByCurrency: byCurrency,
      complete: unvalued.length === 0,
      unvalued,
      deltaExact: closeExact.minus(openExact),
      componentsExact,
    };
  },
} as const;
