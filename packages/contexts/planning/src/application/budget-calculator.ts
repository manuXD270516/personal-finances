import type { ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import {
  DomainError,
  FlowValuation,
  LocalDate,
  Money,
  currency as makeCurrency,
  dec,
  present,
  sumByCurrency,
  type Currency,
  type Decimal,
  type Instant,
} from '@pf/shared-kernel';
import {
  BudgetProgressCalculator,
  RolloverCalculator,
  ROLLOVER_KINDS,
  categoriesOfTarget,
  type AggregateLine,
  type Budget,
  type BudgetLine,
  type FinancialPeriod,
  type LineProgress,
  type PlanTotals,
  type RolloverStatus,
  type TargetTree,
} from '../domain/index.js';
import type { BudgetsDeps } from './ports/index.js';

/** Profundidad máxima del encadenado de rollover (12 meses; más allá se asume sin remanente). */
export const MAX_ROLLOVER_DEPTH = 12;

interface NominalFlow {
  readonly date: string;
  readonly nature: 'INCOME' | 'EXPENSE';
  readonly categoryId: string;
  readonly tagIds: readonly string[];
  readonly amount: Money;
}

export interface LineView {
  readonly line: BudgetLine;
  readonly progress: LineProgress;
  /** `false` si parte del gastado no tiene tasa de valoración (se informa en `unconverted`, nunca 1:1). */
  readonly actualComplete: boolean;
  readonly unconverted: readonly Money[];
  readonly rolloverIn: Money | null;
  readonly rolloverStatus: RolloverStatus;
  /** Umbrales ya cruzados en el periodo (registro append-only). */
  readonly crossedThresholds: readonly string[];
}

export interface BudgetView {
  readonly budget: Budget;
  readonly period: FinancialPeriod;
  readonly currency: Currency;
  readonly timeZone: string;
  readonly today: LocalDate;
  readonly windowDays: number;
  readonly generatedAt: string;
  readonly lines: readonly LineView[];
  readonly totals: PlanTotals;
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
  readonly ratesUsed: readonly ResolvedRateDto[];
}

/** Clave de identidad de una tasa usada (misma versión almacenada y orientación => una sola entrada). */
const rateKey = (r: ResolvedRateDto): string =>
  `${r.fxRateId ?? JSON.stringify(r.components.map((c) => (c as { id?: unknown }).id))}|${r.rate.base}|${r.rate.quote}`;

const decimalsOf = (amount: string): number => amount.split('.')[1]?.length ?? 0;

/** Árbol de CLASSIFICATION en la forma que usa el dominio. */
export async function loadTargetTree(deps: BudgetsDeps, workspaceId: string): Promise<TargetTree> {
  const tree = await deps.catalog.categoryTree({ userId: deps.actor.userId(), workspaceId });
  return {
    groups: new Map(tree.groups.map((g) => [g.groupId, { kind: g.kind, archived: g.archived }])),
    categories: new Map(
      tree.categories.map((c) => [
        c.categoryId,
        { kind: c.kind, groupId: c.groupId, parentId: c.parentId, archived: c.archived },
      ]),
    ),
    tags: new Map(tree.tags.map((t) => [t.tagId, { archived: t.archived }])),
  };
}

/** Moneda del plan con la escala canónica del catálogo de FX. */
export async function planCurrency(deps: BudgetsDeps, workspaceId: string, code: string): Promise<Currency> {
  const catalog = await deps.rates.workspaceCurrencies(workspaceId);
  const found = catalog.find((c) => c.code === code);
  if (!found) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not in the catalog`);
  return makeCurrency(found.code, found.scale);
}

/**
 * Cálculo de presupuesto vs real (design decisiones 4-6 y 10; INV-034): el gastado se DERIVA en cada lectura de
 * `SummarizeNominalFlows` del periodo (misma clasificación de flujos que el Home) y se valora con `FlowValuation`
 * (shared-kernel, docs/33 D109: tasa del tipo preferido vigente al cierre del día, ventana de Reporting, sin tasa =>
 * parte sin convertir y resultado incompleto, nunca 1:1). Nada de esto se persiste.
 */
export class BudgetCalculator {
  constructor(private readonly deps: BudgetsDeps) {}

  /**
   * Lecturas del workspace que no cambian dentro de un mismo cálculo (calendario, monedas, árbol de categorías, periodos
   * y planes anteriores del rollover). El rollover encadena hasta 12 periodos y repite esas lecturas por periodo y por
   * línea: se consultan una vez por `memo` (improve-event-throughput 2.5; mismo resultado, menos consultas por evento).
   * La clave es el `memo` del cálculo: un cálculo nuevo (`memo` nuevo) vuelve a leer.
   */
  private readonly scopes = new WeakMap<Map<string, BudgetView>, Map<string, Promise<unknown>>>();

  private once<T>(memo: Map<string, BudgetView>, key: string, load: () => Promise<T>): Promise<T> {
    let scope = this.scopes.get(memo);
    if (!scope) {
      scope = new Map();
      this.scopes.set(memo, scope);
    }
    let hit = scope.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = load();
      scope.set(key, hit);
      // Un fallo no se conserva: la siguiente lectura del mismo cálculo vuelve a intentarlo.
      hit.catch(() => scope.delete(key));
    }
    return hit;
  }

  async view(input: {
    readonly workspaceId: string;
    readonly budget: Budget;
    readonly period: FinancialPeriod;
    readonly now: Instant;
    readonly depth?: number;
    /** Vistas ya calculadas en esta lectura (el rollover encadena periodos). */
    readonly memo?: Map<string, BudgetView>;
  }): Promise<BudgetView> {
    const { deps } = this;
    const { workspaceId, budget, period, now } = input;
    const depth = input.depth ?? 0;
    const memo = input.memo ?? new Map<string, BudgetView>();
    const cached = memo.get(budget.id);
    if (cached) return cached;

    const calendar = await this.once(memo, 'calendar', () => deps.calendar.calendarOf(workspaceId));
    const timeZone = calendar.timeZone;
    const today = LocalDate.ofInstant(now, timeZone);
    const catalog = await this.once(memo, 'currencies', () => deps.rates.workspaceCurrencies(workspaceId));
    const known = new Map<string, Currency>(catalog.map((c) => [c.code, makeCurrency(c.code, c.scale)]));
    const planCode = budget.snapshot.currency;
    const currency = known.get(planCode);
    if (!currency)
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${planCode} is not in the catalog`);
    const tree = await this.once(memo, 'tree', () => loadTargetTree(deps, workspaceId));

    const lines = budget.lines;
    const range = {
      start: LocalDate.parse(period.snapshot.periodStart),
      end: LocalDate.parse(period.snapshot.periodEnd),
    };
    const rows = await deps.flows.summarizeNominalFlows({
      workspaceId,
      dateFrom: range.start.toString(),
      dateTo: range.end.toString(),
      withTags: lines.some((l) => l.target.kind === 'TAG'),
    });
    const flows: NominalFlow[] = rows.map((r) => ({
      date: r.businessDate,
      nature: r.nature,
      categoryId: r.categoryId,
      tagIds: r.tagIds ?? [],
      amount: Money.parse(
        r.amount.amount,
        known.get(r.amount.currency) ?? makeCurrency(r.amount.currency, decimalsOf(r.amount.amount)),
      ),
    }));

    // Una sola resolución de tasas para todos los flujos del periodo (misma selección que el resumen del Home).
    const windowDays = deps.rateValidityWindowDays;
    const rates = await FlowValuation.resolveRates<ResolvedRateDto>({
      flows: flows.map((f) => ({ date: f.date, amount: f.amount })),
      target: currency,
      timeZone,
      now,
      windowDays,
      resolve: async ({ requests, windowDays: window }) => {
        const found = await deps.rates.resolveValuationRates({ workspaceId, requests, windowDays: window });
        return found.map((r: ValuationRateDto | null) =>
          r ? { exact: r.exact, resolved: r.resolved } : null,
        );
      },
      keyOf: rateKey,
    });
    const usedRates = new Map<string, ResolvedRateDto>();
    const consolidate = (subset: readonly NominalFlow[]) => {
      const collector = rates.collector();
      const result = FlowValuation.consolidate(
        subset.map((f) => ({ date: f.date, amount: f.amount })),
        currency,
        collector.rateFor,
      );
      for (const r of collector.used()) usedRates.set(rateKey(r), r);
      return result;
    };

    const actuals = new Map<string, ReturnType<typeof consolidate>>();
    for (const line of lines) {
      const t = line.target;
      const subset =
        t.kind === 'TAG'
          ? flows.filter((f) => f.nature === 'EXPENSE' && f.tagIds.includes(t.id))
          : (() => {
              const wanted = categoriesOfTarget(tree, t);
              return flows.filter((f) => f.nature === line.nature && wanted.has(f.categoryId));
            })();
      actuals.set(line.id, consolidate(subset));
    }

    // Base del porcentaje de ingresos: esperados (Σ líneas de ingreso) o reales (todo el ingreso del periodo).
    const zero = dec('0');
    const expectedIncome = lines
      .filter((l) => l.nature === 'INCOME')
      .reduce((acc, l) => acc.plus(l.snapshot.planned ?? '0'), zero);
    const realIncome = consolidate(flows.filter((f) => f.nature === 'INCOME'));

    const crossings = await deps.crossings.list(workspaceId, period.id);

    const lineViews: LineView[] = [];
    for (const line of lines) {
      const s = line.snapshot;
      const consolidated = actuals.get(line.id) as ReturnType<typeof consolidate>;
      const rollover = await this.rolloverIn({ workspaceId, budget, period, line, now, depth, memo });
      const basisIsActual = s.incomeBasis === 'ACTUAL';
      const incomeBase =
        s.kind === 'PERCENT_OF_INCOME' ? (basisIsActual ? realIncome.total : expectedIncome) : null;
      const progress = BudgetProgressCalculator.line({
        kind: s.kind,
        nature: s.nature,
        currency,
        planned: s.planned === null ? null : dec(s.planned),
        min: s.min === null ? null : dec(s.min),
        max: s.max === null ? null : dec(s.max),
        percent: s.percent === null ? null : dec(s.percent),
        incomeBase,
        rolloverIn: rollover?.amount ?? null,
        actual: consolidated.total,
        period: range,
        today,
      });
      lineViews.push({
        line,
        progress,
        actualComplete:
          consolidated.complete && !(basisIsActual && s.kind === 'PERCENT_OF_INCOME' && !realIncome.complete),
        unconverted: consolidated.unconverted,
        rolloverIn: rollover ? present(rollover.amount, currency) : null,
        rolloverStatus: rollover?.status ?? 'NONE',
        crossedThresholds: crossings
          .filter((c) => c.targetKind === line.target.kind && c.targetId === line.target.id)
          .map((c) => c.threshold)
          .sort((a, b) => dec(a).comparedTo(dec(b))),
      });
    }

    const aggregate: AggregateLine[] = lineViews.map((v) => ({
      nature: v.line.nature,
      targetKind: v.line.target.kind,
      progress: v.progress,
    }));
    const totals = BudgetProgressCalculator.totals(aggregate, currency, budget.zeroBased);
    // Sin doble conteo: los tags son transversales y no entran en los totales de gasto.
    const counted = lineViews.filter((v) => v.line.nature === 'EXPENSE' && v.line.target.kind !== 'TAG');
    const view: BudgetView = {
      budget,
      period,
      currency,
      timeZone,
      today,
      windowDays,
      generatedAt: now.toString(),
      lines: lineViews,
      totals,
      complete: lineViews.every((v) => v.actualComplete),
      unconverted: sumByCurrency(counted.flatMap((v) => [...v.unconverted])),
      ratesUsed: [...usedRates.values()],
    };
    memo.set(budget.id, view);
    return view;
  }

  /**
   * Remanente recibido del periodo anterior (design decisión 10): `PROVISIONAL` mientras el anterior no esté cerrado
   * (se recalcula con su gastado vigente), `FINAL` cuando está cerrado (se usa el valor congelado por
   * `planning.rollover-finalizer` o, si el consumidor aún no corrió, el cálculo vivo: un periodo cerrado no cambia).
   */
  private async rolloverIn(input: {
    readonly workspaceId: string;
    readonly budget: Budget;
    readonly period: FinancialPeriod;
    readonly line: BudgetLine;
    readonly now: Instant;
    readonly depth: number;
    readonly memo: Map<string, BudgetView>;
  }): Promise<{ amount: Decimal; status: RolloverStatus } | null> {
    const { deps } = this;
    const { workspaceId, line } = input;
    if (line.nature !== 'EXPENSE' || !ROLLOVER_KINDS.includes(line.kind)) return null;
    if (input.depth >= MAX_ROLLOVER_DEPTH) return null;
    const all = await this.once(input.memo, 'periods', () => deps.periods.list(workspaceId));
    const index = all.findIndex((p) => p.id === input.period.id);
    const previous = index > 0 ? all[index - 1] : undefined;
    if (!previous) return null;
    const previousBudget = await this.once(input.memo, `budget:${previous.id}`, () =>
      deps.budgets.findByPeriod(workspaceId, previous.id),
    );
    const previousLine = previousBudget?.lines.find(
      (l) => l.target.kind === line.target.kind && l.target.id === line.target.id,
    );
    if (!previousBudget || !previousLine) return null;
    const policy = previousLine.snapshot.rolloverPolicy;
    if (policy === 'NONE' || !ROLLOVER_KINDS.includes(previousLine.kind)) return null;

    const closed = previous.status === 'CLOSED';
    const stored = line.snapshot;
    if (closed && stored.rolloverStatus === 'FINAL' && stored.rolloverInAmount !== null) {
      return { amount: dec(stored.rolloverInAmount), status: 'FINAL' };
    }
    const previousView = await this.view({
      workspaceId,
      budget: previousBudget,
      period: previous,
      now: input.now,
      depth: input.depth + 1,
      memo: input.memo,
    });
    const before = previousView.lines.find((v) => v.line.id === previousLine.id);
    if (!before) return null;
    const cap = previousLine.snapshot.rolloverCap;
    const carried = RolloverCalculator.carryOut({
      policy,
      cap: cap === null ? null : dec(cap),
      reference: before.progress.reference.toDecimal(),
      actual: before.progress.actual.toDecimal(),
    });
    return { amount: carried, status: closed ? 'FINAL' : 'PROVISIONAL' };
  }
}
