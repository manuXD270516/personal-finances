import type { ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import {
  FlowValuation,
  Money,
  currency as makeCurrency,
  type Currency,
  type Decimal,
  type Instant,
} from '@pf/shared-kernel';
import type { BudgetNature, BudgetTarget, TargetTree } from '../domain/index.js';
import { lineActual, rateKey, type NominalFlow } from './budget-calculator.js';
import type { BudgetsDeps } from './ports/index.js';

export interface LoaderPeriod {
  /** Clave del periodo (su etiqueta). */
  readonly key: string;
  readonly start: string;
  readonly end: string;
}

export interface LoaderLine {
  readonly key: string;
  readonly target: BudgetTarget;
  readonly nature: BudgetNature;
}

export interface LoadedActual {
  readonly actual: Decimal;
  /** `false` si parte del real no tiene tasa de valoración (el periodo queda `NO_RATE` para esa línea). */
  readonly complete: boolean;
}

const decimalsOf = (amount: string): number => amount.split('.')[1]?.length ?? 0;

/**
 * `HistoricalActualsLoader` (openspec add-historical-budgets 3.2): el real de cada línea en cada periodo de la ventana
 * con EL MISMO cálculo del progreso del presupuesto (`lineActual` + `FlowValuation`, D109) pero con UNA sola consulta
 * `summarizeNominalFlows` para todo el rango y UN solo lote de tasas. Periodos sin movimientos valen 0 (completos).
 */
export class HistoricalActualsLoader {
  constructor(private readonly deps: BudgetsDeps) {}

  async load(input: {
    readonly workspaceId: string;
    readonly periods: readonly LoaderPeriod[];
    readonly lines: readonly LoaderLine[];
    readonly tree: TargetTree;
    readonly currency: Currency;
    readonly timeZone: string;
    readonly now: Instant;
    readonly knownCurrencies: ReadonlyMap<string, Currency>;
    readonly withTags: boolean;
  }): Promise<ReadonlyMap<string, ReadonlyMap<string, LoadedActual>>> {
    const { deps } = this;
    const out = new Map<string, Map<string, LoadedActual>>();
    if (input.periods.length === 0 || input.lines.length === 0) return out;
    const from = input.periods.reduce((min, p) => (p.start < min ? p.start : min), input.periods[0]!.start);
    const to = input.periods.reduce((max, p) => (p.end > max ? p.end : max), input.periods[0]!.end);
    const rows = await deps.flows.summarizeNominalFlows({
      workspaceId: input.workspaceId,
      dateFrom: from,
      dateTo: to,
      withTags: input.withTags,
    });
    const flows: NominalFlow[] = rows.map((r) => ({
      date: r.businessDate,
      nature: r.nature,
      categoryId: r.categoryId,
      tagIds: r.tagIds ?? [],
      amount: Money.parse(
        r.amount.amount,
        input.knownCurrencies.get(r.amount.currency) ??
          makeCurrency(r.amount.currency, decimalsOf(r.amount.amount)),
      ),
    }));
    const byPeriod = new Map(
      input.periods.map((p) => [p.key, flows.filter((f) => f.date >= p.start && f.date <= p.end)] as const),
    );
    const inWindow = [...byPeriod.values()].flat();
    const rates = await FlowValuation.resolveRates<ResolvedRateDto>({
      flows: inWindow.map((f) => ({ date: f.date, amount: f.amount })),
      target: input.currency,
      timeZone: input.timeZone,
      now: input.now,
      windowDays: deps.rateValidityWindowDays,
      resolve: async ({ requests, windowDays }) => {
        const found = await deps.rates.resolveValuationRates({
          workspaceId: input.workspaceId,
          requests,
          windowDays,
        });
        return found.map((r: ValuationRateDto | null) =>
          r ? { exact: r.exact, resolved: r.resolved } : null,
        );
      },
      keyOf: rateKey,
    });
    const consolidate = (subset: readonly NominalFlow[]) =>
      FlowValuation.consolidate(
        subset.map((f) => ({ date: f.date, amount: f.amount })),
        input.currency,
        rates.rateFor,
      );
    for (const period of input.periods) {
      const periodFlows = byPeriod.get(period.key) ?? [];
      const perLine = new Map<string, LoadedActual>();
      for (const line of input.lines) {
        const c = lineActual({
          tree: input.tree,
          target: line.target,
          nature: line.nature,
          flows: periodFlows,
          consolidate,
        });
        perLine.set(line.key, { actual: c.total, complete: c.complete });
      }
      out.set(period.key, perLine);
    }
    return out;
  }
}
