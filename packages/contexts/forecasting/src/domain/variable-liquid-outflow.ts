import { FinancialPeriodCalendar, LocalDate, dec, type Decimal, type PeriodLabel } from '@pf/shared-kernel';
import { countsAsKnown, type OccurrenceInput } from './known-future.js';

/** Cuenta líquida del workspace (`ASSET` + `LIQUID` no archivada) con la escala de su moneda. */
export interface LiquidAccountInput {
  readonly accountId: string;
  readonly currency: string;
  readonly scale: number;
}

/** Porción de gasto pagada desde una cuenta (`NominalFlowQuery` con `groupBy: ['ACCOUNT', 'ORIGIN']`), neta de reembolsos. */
export interface LiquidFlowInput {
  readonly businessDate: string;
  readonly accountId: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  /** La porción es un componente de préstamo (interés, cargos, seguro o impuestos): ya está en los flujos conocidos. */
  readonly loanComponent: boolean;
}

/** Ocurrencia de gasto resuelta con la cuenta de su definición (COMMITMENTS `listResolved`). */
export interface LiquidResolvedInput {
  readonly kind: OccurrenceInput['kind'];
  readonly managedBy: OccurrenceInput['managedBy'];
  readonly transactionDate: string;
  readonly accountId: string | null;
  readonly amount: { readonly amount: string; readonly currency: string };
}

export interface LiquidPeriodFigure {
  readonly value: Decimal;
  /** Cantidad de porciones del periodo (densidad). */
  readonly txCount: number;
}

export interface LiquidCurrencyHistory {
  readonly scale: number;
  readonly periods: ReadonlyMap<PeriodLabel, LiquidPeriodFigure>;
}

export interface LiquidOutflowHistory {
  readonly byCurrency: ReadonlyMap<string, LiquidCurrencyHistory>;
  /** Resultados negativos (resta mayor que el gasto) llevados a 0: calidad de datos. */
  readonly clampedCount: number;
}

/**
 * `VariableLiquidOutflowBuilder` (openspec add-predicted-cash-flow-band, decisión 1; FR-FORECAST-008): historia del gasto
 * variable que sale de las cuentas líquidas, por moneda y periodo financiero, EN la moneda de cada cuenta (sin
 * conversión): gasto de las porciones pagadas desde cuentas líquidas − ocurrencias resueltas de gasto pagadas desde ellas
 * − componentes de préstamo pagados desde ellas (mismo criterio que `VariableHistoryBuilder`). Las compras a cuentas
 * no líquidas (tarjeta de crédito) no cuentan: el calendario ya cuenta el pago de la tarjeta. Pura, con Decimal.
 */
export const VariableLiquidOutflowBuilder = {
  build(input: {
    readonly accounts: readonly LiquidAccountInput[];
    readonly flows: readonly LiquidFlowInput[];
    readonly resolved: readonly LiquidResolvedInput[];
    readonly startDay: number;
  }): LiquidOutflowHistory {
    const liquid = new Set(input.accounts.map((a) => a.accountId));
    const scaleOf = new Map<string, number>();
    for (const a of input.accounts) scaleOf.set(a.currency, Math.max(scaleOf.get(a.currency) ?? 0, a.scale));
    const labelOf = (date: string): PeriodLabel =>
      FinancialPeriodCalendar.periodOf(input.startDay, LocalDate.parse(date)).label;

    interface Acc {
      gross: Decimal;
      minus: Decimal;
      tx: number;
    }
    const acc = new Map<string, Map<PeriodLabel, Acc>>();
    const cell = (currencyCode: string, label: PeriodLabel): Acc => {
      const byPeriod = acc.get(currencyCode) ?? new Map<PeriodLabel, Acc>();
      acc.set(currencyCode, byPeriod);
      const a = byPeriod.get(label) ?? { gross: dec('0'), minus: dec('0'), tx: 0 };
      byPeriod.set(label, a);
      return a;
    };
    for (const f of input.flows) {
      if (!liquid.has(f.accountId) || !scaleOf.has(f.amount.currency)) continue;
      const a = cell(f.amount.currency, labelOf(f.businessDate));
      const v = dec(f.amount.amount);
      a.gross = a.gross.plus(v);
      a.tx += 1;
      if (f.loanComponent) a.minus = a.minus.plus(v);
    }
    for (const r of input.resolved) {
      if (r.accountId === null || !liquid.has(r.accountId) || !scaleOf.has(r.amount.currency)) continue;
      if (countsAsKnown(r) !== 'EXPENSE') continue;
      const a = cell(r.amount.currency, labelOf(r.transactionDate));
      a.minus = a.minus.plus(dec(r.amount.amount));
    }

    let clampedCount = 0;
    const byCurrency = new Map<string, LiquidCurrencyHistory>();
    for (const [code, byPeriod] of [...acc.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const periods = new Map<PeriodLabel, LiquidPeriodFigure>();
      for (const [label, a] of byPeriod) {
        let value = a.gross.minus(a.minus);
        if (value.isNegative()) {
          clampedCount += 1;
          value = dec('0');
        }
        periods.set(label, { value, txCount: a.tx });
      }
      byCurrency.set(code, { scale: scaleOf.get(code) as number, periods });
    }
    return { byCurrency, clampedCount };
  },
} as const;
