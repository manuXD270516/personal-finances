import { Money, present, sumByCurrency, type Currency } from '@pf/shared-kernel';
import { ReportConversionPolicy, type ReportAmount } from './report-conversion.js';

/** Clase de la contrapartida de un movimiento del conjunto de cuentas (LEDGER, `FlowCounterpartClassDto`). */
export type FlowCounterpart =
  | 'INCOME'
  | 'EXPENSE'
  | 'FX_TRADING'
  | 'OPENING_BALANCE'
  | 'ADJUSTMENTS'
  | 'OUTSIDE_ASSET'
  | 'OUTSIDE_LIABILITY';

export type LiquidityComponent =
  'operating' | 'debt' | 'savingsInvestments' | 'currencyExchange' | 'adjustments';

export const LIQUIDITY_COMPONENTS: readonly LiquidityComponent[] = [
  'operating',
  'debt',
  'savingsInvestments',
  'currencyExchange',
  'adjustments',
];

/** Clases de contrapartida que componen cada componente (design decisión 4). */
export const COMPONENT_CLASSES: Readonly<Record<LiquidityComponent, readonly FlowCounterpart[]>> = {
  operating: ['INCOME', 'EXPENSE'],
  debt: ['OUTSIDE_LIABILITY'],
  savingsInvestments: ['OUTSIDE_ASSET'],
  currencyExchange: ['FX_TRADING'],
  adjustments: ['OPENING_BALANCE', 'ADJUSTMENTS'],
};

export const componentOf = (c: FlowCounterpart): LiquidityComponent =>
  LIQUIDITY_COMPONENTS.find((k) => COMPONENT_CLASSES[k].includes(c)) as LiquidityComponent;

export interface SetFlow {
  readonly date: string;
  readonly counterpart: FlowCounterpart;
  readonly amount: Money;
}

export interface LiquidityCurrencyBlock {
  readonly currency: string;
  readonly opening: Money;
  readonly operating: Money;
  readonly debt: Money;
  readonly savingsInvestments: Money;
  readonly currencyExchange: Money;
  readonly adjustments: Money;
  readonly closing: Money;
  /** `opening + Σ componentes = closing` (exacto por moneda). Falso indica una inconsistencia de datos. */
  readonly consistent: boolean;
}

export interface LiquidityConsolidated {
  readonly opening: ReportAmount;
  readonly closing: ReportAmount;
  readonly components: Readonly<Record<LiquidityComponent, ReportAmount>>;
  /** Diferencia de valoración entre saldos (a su fecha) y flujos (a la tasa de cada día). */
  readonly revaluation: Money;
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
}

export interface LiquidityFlowFigures {
  readonly byCurrency: readonly LiquidityCurrencyBlock[];
  readonly consolidated: LiquidityConsolidated;
}

/**
 * `LiquidityFlowReport` (reporte 7, INV-004): el flujo de las cuentas líquidas clasificado por la contrapartida de
 * cada movimiento. Por moneda, saldo inicial + Σ componentes = saldo final (exacto); las transferencias entre cuentas
 * líquidas no aparecen porque no tienen patas de afuera. En el consolidado, los saldos van a la tasa de su fecha y los
 * componentes a la de cada día; la diferencia es la línea de revalorización. Puro.
 */
export const LiquidityFlowReport = {
  build(input: {
    readonly currencies: ReadonlyMap<string, Currency>;
    readonly openingDate: string;
    readonly closingDate: string;
    readonly opening: readonly Money[];
    readonly closing: readonly Money[];
    readonly flows: readonly SetFlow[];
    /** Política de los flujos (tasa del día o de la fecha de corte). */
    readonly flowPolicy: ReportConversionPolicy;
    /** Política de los saldos (tasa de su fecha de valoración). */
    readonly balancePolicy: ReportConversionPolicy;
  }): LiquidityFlowFigures {
    const codes = new Set<string>([
      ...input.opening.map((m) => m.currency.code),
      ...input.closing.map((m) => m.currency.code),
      ...input.flows.map((f) => f.amount.currency.code),
    ]);
    const zero = (code: string) => Money.zero(input.currencies.get(code) as Currency);
    const byCurrency: LiquidityCurrencyBlock[] = [];
    for (const code of [...codes].sort()) {
      const sum = (pred: (f: SetFlow) => boolean) =>
        sumByCurrency([
          zero(code),
          ...input.flows.filter((f) => f.amount.currency.code === code && pred(f)).map((f) => f.amount),
        ])[0] as Money;
      const comp = (k: LiquidityComponent) => sum((f) => COMPONENT_CLASSES[k].includes(f.counterpart));
      const opening = input.opening.find((m) => m.currency.code === code) ?? zero(code);
      const closing = input.closing.find((m) => m.currency.code === code) ?? zero(code);
      const parts = LIQUIDITY_COMPONENTS.map(comp);
      const total = parts.reduce((a, m) => a.add(m), opening);
      byCurrency.push({
        currency: code,
        opening,
        operating: parts[0] as Money,
        debt: parts[1] as Money,
        savingsInvestments: parts[2] as Money,
        currencyExchange: parts[3] as Money,
        adjustments: parts[4] as Money,
        closing,
        consistent: total.equals(closing),
      });
    }
    const dated = (date: string) => (ms: readonly Money[]) => ms.map((amount) => ({ date, amount }));
    const opening = input.balancePolicy.value(dated(input.openingDate)(input.opening));
    const closing = input.balancePolicy.value(dated(input.closingDate)(input.closing));
    const components = Object.fromEntries(
      LIQUIDITY_COMPONENTS.map((k) => [
        k,
        input.flowPolicy.value(
          input.flows
            .filter((f) => COMPONENT_CLASSES[k].includes(f.counterpart))
            .map((f) => ({ date: f.date, amount: f.amount })),
        ),
      ]),
    ) as Record<LiquidityComponent, ReportAmount>;
    const all = [opening, closing, ...Object.values(components)];
    const complete = all.every((a) => a.complete);
    const target = input.flowPolicy.target;
    let exact = closing.exact.minus(opening.exact);
    for (const c of Object.values(components)) exact = exact.minus(c.exact);
    return {
      byCurrency,
      consolidated: {
        opening,
        closing,
        components,
        revaluation: present(exact, target),
        complete,
        // Los sin tasa de los saldos se informan una vez (el del cierre; el del inicio solo si el cierre sí tiene tasa).
        unconverted: ReportConversionPolicy.combine(target, [
          closing.complete ? opening : closing,
          ...Object.values(components),
        ]).unconverted,
      },
    };
  },
} as const;
