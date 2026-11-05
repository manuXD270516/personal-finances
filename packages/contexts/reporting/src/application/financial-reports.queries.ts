import { DomainError, LocalDate, Money, plusDays, type DatedAmount } from '@pf/shared-kernel';
import type {
  AccountBalanceHistoryReportDto,
  BudgetVsActualReportDto,
  CashFlowReportDto,
  CategoryLeafReportDto,
  ExpensesByCategoryReportDto,
  IncomeExpensesReportDto,
  IncomeExpensesRowDto,
  NetWorthReportDto,
  ReportCatalogDto,
  ReportMetaDto,
} from '../contracts/financial-reports.js';
import {
  BalanceStepSeries,
  CategoryTreeReport,
  daysBetween,
  IncomeExpenseReport,
  LiquidityFlowReport,
  LIQUIDITY_COMPONENTS,
  MAX_BALANCE_HISTORY_DAYS,
  NetWorthDecomposer,
  REPORT_CATALOG,
  REPORT_DURATION_METRIC,
  ReportComparator,
  ReportConversionPolicy,
  ROLLING_WINDOWS,
  type FlowFact,
  type FlowCounterpart,
  type IncomeExpenseFigures,
  type ReportAmount,
  type ReportPeriod,
  type RollingWindow,
  type SetFlow,
} from '../domain/index.js';
import type { FinancialReportsDeps } from './ports/financial-reports.js';
import {
  amountDto,
  baselineDto,
  invalid,
  mergeSpans,
  periodDto,
  ReportContext,
  variationDto,
  type ReportParams,
  type Span,
} from './report-context.js';

/** Resultado de un reporte con la versión de datos para el `ETag` (la misma que `meta.dataVersion`). */
export interface ReportResult<T> {
  readonly report: T;
  readonly dataVersion: string;
}

export interface IncomeExpensesParams extends ReportParams {
  readonly granularity?: 'PERIOD' | 'WEEK';
}

export interface ExpensesByCategoryParams extends ReportParams {
  readonly topN?: number;
}

export interface NetWorthParams extends ReportParams {
  readonly granularity?: 'PERIOD' | 'DAY';
}

const MAX_NET_WORTH_DAYS = 366;

/**
 * Reportes financieros de REPORTING (add-financial-reports, FR-REPORTING-008..012): seis reportes Must y su catálogo,
 * calculados desde la FUENTE DE VERDAD en una sola unidad de trabajo de lectura con RLS del workspace, con una
 * resolución de tasas por petición (D109) y llamadas secuenciales (nunca `Promise.all` sobre el mismo cliente PG). Todo
 * lo financiero lo hacen los DS puros del dominio; aquí solo se orquesta y se presenta. Sin efectos.
 */
export class FinancialReportsQueries {
  constructor(protected readonly deps: FinancialReportsDeps) {}

  getCatalog(): ReportCatalogDto {
    return { reports: REPORT_CATALOG.map((e) => ({ ...e })) };
  }

  /** Ejecuta `fn` en la unidad de trabajo de lectura, mide su duración por reporte y devuelve la versión de datos. */
  protected async run<T extends { readonly meta: ReportMetaDto }>(
    reportId: string,
    params: ReportParams,
    fn: (ctx: ReportContext) => Promise<T>,
  ): Promise<ReportResult<T>> {
    const started = performance.now();
    const report = await this.deps.uow.run(
      { userId: params.userId, workspaceId: params.workspaceId },
      async () => fn(await ReportContext.create(this.deps, params)),
    );
    this.deps.metrics?.observe(REPORT_DURATION_METRIC, (performance.now() - started) / 1000, {
      report: reportId,
    });
    return { report, dataVersion: report.meta.dataVersion };
  }

  // ───────────────────────────────────────────── flujos nominales (reportes 1 y 3)

  /** Lee los flujos nominales de cada tramo (una vez) y los convierte en hechos con Money. */
  protected async loadFacts(
    ctx: ReportContext,
    spans: readonly Span[],
    nature?: 'INCOME' | 'EXPENSE',
  ): Promise<FlowFact[]> {
    const f = ctx.filters;
    const facts: FlowFact[] = [];
    for (const span of mergeSpans(spans)) {
      const rows = await this.deps.flows.summarizeNominalFlows({
        workspaceId: ctx.params.workspaceId,
        dateFrom: span.from,
        dateTo: span.to,
        ...(f.requestedCategoryIds.length > 0 ? { categoryIds: f.categoryIds } : {}),
        ...(f.accountIds.length > 0 ? { accountIds: f.accountIds } : {}),
        ...(f.counterpartyIds.length > 0 ? { counterpartyIds: f.counterpartyIds } : {}),
        ...(f.tagIds.length > 0 ? { tagIds: f.tagIds } : {}),
        ...(f.currencies.length > 0 ? { currencies: f.currencies } : {}),
      });
      for (const r of rows) {
        if (nature && r.nature !== nature) continue;
        facts.push({
          date: r.businessDate,
          nature: r.nature,
          categoryId: r.categoryId,
          amount: ctx.money(r.amount),
        });
      }
    }
    return facts;
  }

  private datedOf(ctx: ReportContext, facts: readonly FlowFact[]): DatedAmount[] {
    return facts.map((f) => ({ date: ctx.flowDate(f.date), amount: f.amount }));
  }

  private comparisonPlan(ctx: ReportContext, periods: readonly ReportPeriod[]) {
    const p = ctx.params;
    const mode = p.compare ?? 'NONE';
    if (mode === 'NONE')
      return { mode, pairs: [] as ReturnType<typeof ReportComparator.pairs>, custom: null };
    if (mode === 'CUSTOM') {
      const custom = ReportComparator.customRange(p.compareFrom, p.compareTo, ctx.calendar);
      return { mode, pairs: [], custom };
    }
    return { mode, pairs: ReportComparator.pairs(mode, periods, ctx.calendar), custom: null };
  }

  /** Reporte 1: ingresos y gastos por periodo o semana, con comparación, línea base móvil y totales. */
  getIncomeExpenses(params: IncomeExpensesParams): Promise<ReportResult<IncomeExpensesReportDto>> {
    return this.run('INCOME_EXPENSES', params, async (ctx) => {
      const granularity = params.granularity ?? 'PERIOD';
      const mode = params.compare ?? 'NONE';
      const rolling = params.rolling as RollingWindow | undefined;
      if (rolling !== undefined && !ROLLING_WINDOWS.includes(rolling)) {
        throw invalid('rolling must be 3, 6 or 12', '/rolling');
      }
      if (granularity === 'WEEK' && (mode !== 'NONE' || rolling !== undefined)) {
        throw invalid('weekly granularity does not support comparisons', '/granularity');
      }
      const periods =
        granularity === 'WEEK'
          ? ctx.calendar.weeks(params.from, params.to)
          : ctx.calendar.periods(params.from, params.to);
      const plan = this.comparisonPlan(ctx, periods);
      const firstActivity =
        rolling !== undefined
          ? ((await this.deps.activity.getActivityRange(params.workspaceId))?.minEntryDate ?? null)
          : null;
      const baselines =
        rolling !== undefined
          ? periods.map((p) => ReportComparator.baselinePeriods(p, rolling, ctx.calendar, firstActivity))
          : [];

      const spans: Span[] = [{ from: params.from, to: params.to }];
      for (const pair of plan.pairs) spans.push({ from: pair.compared.from, to: pair.compared.to });
      if (plan.custom) spans.push({ from: plan.custom.periods[0]!.from, to: plan.custom.periods.at(-1)!.to });
      for (const b of baselines) for (const u of b.usable) spans.push({ from: u.from, to: u.to });
      const facts = await this.loadFacts(ctx, spans);
      await ctx.resolveRates(this.datedOf(ctx, facts));
      const policy = ctx.flowPolicy();

      const perDay = params.normalize === 'PER_DAY';
      // Los periodos de la línea base y de la comparación se repiten entre filas (36 meses con YoY y promedio de 12):
      // cada tramo se valora una sola vez.
      const memo = new Map<string, IncomeExpenseFigures>();
      const figures = (span: { from: string; to: string; days: number }): IncomeExpenseFigures => {
        const key = `${span.from}|${span.to}|${span.days}`;
        let cached = memo.get(key);
        if (!cached) {
          cached = IncomeExpenseReport.figures(facts, span, policy, perDay ? span.days : undefined);
          memo.set(key, cached);
        }
        return cached;
      };
      const comparisonOf = (cur: IncomeExpenseFigures, cmp: IncomeExpenseFigures) => ({
        income: variationDto(ReportComparator.variation(cur.income, cmp.income, ctx.reporting)),
        expenses: variationDto(ReportComparator.variation(cur.expenses, cmp.expenses, ctx.reporting)),
        savings: variationDto(ReportComparator.variation(cur.savings, cmp.savings, ctx.reporting)),
      });

      const customPeriods = plan.custom?.periods ?? [];
      const rowPeriods = mode === 'PREVIOUS_PERIOD_TO_DATE' ? plan.pairs.map((x) => x.current) : periods;
      const rows: IncomeExpensesRowDto[] = rowPeriods.map((period, i) => {
        const fig = figures(period);
        ctx.track(fig.income);
        ctx.track(fig.expenses);
        let comparison: IncomeExpensesRowDto['comparison'] = null;
        const pair = plan.pairs[i];
        if (pair) comparison = comparisonOf(fig, figures(pair.compared));
        else if (plan.custom && customPeriods.length === periods.length && customPeriods[i]) {
          comparison = comparisonOf(fig, figures(customPeriods[i]!));
        }
        let baseline: IncomeExpensesRowDto['baseline'] = null;
        if (rolling !== undefined) {
          const b = baselines[i]!;
          const valuesOf = (pick: (f: IncomeExpenseFigures) => ReportAmount) =>
            b.insufficient ? null : b.usable.map((u) => pick(figures(u)).exact);
          baseline = {
            income: baselineDto(
              ReportComparator.baseline(
                rolling,
                fig.income,
                valuesOf((f) => f.income),
                ctx.reporting,
              ),
            ),
            expenses: baselineDto(
              ReportComparator.baseline(
                rolling,
                fig.expenses,
                valuesOf((f) => f.expenses),
                ctx.reporting,
              ),
            ),
            savings: baselineDto(
              ReportComparator.baseline(
                rolling,
                fig.savings,
                valuesOf((f) => f.savings),
                ctx.reporting,
              ),
            ),
          };
        }
        return {
          period: periodDto(period),
          income: amountDto(fig.income),
          expenses: amountDto(fig.expenses),
          savings: amountDto(fig.savings),
          savingsRate: fig.savingsRate,
          comparison,
          baseline,
        };
      });

      // Totales del rango completo y su comparación (mismos filtros, misma política).
      const range = { from: params.from, to: params.to, days: daysBetween(params.from, params.to) };
      const total = figures(range);
      let totalComparison: IncomeExpensesRowDto['comparison'] = null;
      let comparisonMeta: ReportMetaDto['comparison'] = null;
      if (plan.custom) {
        const cFrom = plan.custom.periods[0]!.from;
        const cTo = plan.custom.periods.at(-1)!.to;
        totalComparison = comparisonOf(total, figures({ from: cFrom, to: cTo, days: plan.custom.days }));
        comparisonMeta = {
          mode,
          from: cFrom,
          to: cTo,
          days: plan.custom.days,
          currentDays: range.days,
          normalized: perDay,
        };
      } else if (plan.pairs.length > 0) {
        const comparedSpans = plan.pairs.map((x) => x.compared);
        const days = comparedSpans.reduce((n, x) => n + x.days, 0);
        const currentDays = plan.pairs.reduce((n, x) => n + x.current.days, 0);
        const cmpFig = IncomeExpenseReport.figures(facts, comparedSpans, policy, perDay ? days : undefined);
        const curFig = IncomeExpenseReport.figures(
          facts,
          plan.pairs.map((x) => x.current),
          policy,
          perDay ? currentDays : undefined,
        );
        totalComparison = comparisonOf(curFig, cmpFig);
        comparisonMeta = {
          mode,
          from: comparedSpans.reduce((m, x) => (x.from < m ? x.from : m), comparedSpans[0]!.from),
          to: comparedSpans.reduce((m, x) => (x.to > m ? x.to : m), comparedSpans[0]!.to),
          days,
          currentDays,
          normalized: perDay,
        };
      }
      const meta = await ctx.meta({
        reportId: 'INCOME_EXPENSES',
        periods,
        comparison: comparisonMeta,
        policy: 'TRANSACTION_DATE',
      });
      return {
        meta,
        granularity,
        rows,
        totals: {
          income: amountDto(total.income),
          expenses: amountDto(total.expenses),
          savings: amountDto(total.savings),
          savingsRate: total.savingsRate,
          comparison: totalComparison,
        },
      };
    });
  }

  /** Reporte 3: gasto por grupo → categoría → subcategoría del rango, con top N y comparación de rango. */
  getExpensesByCategory(
    params: ExpensesByCategoryParams,
  ): Promise<ReportResult<ExpensesByCategoryReportDto>> {
    return this.run('EXPENSES_BY_CATEGORY', params, async (ctx) => {
      const mode = params.compare ?? 'NONE';
      if (params.rolling !== undefined) throw invalid('rolling is not supported by this report', '/rolling');
      if (
        params.topN !== undefined &&
        !(Number.isInteger(params.topN) && params.topN >= 1 && params.topN <= 50)
      ) {
        throw invalid('topN must be between 1 and 50', '/topN');
      }
      const periods = ctx.calendar.periods(params.from, params.to);
      // Rango comparado: el bloque de periodos inmediatamente anterior, el mismo tramo un año antes o el pedido.
      let compared: { from: string; to: string; days: number } | null = null;
      if (mode === 'PREVIOUS_PERIOD') {
        const prior = ctx.calendar.priorPeriods(periods[0]!, periods.length);
        compared = { from: prior.at(-1)!.from, to: prior[0]!.to, days: 0 };
      } else if (mode === 'PREVIOUS_YEAR') {
        compared = {
          from: ctx.calendar.yearAgo(periods[0]!).from,
          to: ctx.calendar.yearAgo(periods.at(-1)!).to,
          days: 0,
        };
      } else if (mode === 'PREVIOUS_PERIOD_TO_DATE') {
        if (periods.length !== 1) throw invalid('compare to date needs a single period', '/compare');
        const [pair] = ReportComparator.pairs('PREVIOUS_PERIOD_TO_DATE', periods, ctx.calendar);
        compared = { from: pair!.compared.from, to: pair!.compared.to, days: pair!.compared.days };
      } else if (mode === 'CUSTOM') {
        const custom = ReportComparator.customRange(params.compareFrom, params.compareTo, ctx.calendar);
        compared = { from: params.compareFrom!, to: params.compareTo!, days: custom.days };
      }
      if (compared) compared = { ...compared, days: daysBetween(compared.from, compared.to) };
      const spans: Span[] = [{ from: params.from, to: params.to }];
      if (compared) spans.push(compared);
      const facts = await this.loadFacts(ctx, spans, 'EXPENSE');
      await ctx.resolveRates(this.datedOf(ctx, facts));
      const policy = ctx.flowPolicy();
      const perDay = params.normalize === 'PER_DAY';
      const currentDays = daysBetween(params.from, params.to);
      const within = (span: Span) => facts.filter((f) => f.date >= span.from && f.date <= span.to);
      const build = (span: Span, days: number, topN?: number) =>
        CategoryTreeReport.build({
          flows: within(span),
          groups: ctx.tree.groups,
          categories: ctx.tree.categories,
          policy,
          ...(topN !== undefined ? { topN } : {}),
          ...(perDay ? { perDays: days } : {}),
        });
      const tree = build({ from: params.from, to: params.to }, currentDays, params.topN);
      // La comparación recorre el árbol completo del rango comparado (sin top N) por id de categoría o grupo.
      const cmpTree = compared ? build(compared, compared.days) : null;
      const cmpById = new Map<string, ReportAmount>();
      const cmpGroups = new Map<string, ReportAmount>();
      for (const g of cmpTree?.groups ?? []) {
        cmpGroups.set(g.groupId, g.amount);
        for (const c of g.categories) {
          cmpById.set(c.categoryId, c.amount);
          for (const s of c.subcategories) cmpById.set(s.categoryId, s.amount);
        }
      }
      const zero = policy.zero();
      const vs = (cur: ReportAmount, prev: ReportAmount | undefined) =>
        compared ? variationDto(ReportComparator.variation(cur, prev ?? zero, ctx.reporting)) : null;
      const leaf = (c: {
        categoryId: string;
        name: string;
        archived: boolean;
        amount: ReportAmount;
        negativeNet: boolean;
      }): CategoryLeafReportDto => ({
        categoryId: c.categoryId,
        name: c.name,
        archived: c.archived,
        amount: amountDto(c.amount),
        negativeNet: c.negativeNet,
        comparison: vs(c.amount, cmpById.get(c.categoryId)),
      });
      ctx.track(tree.total);
      const meta = await ctx.meta({
        reportId: 'EXPENSES_BY_CATEGORY',
        periods,
        comparison: compared
          ? {
              mode,
              from: compared.from,
              to: compared.to,
              days: compared.days,
              currentDays,
              normalized: perDay,
            }
          : null,
        policy: 'TRANSACTION_DATE',
      });
      return {
        meta,
        groups: tree.groups.map((g) => ({
          groupId: g.groupId,
          name: g.name,
          amount: amountDto(g.amount),
          negativeNet: g.negativeNet,
          comparison: vs(g.amount, cmpGroups.get(g.groupId)),
          categories: g.categories.map((c) => ({ ...leaf(c), subcategories: c.subcategories.map(leaf) })),
        })),
        others: tree.others ? amountDto(tree.others) : null,
        total: amountDto(tree.total),
      };
    });
  }

  // ───────────────────────────────────────────── reporte 2: presupuesto vs real

  getBudgetVsActual(params: ReportParams): Promise<ReportResult<BudgetVsActualReportDto>> {
    return this.run('BUDGET_VS_ACTUAL', params, async (ctx) => {
      if (params.grouping === 'CALENDAR_MONTH') {
        throw invalid('budget vs actual always groups by financial period', '/grouping');
      }
      const financial = (await this.deps.periods.listPeriods({ workspaceId: params.workspaceId }))
        .filter((p) => p.periodEnd >= params.from && p.periodStart <= params.to)
        .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
      if (financial.length > 24) throw invalid('the range covers more than 24 periods', '/from');
      const names = new Map<string, string>([
        ...ctx.tree.categories.map((c) => [c.categoryId, c.name] as const),
        ...ctx.tree.groups.map((g) => [g.groupId, g.name] as const),
        ...ctx.tree.tags.map((t) => [t.tagId, t.name] as const),
      ]);
      const used = new Map<string, ReportMetaDto['conversion']['ratesUsed'][number]>();
      const periods = [];
      const reportPeriods: ReportPeriod[] = [];
      // Secuencial: cada llamada a PLANNING usa el mismo cliente de la unidad de trabajo.
      for (const fp of financial) {
        const period = ctx.calendar.periodOf(fp.periodStart);
        const view = { ...period, label: fp.label, from: fp.periodStart, to: fp.periodEnd };
        reportPeriods.push(view);
        const vs = await this.deps.budgets.getForPeriod({ workspaceId: params.workspaceId, periodId: fp.id });
        if (!vs) {
          periods.push({
            period: periodDto(view),
            status: 'NO_BUDGET' as const,
            budgetId: null,
            periodId: fp.id,
            currency: null,
            lines: [],
            totals: null,
            ratesUsed: [],
          });
          continue;
        }
        for (const r of vs.ratesUsed) used.set(`${r.fxRateId ?? ''}|${r.rate.base}|${r.rate.quote}`, r);
        periods.push({
          period: periodDto(view),
          status: 'BUDGETED' as const,
          budgetId: vs.budgetId,
          periodId: fp.id,
          currency: vs.currency,
          lines: vs.lines.map((l) => ({
            budgetLineId: l.budgetLineId,
            target: { kind: l.target.kind, id: l.target.id, name: names.get(l.target.id) ?? l.target.id },
            nature: l.nature,
            kind: l.kind,
            reference: l.reference,
            actual: l.actual,
            actualComplete: l.actualComplete,
            status: l.status,
          })),
          totals: { ...vs.totals },
          ratesUsed: vs.ratesUsed,
        });
      }
      await ctx.resolveRates([]);
      const meta = await ctx.meta({
        reportId: 'BUDGET_VS_ACTUAL',
        periods: reportPeriods,
        comparison: null,
        policy: 'TRANSACTION_DATE',
      });
      const incomplete = periods.some((p) => p.totals && !p.totals.complete);
      return {
        meta: {
          ...meta,
          complete: !incomplete,
          conversion: { ...meta.conversion, ratesUsed: [...used.values()] },
        },
        periods,
      };
    });
  }

  // ───────────────────────────────────────────── reporte 7: flujo de caja histórico

  getCashFlow(params: ReportParams): Promise<ReportResult<CashFlowReportDto>> {
    return this.run('CASH_FLOW', params, async (ctx) => {
      const mode = params.compare ?? 'NONE';
      if (mode === 'CUSTOM' || mode === 'PREVIOUS_PERIOD_TO_DATE' || params.rolling !== undefined) {
        throw invalid('cash flow supports previous period and previous year comparisons only', '/compare');
      }
      const periods = ctx.calendar.periods(params.from, params.to);
      const pairs = mode === 'NONE' ? [] : ReportComparator.pairs(mode, periods, ctx.calendar);
      const all: ReportPeriod[] = [...periods, ...pairs.map((p) => p.compared)];
      const accounts = (await this.deps.accounts.listAccounts({ workspaceId: params.workspaceId })).filter(
        (a) =>
          a.liquidity === 'LIQUID' &&
          a.status !== ('ARCHIVED' as string) &&
          (ctx.filters.accountIds.length === 0 || ctx.filters.accountIds.includes(a.accountId)) &&
          (ctx.filters.currencies.length === 0 || ctx.filters.currencies.includes(a.currency)),
      );
      const ids = accounts.map((a) => a.accountId);
      const empty = ids.length === 0;
      // Saldos contables en las dos fechas de cada periodo, en UNA llamada.
      const dateSet = new Set<string>();
      for (const p of all) {
        dateSet.add(plusDays(LocalDate.parse(p.from), -1).toString());
        dateSet.add(p.to);
      }
      const dates = [...dateSet].sort();
      const history = empty
        ? { byDate: [] as { asOf: string; balances: { balance: { amount: string; currency: string } }[] }[] }
        : await this.deps.balanceHistory.getAccountBalancesAtDates({
            workspaceId: params.workspaceId,
            accountIds: ids,
            dates,
          });
      const balancesAt = (date: string): Money[] => {
        const entry = history.byDate.find((d) => d.asOf === date);
        const sums = new Map<string, Money>();
        for (const b of entry?.balances ?? []) {
          const m = ctx.money(b.balance);
          const prev = sums.get(m.currency.code);
          sums.set(m.currency.code, prev ? prev.add(m) : m);
        }
        return [...sums.values()];
      };
      const spans = mergeSpans(all.map((p) => ({ from: p.from, to: p.to })));
      const setFlows: SetFlow[] = [];
      if (!empty) {
        for (const span of spans) {
          const rows = await this.deps.accountFlows.summarize({
            workspaceId: params.workspaceId,
            accountIds: ids,
            dateFrom: span.from,
            dateTo: span.to,
          });
          for (const r of rows) {
            if (ctx.filters.currencies.length > 0 && !ctx.filters.currencies.includes(r.currency)) continue;
            setFlows.push({
              date: r.businessDate,
              counterpart: r.counterpart as FlowCounterpart,
              amount: ctx.money({ amount: r.amount, currency: r.currency }),
            });
          }
        }
      }
      // Tasas: flujos a la de su día (o la de corte) y saldos a la de su fecha de valoración.
      const dated: DatedAmount[] = [
        ...setFlows.map((f) => ({ date: ctx.flowDate(f.date), amount: f.amount })),
        ...dates.flatMap((d) => balancesAt(d).map((m) => ({ date: d, amount: m }))),
      ];
      await ctx.resolveRates(dated);
      const flowPolicy = ctx.flowPolicy();
      const balancePolicy = ctx.balancePolicy();
      const currencies = new Map([...ctx.known]);
      const figures = (p: ReportPeriod) =>
        LiquidityFlowReport.build({
          currencies: new Map([
            ...currencies,
            ...[...balancesAt(p.to), ...balancesAt(plusDays(LocalDate.parse(p.from), -1).toString())].map(
              (m) => [m.currency.code, m.currency] as const,
            ),
            ...setFlows.map((f) => [f.amount.currency.code, f.amount.currency] as const),
          ]),
          openingDate: plusDays(LocalDate.parse(p.from), -1).toString(),
          closingDate: p.to,
          opening: balancesAt(plusDays(LocalDate.parse(p.from), -1).toString()),
          closing: balancesAt(p.to),
          flows: setFlows.filter((f) => f.date >= p.from && f.date <= p.to),
          flowPolicy,
          balancePolicy,
        });
      const out: CashFlowReportDto['periods'] = periods.map((period, i) => {
        const fig = figures(period);
        const c = fig.consolidated;
        ctx.track(c.closing);
        for (const comp of Object.values(c.components)) ctx.track(comp);
        let comparison: Record<string, ReturnType<typeof variationDto>> | null = null;
        const pair = pairs[i];
        if (pair) {
          const cmp = figures(pair.compared).consolidated;
          comparison = {};
          for (const k of LIQUIDITY_COMPONENTS) {
            comparison[k] = variationDto(
              ReportComparator.variation(c.components[k], cmp.components[k], ctx.reporting),
            );
          }
          comparison.closing = variationDto(
            ReportComparator.variation(c.closing, cmp.closing, ctx.reporting),
          );
        }
        return {
          period: periodDto(period),
          byCurrency: fig.byCurrency.map((b) => ({
            currency: b.currency,
            opening: b.opening.toJSON(),
            operating: b.operating.toJSON(),
            debt: b.debt.toJSON(),
            savingsInvestments: b.savingsInvestments.toJSON(),
            currencyExchange: b.currencyExchange.toJSON(),
            adjustments: b.adjustments.toJSON(),
            closing: b.closing.toJSON(),
          })),
          consolidated: {
            opening: c.opening.consolidated.toJSON(),
            operating: c.components.operating.consolidated.toJSON(),
            debt: c.components.debt.consolidated.toJSON(),
            savingsInvestments: c.components.savingsInvestments.consolidated.toJSON(),
            currencyExchange: c.components.currencyExchange.consolidated.toJSON(),
            adjustments: c.components.adjustments.consolidated.toJSON(),
            revaluation: c.revaluation.toJSON(),
            closing: c.closing.consolidated.toJSON(),
            complete: c.complete,
            unconverted: c.unconverted.map((m) => m.toJSON()),
          },
          comparison,
        };
      });
      const meta = await ctx.meta({
        reportId: 'CASH_FLOW',
        periods,
        comparison: pairs.length
          ? {
              mode,
              from: pairs.reduce(
                (m, x) => (x.compared.from < m ? x.compared.from : m),
                pairs[0]!.compared.from,
              ),
              to: pairs.reduce((m, x) => (x.compared.to > m ? x.compared.to : m), pairs[0]!.compared.to),
              days: pairs.reduce((n, x) => n + x.compared.days, 0),
              currentDays: periods.reduce((n, x) => n + x.days, 0),
              normalized: false,
            }
          : null,
        policy: 'TRANSACTION_DATE',
      });
      return { meta, periods: out };
    });
  }

  // ───────────────────────────────────────────── reporte 15: historial de saldo de una cuenta

  getAccountBalanceHistory(
    params: ReportParams & { readonly accountId: string },
  ): Promise<ReportResult<AccountBalanceHistoryReportDto>> {
    return this.run('ACCOUNT_BALANCE_HISTORY', params, async (ctx) => {
      if (params.compare && params.compare !== 'NONE')
        throw invalid('comparisons are not supported', '/compare');
      const account = (
        await this.deps.accounts.listAccounts({ workspaceId: params.workspaceId, includeArchived: true })
      ).find((a) => a.accountId === params.accountId);
      if (!account) throw new DomainError('RESOURCE_NOT_FOUND', 'account not found');
      LocalDate.parse(params.from);
      LocalDate.parse(params.to);
      if (params.from > params.to) throw invalid('from must not be after to', '/from');
      const days = daysBetween(params.from, params.to);
      if (days > MAX_BALANCE_HISTORY_DAYS) {
        throw invalid(`the range covers more than ${MAX_BALANCE_HISTORY_DAYS} days`, '/from');
      }
      const currency = ctx.currencyOf(account.currency);
      const dayBefore = plusDays(LocalDate.parse(params.from), -1).toString();
      const open = await this.deps.balanceHistory.getAccountBalancesAtDates({
        workspaceId: params.workspaceId,
        accountIds: [params.accountId],
        dates: [dayBefore],
      });
      const openingRow = open.byDate[0]?.balances.find((b) => b.accountId === params.accountId);
      const opening = openingRow ? ctx.money(openingRow.balance) : Money.zero(currency);
      const deltas = new Map<string, Money>();
      const rows = await this.deps.accountFlows.summarize({
        workspaceId: params.workspaceId,
        accountIds: [params.accountId],
        dateFrom: params.from,
        dateTo: params.to,
      });
      for (const r of rows) {
        const m = ctx.money({ amount: r.amount, currency: r.currency });
        const prev = deltas.get(r.businessDate);
        deltas.set(r.businessDate, prev ? prev.add(m) : m);
      }
      const marks = await this.deps.marks.closedStatementDates({
        workspaceId: params.workspaceId,
        accountId: params.accountId,
        from: params.from,
        to: params.to,
      });
      const series = BalanceStepSeries.build({
        from: params.from,
        to: params.to,
        opening,
        deltas,
        reconciledDates: new Set(marks),
      });
      // Valoración opcional con la tasa de cada fecha (solo si se pidió moneda de reporte).
      const valued = params.reportingCurrency !== undefined;
      await ctx.resolveRates(valued ? series.days.map((d) => ({ date: d.date, amount: d.balance })) : []);
      const policy = ctx.balancePolicy();
      const outDays = series.days.map((d) => {
        let v: Money | null = null;
        if (valued) {
          const amount = policy.value([{ date: d.date, amount: d.balance }]);
          ctx.track(amount);
          v = amount.complete ? amount.consolidated : null;
        }
        return {
          date: d.date,
          balance: d.balance.toJSON(),
          valued: v?.toJSON() ?? null,
          hasMovements: d.hasMovements,
          reconciled: d.reconciled,
        };
      });
      const meta = await ctx.meta({
        reportId: 'ACCOUNT_BALANCE_HISTORY',
        periods: [],
        comparison: null,
        policy: 'VALUATION_DATE',
      });
      return {
        meta,
        accountId: params.accountId,
        currency: account.currency,
        opening: opening.toJSON(),
        days: outDays,
        closing: series.closing.toJSON(),
      };
    });
  }

  // ───────────────────────────────────────────── reporte 8: patrimonio neto

  getNetWorth(params: NetWorthParams): Promise<ReportResult<NetWorthReportDto>> {
    return this.run('NET_WORTH', params, async (ctx) => {
      if (params.compare && params.compare !== 'NONE')
        throw invalid('comparisons are not supported', '/compare');
      const granularity = params.granularity ?? 'PERIOD';
      const periods = ctx.calendar.periods(params.from, params.to);
      if (granularity === 'DAY' && daysBetween(params.from, params.to) > MAX_NET_WORTH_DAYS) {
        throw invalid(`the daily series covers up to ${MAX_NET_WORTH_DAYS} days`, '/from');
      }
      const accounts = (
        await this.deps.accounts.listAccounts({ workspaceId: params.workspaceId, includeArchived: true })
      ).filter((a) => a.includeInNetWorth);
      const ids = accounts.map((a) => a.accountId);
      const dayBefore = (d: string) => plusDays(LocalDate.parse(d), -1).toString();
      const dateSet = new Set<string>();
      for (const p of periods) {
        dateSet.add(dayBefore(p.from));
        dateSet.add(p.to);
      }
      if (granularity === 'DAY') dateSet.add(dayBefore(params.from));
      const dates = [...dateSet].sort();
      const history =
        ids.length === 0
          ? {
              byDate: [] as { asOf: string; balances: { balance: { amount: string; currency: string } }[] }[],
            }
          : await this.deps.balanceHistory.getAccountBalancesAtDates({
              workspaceId: params.workspaceId,
              accountIds: ids,
              dates,
            });
      const balancesAt = (date: string): Money[] => {
        const sums = new Map<string, Money>();
        for (const b of history.byDate.find((d) => d.asOf === date)?.balances ?? []) {
          const m = ctx.money(b.balance);
          const prev = sums.get(m.currency.code);
          sums.set(m.currency.code, prev ? prev.add(m) : m);
        }
        return [...sums.values()];
      };
      const flows: { date: string; currency: string; counterpart: FlowCounterpart; amount: Money }[] = [];
      if (ids.length > 0) {
        for (const r of await this.deps.accountFlows.summarize({
          workspaceId: params.workspaceId,
          accountIds: ids,
          dateFrom: periods[0]!.from,
          dateTo: periods.at(-1)!.to,
        })) {
          flows.push({
            date: r.businessDate,
            currency: r.currency,
            counterpart: r.counterpart as FlowCounterpart,
            amount: ctx.money({ amount: r.amount, currency: r.currency }),
          });
        }
      }
      // Serie diaria: saldo inicial + flujos acumulados por moneda; una tasa por (moneda, día).
      const dailyBalances = new Map<string, Money[]>();
      if (granularity === 'DAY') {
        const running = new Map<string, Money>(
          balancesAt(dayBefore(params.from)).map((m) => [m.currency.code, m]),
        );
        const byDay = new Map<string, Money[]>();
        for (const f of flows) byDay.set(f.date, [...(byDay.get(f.date) ?? []), f.amount]);
        for (
          let e = LocalDate.parse(params.from).toEpochDay();
          e <= LocalDate.parse(params.to).toEpochDay();
          e += 1
        ) {
          const date = LocalDate.ofEpochDay(e).toString();
          for (const m of byDay.get(date) ?? []) {
            const prev = running.get(m.currency.code);
            running.set(m.currency.code, prev ? prev.add(m) : m);
          }
          dailyBalances.set(date, [...running.values()]);
        }
      }
      const dated: DatedAmount[] = [
        ...flows.map((f) => ({ date: f.date, amount: f.amount })),
        ...dates.flatMap((d) => balancesAt(d).map((m) => ({ date: d, amount: m }))),
        ...[...dailyBalances.entries()].flatMap(([d, ms]) => ms.map((m) => ({ date: d, amount: m }))),
      ];
      await ctx.resolveRates(dated);
      const policy = ctx.balancePolicy();
      const points: { date: string; netWorth: ReturnType<typeof amountDto> }[] = [];
      if (granularity === 'DAY') {
        for (const [date, ms] of dailyBalances) {
          const nw = policy.value(ms.map((amount) => ({ date, amount })));
          ctx.track(nw);
          points.push({ date, netWorth: amountDto(nw) });
        }
      } else {
        for (const p of periods) {
          const nw = policy.value(balancesAt(p.to).map((amount) => ({ date: p.to, amount })));
          ctx.track(nw);
          points.push({ date: p.to, netWorth: amountDto(nw) });
        }
      }
      const allCurrencies = new Map(ctx.known);
      for (const f of flows) allCurrencies.set(f.currency, f.amount.currency);
      for (const d of dates) for (const m of balancesAt(d)) allCurrencies.set(m.currency.code, m.currency);
      const decomposition = periods.map((period) => {
        const d = NetWorthDecomposer.decompose({
          target: ctx.reporting,
          currencies: allCurrencies,
          kinds: ctx.kinds,
          opening: balancesAt(dayBefore(period.from)),
          closing: balancesAt(period.to),
          openingDate: dayBefore(period.from),
          closingDate: period.to,
          flows: flows.filter((f) => f.date >= period.from && f.date <= period.to),
          rateFor: (code, date) => ctx.rateFor(code, date),
        });
        if (!d.complete) {
          // Una moneda sin tasa deja la descomposición (y el reporte) incompleta.
          ctx.track({ ...policy.zero(), complete: false, unconverted: d.unvalued });
        }
        return {
          period: periodDto(period),
          opening: d.opening.toJSON(),
          closing: d.closing.toJSON(),
          savings: d.savings.toJSON(),
          conversionResult: d.conversionResult.toJSON(),
          adjustments: d.adjustments.toJSON(),
          otherMovements: d.otherMovements.toJSON(),
          fxRevaluation: d.fxRevaluation.toJSON(),
          assetRevaluation: d.assetRevaluation.toJSON(),
          revaluationByCurrency: d.revaluationByCurrency.map((r) => ({
            currency: r.currency,
            kind: r.kind,
            amount: r.amount.toJSON(),
          })),
          complete: d.complete,
          unvalued: d.unvalued.map((m) => m.toJSON()),
        };
      });
      const meta = await ctx.meta({
        reportId: 'NET_WORTH',
        periods,
        comparison: null,
        policy: 'TRANSACTION_DATE',
      });
      return { meta, granularity, points, decomposition };
    });
  }
}

export { ReportConversionPolicy };
