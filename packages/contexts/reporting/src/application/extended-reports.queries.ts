import { DomainError, Money, type DatedAmount } from '@pf/shared-kernel';
import type {
  ConversionsReportDto,
  DebtsReportDto,
  ExpensesByAccountReportDto,
  ExpensesByTagReportDto,
  FeesReportDto,
  GoalsReportDto,
  RecurringCostsReportDto,
  SubscriptionsReportDto,
  TrendsReportDto,
} from '../contracts/financial-reports.js';
import {
  AccountSpendReport,
  ConversionScatter,
  DebtEvolutionSeries,
  FeeBreakdown,
  GoalProgressSeries,
  RecurringCostTable,
  ReportComparator,
  SubscriptionCostSeries,
  TagReport,
  TrendMatrix,
  type AccountFact,
  type DebtInfo,
  type DebtMonthInput,
  type FeeFact,
  type ReportAmount,
  type ReportPeriod,
  type SubscriptionEvent,
  type TagFact,
  type TrendFact,
} from '../domain/index.js';
import { FinancialReportsQueries, type ReportResult } from './financial-reports.queries.js';
import type { ExtendedReportDeps } from './ports/extended-reports.js';
import {
  amountDto,
  invalid,
  mergeSpans,
  periodDto,
  variationDto,
  type ReportContext,
  type ReportParams,
  type Span,
} from './report-context.js';

export type ExpensesByTagParams = ReportParams;
export type TrendsParams = ReportParams;

export interface GoalsParams extends ReportParams {
  readonly goalIds?: readonly string[];
}

export interface DebtsParams extends ReportParams {
  readonly debtKind?: 'LOAN' | 'CARD';
}

export interface RecurringCostsParams extends Omit<ReportParams, 'from' | 'to'> {
  readonly from?: string;
  readonly to?: string;
}

const MONTHLY = 'CALENDAR_MONTH' as const;
const OTHERS = 'Otras categorías';

/**
 * Reportes ampliados de REPORTING (add-financial-reports-extended, FR-REPORTING-008): etiquetas, cuentas, tendencias,
 * comisiones, metas, deudas, costos recurrentes, suscripciones y conversiones. Misma construcción que el núcleo: una
 * unidad de trabajo de lectura, una resolución de tasas por petición, lecturas secuenciales y cálculo en los DS puros.
 * Sin efectos.
 */
export class ExtendedReportsQueries extends FinancialReportsQueries {
  protected ext(): ExtendedReportDeps {
    const ext = this.deps.extended;
    if (!ext) throw new DomainError('SERVICE_UNAVAILABLE', 'the extended reports are not configured');
    return ext;
  }

  /** Meses calendario de un rango (los reportes por mes ignoran la agrupación por periodo financiero). */
  private monthly(params: ReportParams): ReportParams {
    if (params.grouping !== undefined && params.grouping !== MONTHLY) {
      throw invalid('this report always groups by calendar month', '/grouping');
    }
    return { ...params, grouping: MONTHLY };
  }

  private noComparison(params: Pick<ReportParams, 'compare' | 'rolling'>): void {
    if ((params.compare && params.compare !== 'NONE') || params.rolling !== undefined) {
      throw invalid('comparisons are not supported by this report', '/compare');
    }
  }

  private comparisonMeta(
    params: ReportParams,
    compared: { from: string; to: string; days: number } | null,
    currentDays: number,
    perDay: boolean,
  ) {
    return compared
      ? {
          mode: params.compare ?? 'NONE',
          from: compared.from,
          to: compared.to,
          days: compared.days,
          currentDays,
          normalized: perDay,
        }
      : null;
  }

  // ───────────────────────────────────────────── reporte 4: gastos por etiqueta

  private async tagFacts(ctx: ReportContext, spans: readonly Span[]): Promise<TagFact[]> {
    const f = ctx.filters;
    const facts: TagFact[] = [];
    for (const span of mergeSpans(spans)) {
      const rows = await this.deps.flows.summarizeNominalFlows({
        workspaceId: ctx.params.workspaceId,
        dateFrom: span.from,
        dateTo: span.to,
        withTags: true,
        ...(f.requestedCategoryIds.length > 0 ? { categoryIds: f.categoryIds } : {}),
        ...(f.accountIds.length > 0 ? { accountIds: f.accountIds } : {}),
        ...(f.counterpartyIds.length > 0 ? { counterpartyIds: f.counterpartyIds } : {}),
        ...(f.tagIds.length > 0 ? { tagIds: f.tagIds, tagMatch: f.tagMatch } : {}),
        ...(f.currencies.length > 0 ? { currencies: f.currencies } : {}),
      });
      for (const r of rows) {
        if (r.nature !== 'EXPENSE') continue;
        facts.push({ date: r.businessDate, amount: ctx.money(r.amount), tagIds: r.tagIds ?? [] });
      }
    }
    return facts;
  }

  /** Reporte 4: gasto por etiqueta (cualquiera o todas), con aviso de no aditividad y comparación de rango. */
  getExpensesByTag(params: ExpensesByTagParams): Promise<ReportResult<ExpensesByTagReportDto>> {
    return this.run('EXPENSES_BY_TAG', params, async (ctx) => {
      if (params.rolling !== undefined) throw invalid('rolling is not supported by this report', '/rolling');
      const match = ctx.filters.tagMatch;
      if (match === 'ALL' && ctx.filters.tagIds.length === 0) {
        throw invalid('tagMatch ALL needs at least one tagId', '/tagMatch');
      }
      const periods = ctx.calendar.periods(params.from, params.to);
      const compared = this.comparedSpan(ctx, params, periods);
      const spans: Span[] = [{ from: params.from, to: params.to }];
      if (compared) spans.push(compared);
      const facts = await this.tagFacts(ctx, spans);
      await ctx.resolveRates(facts.map((x) => ({ date: ctx.flowDate(x.date), amount: x.amount })));
      const policy = ctx.flowPolicy();
      const perDay = params.normalize === 'PER_DAY';
      const currentDays = periods.reduce((n, p) => n + p.days, 0);
      const build = (span: Span, days: number) =>
        TagReport.build({
          facts: facts.filter((x) => x.date >= span.from && x.date <= span.to),
          tags: ctx.tree.tags,
          requested: ctx.filters.tagIds,
          match,
          policy,
          ...(perDay ? { perDays: days } : {}),
        });
      const current = build({ from: params.from, to: params.to }, currentDays);
      const previous = compared ? build(compared, compared.days) : null;
      const before = new Map(previous?.tags.map((t) => [t.tagId, t.amount]));
      const tags = current.tags.map((t) => {
        ctx.track(t.amount);
        return {
          tagId: t.tagId,
          name: t.name,
          archived: t.archived,
          amount: amountDto(t.amount),
          comparison: compared
            ? variationDto(
                ReportComparator.variation(t.amount, before.get(t.tagId) ?? policy.zero(), ctx.reporting),
              )
            : null,
        };
      });
      const meta = await ctx.meta({
        reportId: 'EXPENSES_BY_TAG',
        periods,
        comparison: this.comparisonMeta(params, compared, currentDays, perDay),
        policy: 'TRANSACTION_DATE',
      });
      return { meta, nonAdditive: true, tagMatch: match, tags };
    });
  }

  // ───────────────────────────────────────────── reporte 5: gastos por cuenta

  private async accountFacts(ctx: ReportContext, spans: readonly Span[]): Promise<AccountFact[]> {
    const f = ctx.filters;
    const facts: AccountFact[] = [];
    for (const span of mergeSpans(spans)) {
      const rows = await this.deps.flows.summarizeNominalFlows({
        workspaceId: ctx.params.workspaceId,
        dateFrom: span.from,
        dateTo: span.to,
        groupBy: ['ACCOUNT'],
        ...(f.requestedCategoryIds.length > 0 ? { categoryIds: f.categoryIds } : {}),
        ...(f.accountIds.length > 0 ? { accountIds: f.accountIds } : {}),
        ...(f.counterpartyIds.length > 0 ? { counterpartyIds: f.counterpartyIds } : {}),
        ...(f.tagIds.length > 0 ? { tagIds: f.tagIds, tagMatch: f.tagMatch } : {}),
        ...(f.currencies.length > 0 ? { currencies: f.currencies } : {}),
      });
      for (const r of rows) {
        if (r.nature !== 'EXPENSE' || r.accountId === undefined) continue;
        facts.push({
          date: r.businessDate,
          accountId: r.accountId,
          categoryId: r.categoryId,
          amount: ctx.money(r.amount),
        });
      }
    }
    return facts;
  }

  /** Reporte 5: gasto por cuenta pagadora con su tipo e institución, apilado por categoría. Σ cuentas = gasto. */
  getExpensesByAccount(params: ReportParams): Promise<ReportResult<ExpensesByAccountReportDto>> {
    return this.run('EXPENSES_BY_ACCOUNT', params, async (ctx) => {
      if (params.rolling !== undefined) throw invalid('rolling is not supported by this report', '/rolling');
      const periods = ctx.calendar.periods(params.from, params.to);
      const compared = this.comparedSpan(ctx, params, periods);
      const spans: Span[] = [{ from: params.from, to: params.to }];
      if (compared) spans.push(compared);
      const facts = await this.accountFacts(ctx, spans);
      await ctx.resolveRates(facts.map((x) => ({ date: ctx.flowDate(x.date), amount: x.amount })));
      const policy = ctx.flowPolicy();
      const accounts = (
        await this.deps.accounts.listAccounts({ workspaceId: params.workspaceId, includeArchived: true })
      ).map((a) => ({
        accountId: a.accountId,
        name: a.name,
        type: a.type,
        institutionId: a.institutionId ?? null,
      }));
      const build = (span: Span) =>
        AccountSpendReport.build({
          facts: facts.filter((x) => x.date >= span.from && x.date <= span.to),
          accounts,
          policy,
        });
      const current = build({ from: params.from, to: params.to });
      const previous = compared ? build(compared) : null;
      const before = new Map(previous?.accounts.map((a) => [a.accountId, a.amount]));
      const categoryName = new Map(ctx.tree.categories.map((c) => [c.categoryId, c.name]));
      ctx.track(current.total);
      const vs = (cur: ReportAmount, prev: ReportAmount | undefined) =>
        compared ? variationDto(ReportComparator.variation(cur, prev ?? policy.zero(), ctx.reporting)) : null;
      const meta = await ctx.meta({
        reportId: 'EXPENSES_BY_ACCOUNT',
        periods,
        comparison: this.comparisonMeta(
          params,
          compared,
          periods.reduce((n, p) => n + p.days, 0),
          false,
        ),
        policy: 'TRANSACTION_DATE',
      });
      return {
        meta,
        accounts: current.accounts.map((a) => ({
          accountId: a.accountId,
          name: a.name,
          type: a.type,
          institutionId: a.institutionId,
          amount: amountDto(a.amount),
          comparison: vs(a.amount, before.get(a.accountId)),
          byCategory: a.byCategory.map((c) => ({
            categoryId: c.categoryId,
            name: categoryName.get(c.categoryId) ?? c.categoryId,
            amount: amountDto(c.amount),
          })),
        })),
        total: amountDto(current.total),
        totalComparison: vs(current.total, previous?.total),
      };
    });
  }

  // ───────────────────────────────────────────── reporte 6: tendencias mensuales

  /** Reporte 6: matriz categoría × periodo (6, 12 o 24 periodos), 7 series más "Otras categorías", normalizable por día. */
  getTrends(params: TrendsParams): Promise<ReportResult<TrendsReportDto>> {
    return this.run('MONTHLY_TRENDS', params, async (ctx) => {
      this.noComparison(params);
      const periods = ctx.calendar.periods(params.from, params.to);
      const facts: TrendFact[] = (
        await this.loadFacts(ctx, [{ from: params.from, to: params.to }], 'EXPENSE')
      ).map((x) => ({ date: x.date, categoryId: x.categoryId, amount: x.amount }));
      await ctx.resolveRates(facts.map((x) => ({ date: ctx.flowDate(x.date), amount: x.amount })));
      const perDay = params.normalize === 'PER_DAY';
      const byId = new Map(ctx.tree.categories.map((c) => [c.categoryId, c]));
      const series = TrendMatrix.build({
        facts,
        categories: ctx.tree.categories.map((c) => ({
          categoryId: c.categoryId,
          name: c.name,
          topId: c.parentId ?? c.categoryId,
        })),
        periods,
        policy: ctx.flowPolicy(),
        perDay,
        othersName: OTHERS,
      });
      for (const s of series) {
        ctx.track(s.total);
        for (const cell of s.cells) ctx.track(cell.amount);
      }
      const meta = await ctx.meta({
        reportId: 'MONTHLY_TRENDS',
        periods,
        comparison: null,
        policy: 'TRANSACTION_DATE',
      });
      return {
        meta,
        normalized: perDay,
        series: series.map((s) => ({
          categoryId: s.categoryId,
          name: s.categoryId === null ? s.name : (byId.get(s.categoryId)?.name ?? s.name),
          total: amountDto(s.total),
          cells: s.cells.map((c) => ({ period: periodDto(c.period), amount: amountDto(c.amount) })),
        })),
      };
    });
  }

  // ───────────────────────────────────────────── reporte 14: comisiones

  private async feeFacts(
    ctx: ReportContext,
    spans: readonly Span[],
  ): Promise<(FeeFact & { date: string })[]> {
    const f = ctx.filters;
    const facts: FeeFact[] = [];
    for (const span of mergeSpans(spans)) {
      const rows = await this.deps.flows.summarizeNominalFlows({
        workspaceId: ctx.params.workspaceId,
        dateFrom: span.from,
        dateTo: span.to,
        groupBy: ['ORIGIN'],
        ...(f.requestedCategoryIds.length > 0 ? { categoryIds: f.categoryIds } : {}),
        ...(f.accountIds.length > 0 ? { accountIds: f.accountIds } : {}),
        ...(f.counterpartyIds.length > 0 ? { counterpartyIds: f.counterpartyIds } : {}),
        ...(f.tagIds.length > 0 ? { tagIds: f.tagIds, tagMatch: f.tagMatch } : {}),
        ...(f.currencies.length > 0 ? { currencies: f.currencies } : {}),
      });
      for (const r of rows) {
        if (r.nature !== 'EXPENSE' || r.origin === undefined) continue;
        facts.push({
          date: r.businessDate,
          amount: ctx.money(r.amount),
          categoryId: r.categoryId,
          transactionKind: r.origin.transactionKind,
          portionRole: r.origin.portionRole,
        });
      }
    }
    return facts;
  }

  /** Reporte 14: comisiones por tipo y mes (cada porción en un solo tipo) y total de los últimos 12 meses completos. */
  getFees(params: ReportParams): Promise<ReportResult<FeesReportDto>> {
    return this.run('FEES', params, async (ctx) => {
      this.noComparison(params);
      const periods = ctx.calendar.periods(params.from, params.to);
      const last12 = ctx.calendar.priorPeriods(ctx.calendar.periodOf(ctx.today), 12);
      const spans: Span[] = [
        { from: params.from, to: params.to },
        { from: last12.at(-1)!.from, to: last12[0]!.to },
      ];
      const facts = await this.feeFacts(ctx, spans);
      await ctx.resolveRates(facts.map((x) => ({ date: ctx.flowDate(x.date), amount: x.amount })));
      const policy = ctx.flowPolicy();
      const feeCategoryIds = new Set(
        ctx.tree.categories.filter((c) => c.systemCode === 'FEES').map((c) => c.categoryId),
      );
      const months = FeeBreakdown.build({ facts, feeCategoryIds, periods, policy });
      const trailing = FeeBreakdown.last12Months(
        FeeBreakdown.build({ facts, feeCategoryIds, periods: last12, policy }),
        policy,
      );
      for (const m of months) {
        ctx.track(m.total);
        for (const b of m.byType) ctx.track(b.amount);
      }
      ctx.track(trailing);
      const meta = await ctx.meta({
        reportId: 'FEES',
        periods,
        comparison: null,
        policy: 'TRANSACTION_DATE',
      });
      return {
        meta,
        months: months.map((m) => ({
          period: periodDto(m.period),
          byType: m.byType.map((b) => ({ type: b.type, amount: amountDto(b.amount) })),
          total: amountDto(m.total),
        })),
        last12Months: amountDto(trailing),
      };
    });
  }

  // ───────────────────────────────────────────── reporte 9: metas de ahorro

  /** Reporte 9: aportes, retiros y acumulado mensual por meta contra la línea esperada (seguimiento de GOALS). */
  getGoals(params: GoalsParams): Promise<ReportResult<GoalsReportDto>> {
    return this.run('SAVINGS_GOALS', this.monthly(params), async (ctx) => {
      this.noComparison(params);
      ctx.calendar.periods(params.from, params.to);
      const rows = await this.ext().goals.monthly({
        workspaceId: params.workspaceId,
        ...(params.goalIds && params.goalIds.length > 0 ? { goalIds: params.goalIds } : {}),
        from: params.from,
        to: params.to,
      });
      await ctx.resolveRates([]);
      const series = GoalProgressSeries.build(
        rows.map((g) => ({
          goalId: g.goalId,
          name: g.name,
          currency: g.currency,
          target: ctx.money(g.target),
          startDate: g.startDate,
          targetDate: g.targetDate,
          months: g.months.map((m) => ({
            monthEnd: m.monthEnd,
            contributions: ctx.money(m.contributions),
            withdrawals: ctx.money(m.withdrawals),
            accumulated: ctx.money(m.accumulated),
            expected: m.expected ? ctx.money(m.expected) : null,
            status: m.status,
            complete: m.complete,
          })),
        })),
      );
      const meta = await ctx.meta({
        reportId: 'SAVINGS_GOALS',
        periods: ctx.calendar.periods(params.from, params.to),
        comparison: null,
        policy: 'VALUATION_DATE',
      });
      return {
        meta: { ...meta, complete: meta.complete && series.every((g) => g.months.every((m) => m.complete)) },
        goals: series.map((g) => ({
          goalId: g.goalId,
          name: g.name,
          currency: g.currency,
          target: g.target.toJSON(),
          startDate: g.startDate,
          targetDate: g.targetDate,
          months: g.months.map((m) => ({
            period: m.period,
            monthEnd: m.monthEnd,
            contributions: m.contributions.toJSON(),
            withdrawals: m.withdrawals.toJSON(),
            accumulated: m.accumulated.toJSON(),
            percent: m.percent,
            expected: m.expected?.toJSON() ?? null,
            status: m.status,
            complete: m.complete,
          })),
        })),
      };
    });
  }

  // ───────────────────────────────────────────── reporte 10: evolución de deudas

  /** Reporte 10: saldo pendiente al cierre (ledger) y principal, interés y cargos pagados por deuda y mes. */
  getDebts(params: DebtsParams): Promise<ReportResult<DebtsReportDto>> {
    return this.run('DEBT_EVOLUTION', this.monthly(params), async (ctx) => {
      this.noComparison(params);
      if (params.debtKind !== undefined && params.debtKind !== 'LOAN' && params.debtKind !== 'CARD') {
        throw invalid('debtKind must be LOAN or CARD', '/debtKind');
      }
      const ext = this.ext();
      const ws = params.workspaceId;
      const periods = ctx.calendar.periods(params.from, params.to);
      type Debt = DebtInfo & { accountId: string };
      const debts: Debt[] = [];
      if (params.debtKind !== 'CARD') {
        for (const l of await ext.portfolio.listLoans({
          workspaceId: ws,
          statuses: ['ACTIVE', 'PAID_OFF'],
        })) {
          debts.push({
            debtId: l.loanId,
            kind: 'LOAN',
            name: l.name,
            currency: l.currency,
            accountId: l.accountId,
          });
        }
      }
      if (params.debtKind !== 'LOAN') {
        for (const c of await ext.portfolio.listCards({ workspaceId: ws })) {
          debts.push({
            debtId: c.cardAccountId,
            kind: 'CARD',
            name: c.cardName,
            currency: c.currency,
            accountId: c.accountId,
          });
        }
      }
      const accountIds = [...new Set(debts.map((d) => d.accountId))];
      const dates = [...new Set(periods.map((p) => p.to))];
      const history =
        accountIds.length === 0
          ? {
              byDate: [] as {
                asOf: string;
                balances: { accountId: string | null; presented: { amount: string; currency: string } }[];
              }[],
            }
          : await this.deps.balanceHistory.getAccountBalancesAtDates({ workspaceId: ws, accountIds, dates });
      const owedAt = (date: string, debt: Debt): Money => {
        const found = history.byDate
          .find((d) => d.asOf === date)
          ?.balances.find((b) => b.accountId === debt.accountId);
        return found ? ctx.money(found.presented) : Money.zero(ctx.currencyOf(debt.currency));
      };
      const payments = debts.some((d) => d.kind === 'LOAN')
        ? await ext.debtHistory.monthly({ workspaceId: ws, from: params.from, to: params.to })
        : [];
      const paymentsOf = (loanId: string, period: ReportPeriod) =>
        payments
          .filter((r) => r.loanId === loanId && r.month === period.from.slice(0, 7))
          .flatMap((r) =>
            r.payments.map((p) => ({
              date: p.date,
              principal: ctx.money({ amount: p.principal, currency: r.currency }),
              interest: ctx.money({ amount: p.interest, currency: r.currency }),
              charges: ctx.money({ amount: p.charges, currency: r.currency }),
            })),
          );
      const inputs = debts.map((d) => ({
        debtId: d.debtId,
        kind: d.kind,
        name: d.name,
        currency: d.currency,
        months: periods.map((period): DebtMonthInput => ({
          period,
          outstanding: owedAt(period.to, d),
          payments: d.kind === 'LOAN' ? paymentsOf(d.debtId, period) : null,
        })),
      }));
      const dated: DatedAmount[] = inputs.flatMap((d) =>
        d.months.flatMap((m) => [
          { date: m.period.to, amount: m.outstanding },
          ...(m.payments ?? []).flatMap((p) => [
            { date: ctx.flowDate(p.date), amount: p.principal },
            { date: ctx.flowDate(p.date), amount: p.interest },
          ]),
        ]),
      );
      await ctx.resolveRates(dated);
      const series = DebtEvolutionSeries.series(inputs);
      const consolidated = DebtEvolutionSeries.consolidate(
        inputs,
        periods,
        ctx.balancePolicy(),
        ctx.flowPolicy(),
      );
      for (const c of consolidated) {
        ctx.track(c.outstanding);
        ctx.track(c.principalPaid);
        ctx.track(c.interestPaid);
      }
      const meta = await ctx.meta({
        reportId: 'DEBT_EVOLUTION',
        periods,
        comparison: null,
        policy: 'VALUATION_DATE',
      });
      const accountOf = new Map(debts.map((d) => [d.debtId, d.accountId]));
      return {
        meta,
        debts: series.map((s) => ({
          debtId: s.debtId,
          kind: s.kind,
          name: s.name,
          currency: s.currency,
          accountId: accountOf.get(s.debtId) ?? '',
          months: s.months.map((m) => ({
            period: periodDto(m.period),
            outstanding: m.outstanding.toJSON(),
            principalPaid: m.principalPaid?.toJSON() ?? null,
            interestPaid: m.interestPaid?.toJSON() ?? null,
            chargesPaid: m.chargesPaid?.toJSON() ?? null,
          })),
        })),
        consolidated: consolidated.map((c) => ({
          period: periodDto(c.period),
          outstanding: amountDto(c.outstanding),
          principalPaid: amountDto(c.principalPaid),
          interestPaid: amountDto(c.interestPaid),
        })),
      };
    });
  }

  // ───────────────────────────────────────────── reporte 11: costos recurrentes

  /** Reporte 11: costo mensual y anual normalizado de los compromisos recurrentes de egreso activos. */
  getRecurringCosts(params: RecurringCostsParams): Promise<ReportResult<RecurringCostsReportDto>> {
    const placeholder = '2000-01-01';
    return this.run(
      'RECURRING_COSTS',
      { ...params, from: params.from ?? placeholder, to: params.to ?? placeholder },
      async (ctx) => {
        this.noComparison(params);
        const items = (await this.ext().recurring.listCosts({ workspaceId: params.workspaceId })).filter(
          (i) =>
            (ctx.filters.requestedCategoryIds.length === 0 ||
              (i.categoryId !== null && ctx.filters.categoryIds.includes(i.categoryId))) &&
            (ctx.filters.currencies.length === 0 || ctx.filters.currencies.includes(i.currency)),
        );
        const inputs = items.map((i) => ({ ...i, currency: ctx.currencyOf(i.currency) }));
        await ctx.resolveRates(inputs.map((i) => ({ date: ctx.today, amount: Money.zero(i.currency) })));
        const table = RecurringCostTable.build({
          items: inputs,
          asOf: ctx.today,
          policy: ctx.balancePolicy(),
        });
        ctx.track(table.totals.monthly);
        ctx.track(table.totals.annual);
        const meta = await ctx.meta({
          reportId: 'RECURRING_COSTS',
          periods: [],
          comparison: null,
          policy: 'VALUATION_DATE',
          from: ctx.today,
          to: ctx.today,
        });
        return {
          meta,
          items: table.items.map((i) => ({
            definitionId: i.definitionId,
            name: i.name,
            categoryId: i.categoryId,
            cadence: i.cadence,
            interval: i.interval,
            variable: i.variable,
            monthly: i.monthly?.toJSON() ?? null,
            annual: i.annual?.toJSON() ?? null,
            monthlyReporting: i.monthlyReporting?.toJSON() ?? null,
          })),
          totals: { monthly: amountDto(table.totals.monthly), annual: amountDto(table.totals.annual) },
          variableCount: table.variableCount,
        };
      },
    );
  }

  // ───────────────────────────────────────────── reporte 12: evolución de suscripciones

  /** Reporte 12: costo mensual normalizado al cierre de cada mes, con altas, bajas y cambios de precio. */
  getSubscriptions(params: ReportParams): Promise<ReportResult<SubscriptionsReportDto>> {
    return this.run('SUBSCRIPTION_EVOLUTION', this.monthly(params), async (ctx) => {
      this.noComparison(params);
      const periods = ctx.calendar.periods(params.from, params.to);
      const raw = await this.ext().subscriptions.listEvents({
        workspaceId: params.workspaceId,
        from: params.from,
        to: params.to,
      });
      const events: SubscriptionEvent[] = raw.map((e) => ({
        subscriptionId: e.subscriptionId,
        name: e.name,
        date: e.date,
        kind: e.kind,
        previousPrice: e.previousPrice ? ctx.money(e.previousPrice) : null,
        newPrice: e.newPrice ? ctx.money(e.newPrice) : null,
        renewalsPerYear: e.renewalsPerYear,
      }));
      const currencies = [...new Set(events.flatMap((e) => (e.newPrice ? [e.newPrice.currency.code] : [])))];
      await ctx.resolveRates(
        periods.flatMap((p) =>
          currencies.map((c) => ({ date: p.to, amount: Money.zero(ctx.currencyOf(c)) })),
        ),
      );
      const series = SubscriptionCostSeries.build({ events, periods, policy: ctx.balancePolicy() });
      for (const s of series) ctx.track(s.monthlyCost);
      const meta = await ctx.meta({
        reportId: 'SUBSCRIPTION_EVOLUTION',
        periods,
        comparison: null,
        policy: 'VALUATION_DATE',
      });
      return {
        meta,
        months: series.map((s) => ({
          period: periodDto(s.period),
          monthlyCost: amountDto(s.monthlyCost),
          active: s.active,
          events: s.events.map((e) => ({
            date: e.date,
            subscriptionId: e.subscriptionId,
            name: e.name,
            kind: e.kind,
            previousPrice: e.previousPrice?.toJSON() ?? null,
            newPrice: e.newPrice?.toJSON() ?? null,
          })),
        })),
      };
    });
  }

  // ───────────────────────────────────────────── reporte 13: conversiones de moneda y cripto

  /** Reporte 13: tasa efectiva frente a la de referencia por conversión y costo mensual del análisis de costo. */
  getConversions(params: ReportParams): Promise<ReportResult<ConversionsReportDto>> {
    return this.run('FX_CONVERSIONS', params, async (ctx) => {
      this.noComparison(params);
      const ext = this.ext();
      const periods = ctx.calendar.periods(params.from, params.to);
      const rows = await ext.conversions.listForCostAnalysis({
        workspaceId: params.workspaceId,
        from: params.from,
        to: params.to,
      });
      const analysis = await ext.conversionCosts.getAnalysis({
        userId: params.userId,
        workspaceId: params.workspaceId,
        from: params.from,
        to: params.to,
        grouping: ctx.calendar.grouping,
        reportingCurrency: ctx.reporting.code,
      });
      await ctx.resolveRates([]);
      const points = ConversionScatter.points(
        rows.map((r) => ({
          transactionId: r.transactionId,
          date: r.businessDate,
          base: r.effectiveRate.base,
          quote: r.effectiveRate.quote,
          effectiveRate: r.effectiveRate.value,
          reference: r.referenceRate
            ? {
                base: r.referenceRate.rate.base,
                quote: r.referenceRate.rate.quote,
                value: r.referenceRate.rate.value,
              }
            : null,
        })),
      );
      const zero = Money.zero(ctx.reporting);
      const months = periods.map((period) => {
        const groups = analysis.groups.filter(
          (g) => g.period.from <= period.to && g.period.to >= period.from,
        );
        return {
          period: periodDto(period),
          cost: groups.reduce((sum, g) => sum.add(ctx.money(g.costTotal)), zero).toJSON(),
          conversions: groups.reduce((n, g) => n + g.conversions, 0),
          excluded: groups.reduce((n, g) => n + g.excluded.reduce((m, b) => m + b.count, 0), 0),
          costComplete: groups.every((g) => g.costComplete),
        };
      });
      const meta = await ctx.meta({
        reportId: 'FX_CONVERSIONS',
        periods,
        comparison: null,
        policy: 'TRANSACTION_DATE',
      });
      return {
        meta: {
          ...meta,
          complete: meta.complete && analysis.totals.costComplete,
          conversion: { ...meta.conversion, ratesUsed: analysis.meta.ratesUsed },
        },
        points,
        months,
        costTotal: analysis.totals.costTotal,
        costComplete: analysis.totals.costComplete,
      };
    });
  }
}
