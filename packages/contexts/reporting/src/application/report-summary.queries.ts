import type { AccountSummaryDto } from '@pf/accounts/contracts';
import type { ResolvedRateDto, RateAttributionDto, ValuationRateDto } from '@pf/fx/contracts';
import {
  currency as makeCurrency,
  dec,
  DomainError,
  endOfDayInstant,
  FlowValuation,
  LocalDate,
  Money,
  type Currency,
  type Decimal,
} from '@pf/shared-kernel';
import type {
  AccountBalanceLineDto,
  CurrencyTotalsDto,
  MoneyDto,
  MoneyVariationDto,
  ReportSummaryDto,
  TopCategoryDto,
} from '../contracts/index.js';
import {
  ConsolidationService,
  countsAsOutflow,
  homeQuestions,
  KpiCalculator,
  NetWorthValuator,
  PeriodComparator,
  present,
  sumByCurrency,
  type CompareMode,
  type DateRange,
  type CategoryAmount,
  type CategoryTotal,
  type ExactRate,
  type NominalFlow,
  type ValuedAccount,
} from '../domain/index.js';
import type { ReportingDeps } from './ports/index.js';

export const DEFAULT_TOP_CATEGORIES = 5;
/** Ventana de vigencia por defecto de las tasas de valoración (días; docs/31 D53: ajuste de Reporting). */
export const DEFAULT_RATE_VALIDITY_WINDOW_DAYS = 7;
export const MAX_TOP_CATEGORIES = 20;

export interface GetReportSummaryQuery {
  readonly userId: string | null;
  readonly workspaceId: string;
  /** `YYYY-MM`; excluyente con `dateFrom`/`dateTo`. Por defecto el mes en curso en la zona del workspace. */
  readonly month?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  /** Por defecto la moneda base del workspace. */
  readonly reportingCurrency?: string;
  readonly topCategories?: number;
  readonly compare?: CompareMode;
  /**
   * Fecha de corte `YYYY-MM-DD` de los STOCKS (uso interno: cifras de cierre, add-month-closing): saldos a esa fecha y
   * tasas de valoración al cierre de ese día en la zona del workspace (sin pasar de "ahora"). Ausente = hoy/ahora.
   */
  readonly asOf?: string;
}

/** Tasas usadas separadas por origen (cifras de cierre: flujos vs stocks). */
export interface ReportSummaryRateSets {
  readonly flows: readonly ResolvedRateDto[];
  readonly stocks: readonly ResolvedRateDto[];
  /** Flujos del periodo sin tasa utilizable (ingresos primero, gastos después) y completitud de ambos. */
  readonly flowsUnconverted: readonly MoneyDto[];
  readonly flowsComplete: boolean;
}

export interface ReportSummaryResult {
  readonly summary: ReportSummaryDto;
  /** Versión derivada de los datos del workspace (parte del ETag). */
  readonly dataVersion: string;
  /** Uso interno (queries de cierre): tasas usadas por origen. */
  readonly rateSets: ReportSummaryRateSets;
}

const range = (r: DateRange) => ({ from: r.from.toString(), to: r.to.toString() });

/** Clave de identidad de una tasa usada (misma versión almacenada y orientación ⇒ una sola entrada). */
export const rateKey = (r: ResolvedRateDto) =>
  `${r.fxRateId ?? JSON.stringify(r.components.map((c) => (c as { id?: unknown }).id))}|${r.rate.base}|${r.rate.quote}`;

const toExact = (v: ValuationRateDto): ExactRate => ({
  base: v.exact.base,
  quote: v.exact.quote,
  value: dec(v.exact.value),
});

/**
 * `GetReportSummary` (design.md decisiones 1–8; reporting/dashboard + reporting/net-worth): calcula el resumen del
 * Home desde la FUENTE DE VERDAD en una sola transacción de lectura con RLS del workspace (read-your-writes):
 *   saldos por cuenta (`GetBalances` por lote a hoy en la zona del workspace), flujos nominales del periodo y del
 *   periodo de comparación (`SummarizeNominalFlows`), catálogo de cuentas y categorías y tasas de valoración de FX
 *   (stocks a "ahora", flujos al cierre de su día). Todo lo financiero lo hacen los DS puros del dominio; aquí solo
 *   se orquesta y se redondea HALF_EVEN al serializar. Sin efectos.
 */
export class ReportSummaryQueries {
  constructor(private readonly deps: ReportingDeps) {}

  getReportSummary(query: GetReportSummaryQuery): Promise<ReportSummaryResult> {
    return this.deps.uow.run({ userId: query.userId, workspaceId: query.workspaceId }, () =>
      this.compute(query),
    );
  }

  /** Cálculo del resumen dentro de la unidad de trabajo YA abierta por el llamador (cifras de cierre). */
  computeInCurrentUnit(query: GetReportSummaryQuery): Promise<ReportSummaryResult> {
    return this.compute(query);
  }

  private async compute(query: GetReportSummaryQuery): Promise<ReportSummaryResult> {
    const { deps } = this;
    const ws = query.workspaceId;
    const topN = query.topCategories ?? DEFAULT_TOP_CATEGORIES;
    if (!Number.isInteger(topN) || topN < 0 || topN > MAX_TOP_CATEGORIES) {
      throw new DomainError('VALIDATION_FAILED', 'topCategories must be an integer between 0 and 20').at(
        '/topCategories',
      );
    }
    const settings = await deps.workspaces.settingsOf(ws);
    const timeZone = settings.timeZone;
    // Catálogo (escala canónica de TODA moneda activa) y monedas habilitadas, en una sola lectura.
    const catalog = await deps.rates.workspaceCurrencies(ws);
    const known = new Map<string, Currency>(catalog.map((c) => [c.code, makeCurrency(c.code, c.scale)]));
    const currencies = new Map<string, Currency>(
      catalog.filter((c) => c.enabled).map((c) => [c.code, known.get(c.code) as Currency]),
    );
    const reportingCode = query.reportingCurrency ?? settings.baseCurrency;
    const reporting = currencies.get(reportingCode);
    if (!reporting) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${reportingCode} is not enabled`).at(
        '/reportingCurrency',
      );
    }
    const now = deps.clock.now();
    const today = LocalDate.ofInstant(now, timeZone);
    const period = this.period(query, today);
    const compare = query.compare ?? 'PREVIOUS_PERIOD_TO_DATE';
    const comparison = PeriodComparator.comparison(period, today, compare);
    const stockDate = query.asOf === undefined ? today : LocalDate.parse(query.asOf);

    // ---- lecturas (contratos públicos, misma transacción)
    const accounts = await deps.accounts.listAccounts({ workspaceId: ws });
    const balances = await deps.balances.getAccountBalances({
      workspaceId: ws,
      accountIds: accounts.map((a) => a.accountId),
      asOf: stockDate.toString(),
    });
    const flowFrom =
      comparison && comparison.previous.from.compare(period.from) < 0
        ? comparison.previous.from
        : period.from;
    const rows = await deps.flows.summarizeNominalFlows({
      workspaceId: ws,
      dateFrom: flowFrom.toString(),
      dateTo: period.to.toString(),
    });
    // Escala del catálogo aunque la moneda no esté habilitada en el workspace (una cuenta sin postings vale cero a la
    // MISMA escala que las líneas del ledger: nunca BTC(8) vs BTC(18)). Solo una moneda fuera del catálogo activo cae a
    // los decimales del importe recibido.
    const decimalsOf = (amount: string) => amount.split('.')[1]?.length ?? 0;
    const scaleOf = (code: string, amount = '0') => known.get(code) ?? makeCurrency(code, decimalsOf(amount));
    const money = (dto: MoneyDto): Money => Money.parse(dto.amount, scaleOf(dto.currency, dto.amount));
    const flows: NominalFlow[] = rows.map((r) => ({
      businessDate: r.businessDate,
      nature: r.nature,
      categoryId: r.categoryId,
      amount: money(r.amount),
    }));

    // ---- saldos presentados por cuenta (cero si aún no tiene ledger account)
    const presentedByAccount = new Map(
      balances.balances.filter((b) => b.accountId !== null).map((b) => [b.accountId as string, b.presented]),
    );
    const lines = accounts.map((a) => ({
      account: a,
      balance: presentedByAccount.has(a.accountId)
        ? money(presentedByAccount.get(a.accountId) as MoneyDto)
        : Money.zero(scaleOf(a.currency)),
    }));

    // ---- tasas: stocks a "ahora", flujos al cierre de su día (sin pasar de "ahora")
    const stockCodes = [...new Set(lines.map((l) => l.balance.currency.code))].filter(
      (c) => c !== reporting.code,
    );
    const nowText = now.toString();
    // Tasas de los stocks: "ahora" o, con corte `asOf`, el cierre de ese día (acotado a "ahora").
    const stockAt =
      query.asOf === undefined
        ? nowText
        : (() => {
            const close = endOfDayInstant(stockDate.toString(), timeZone);
            return close.epochMillis > now.epochMillis ? nowText : close.toString();
          })();
    // Pedidos de tasa de los flujos: `FlowValuation` (shared-kernel, docs/33 D109) comparte las reglas con Planning.
    const flowRequests = FlowValuation.rateRequests(
      flows.map((f) => ({ date: f.businessDate, amount: f.amount })),
      reporting,
      timeZone,
      now,
    );
    const flowKeys = flowRequests.map((r) => r.key);
    const requests = [
      ...stockCodes.map((code) => ({ base: code, quote: reporting.code, at: stockAt })),
      ...flowRequests.map(({ base, quote, at }) => ({ base, quote, at })),
    ];
    const windowDays = deps.rateValidityWindowDays ?? DEFAULT_RATE_VALIDITY_WINDOW_DAYS;
    const resolved = requests.length
      ? await deps.rates.resolveValuationRates({ workspaceId: ws, requests, windowDays })
      : [];
    const stockRates = new Map<string, ValuationRateDto>();
    stockCodes.forEach((code, i) => {
      const r = resolved[i];
      if (r) stockRates.set(code, r);
    });
    const flowRates = new Map<string, ValuationRateDto>();
    flowKeys.forEach((key, i) => {
      const r = resolved[stockCodes.length + i];
      if (r) flowRates.set(key, r);
    });
    const used = new Map<string, ResolvedRateDto>();
    const usedStocks = new Map<string, ResolvedRateDto>();
    const usedFlows = new Map<string, ResolvedRateDto>();
    const useRate = (
      r: ValuationRateDto | undefined,
      own: Map<string, ResolvedRateDto>,
    ): ExactRate | null => {
      if (!r) return null;
      const key = rateKey(r.resolved);
      if (!used.has(key)) used.set(key, r.resolved);
      if (!own.has(key)) own.set(key, r.resolved);
      return toExact(r);
    };
    const stockRateFor = (code: string) => useRate(stockRates.get(code), usedStocks);
    const flowRateFor = (code: string, date: string) => useRate(flowRates.get(`${code}|${date}`), usedFlows);

    // ---- stocks: dinero disponible y patrimonio neto
    const isLiquid = (a: AccountSummaryDto) => a.nature === 'ASSET' && a.liquidity === 'LIQUID';
    const liquid = ConsolidationService.consolidate(
      lines.filter((l) => isLiquid(l.account)).map((l) => l.balance),
      reporting,
      stockRateFor,
    );
    const valued: ValuedAccount[] = lines.map((l) => ({
      accountId: l.account.accountId,
      type: l.account.type,
      nature: l.account.nature,
      includeInNetWorth: l.account.includeInNetWorth,
      balance: l.balance,
    }));
    const nw = NetWorthValuator.value(valued, reporting, stockRateFor);

    // ---- flujos del periodo
    const periodText = range(period);
    const inPeriod = KpiCalculator.within(flows, periodText);
    const flowTotals = (list: readonly NominalFlow[], nature: NominalFlow['nature']) =>
      ConsolidationService.consolidateFlows(
        list.filter((f) => f.nature === nature).map((f) => ({ date: f.businessDate, amount: f.amount })),
        reporting,
        flowRateFor,
      );
    const income = flowTotals(inPeriod, 'INCOME');
    const expense = flowTotals(inPeriod, 'EXPENSE');
    const savings = income.total.minus(expense.total);
    const categoryIds = [...new Set(inPeriod.map((f) => f.categoryId))];
    const names = new Map(
      (categoryIds.length > 0 && topN > 0
        ? await deps.categories.categoriesByIds({ userId: query.userId ?? '', workspaceId: ws, categoryIds })
        : []
      ).map((c) => [c.categoryId, c.name]),
    );
    const topOptions = {
      target: reporting,
      rateFor: flowRateFor,
      nameOf: (id: string) => names.get(id) ?? id,
    };
    const top = KpiCalculator.topCategories(inPeriod, topN, { ...topOptions, nature: 'EXPENSE' });
    const topIncome = KpiCalculator.topCategories(inPeriod, topN, { ...topOptions, nature: 'INCOME' });

    // ---- comparación
    const variation = (cur: Decimal, prev: Decimal): MoneyVariationDto => {
      const v = PeriodComparator.variation(cur, prev);
      return {
        current: present(cur, reporting).toJSON(),
        previous: present(prev, reporting).toJSON(),
        deltaAbs: present(v.deltaAbs, reporting).toJSON(),
        deltaPct: v.deltaPct,
        isNew: v.isNew,
      };
    };
    let comparisonDto: ReportSummaryDto['comparison'] = null;
    let comparisonComplete = true;
    // Neto por categoría del periodo de comparación (variación por categoría del Home, FR-REPORTING-004).
    let previousExpenseByCategory: ReadonlyMap<string, CategoryAmount> | null = null;
    let previousIncomeByCategory: ReadonlyMap<string, CategoryAmount> | null = null;
    if (comparison) {
      const cur = KpiCalculator.within(flows, range(comparison.current));
      const prev = KpiCalculator.within(flows, range(comparison.previous));
      previousExpenseByCategory = KpiCalculator.categoryTotals(prev, 'EXPENSE', topOptions);
      previousIncomeByCategory = KpiCalculator.categoryTotals(prev, 'INCOME', topOptions);
      const ci = flowTotals(cur, 'INCOME');
      const ce = flowTotals(cur, 'EXPENSE');
      const pi = flowTotals(prev, 'INCOME');
      const pe = flowTotals(prev, 'EXPENSE');
      comparisonComplete = ci.complete && ce.complete && pi.complete && pe.complete;
      comparisonDto = {
        mode: comparison.mode,
        previousPeriod: range(comparison.previous),
        income: variation(ci.total, pi.total),
        expense: variation(ce.total, pe.total),
        savings: variation(ci.total.minus(ce.total), pi.total.minus(pe.total)),
      };
    }

    // ---- por moneda (nativo, sin conversión)
    const incomeBy = new Map(KpiCalculator.incomeByCurrency(inPeriod).map((m) => [m.currency.code, m]));
    const expenseBy = new Map(KpiCalculator.expenseByCurrency(inPeriod).map((m) => [m.currency.code, m]));
    const liquidBy = new Map(
      sumByCurrency(lines.filter((l) => isLiquid(l.account)).map((l) => l.balance)).map((m) => [
        m.currency.code,
        m,
      ]),
    );
    const nwBy = new Map(nw.byCurrency.map((c) => [c.currency.code, c]));
    const codes = [
      ...new Set([...incomeBy.keys(), ...expenseBy.keys(), ...liquidBy.keys(), ...nwBy.keys()]),
    ].sort();
    const byCurrency: CurrencyTotalsDto[] = codes.map((code) => {
      const ccy = scaleOf(code);
      const zero = Money.zero(ccy);
      const inc = incomeBy.get(code) ?? zero;
      const exp = expenseBy.get(code) ?? zero;
      const net = inc.subtract(exp);
      const n = nwBy.get(code);
      return {
        currency: code,
        income: inc.toJSON(),
        expense: exp.toJSON(),
        net: net.toJSON(),
        liquidBalance: (liquidBy.get(code) ?? zero).toJSON(),
        savingsRate: KpiCalculator.savingsRate(inc.amount, net.amount),
        assets: (n?.assets ?? zero).toJSON(),
        liabilities: (n?.liabilities ?? zero).toJSON(),
        netWorth: (n?.net ?? zero).toJSON(),
      };
    });

    // ---- saldos por cuenta
    const accountLines: AccountBalanceLineDto[] = lines.map(({ account, balance }) => {
      const code = balance.currency.code;
      const rate = code === reporting.code ? null : stockRates.get(code);
      const exact = rate ? toExact(rate) : null;
      let converted: MoneyDto | null = null;
      if (code === reporting.code) converted = balance.toJSON();
      else if (balance.isZero()) converted = Money.zero(reporting).toJSON();
      else if (exact) {
        converted = present(
          ConsolidationService.consolidate([balance], reporting, () => exact).total,
          reporting,
        ).toJSON();
      }
      return {
        accountId: account.accountId,
        name: account.name,
        type: account.type,
        nature: account.nature,
        balance: balance.toJSON(),
        convertedBalance: converted,
        rate: rate?.resolved ?? null,
        includeInNetWorth: account.includeInNetWorth,
        liquid: isLiquid(account),
      };
    });

    const consolidatedComplete = liquid.complete && income.complete && expense.complete && nw.complete;
    const ratesUsed = [...used.values()];
    const attributions = new Map<string, RateAttributionDto>();
    for (const r of ratesUsed) if (r.attribution) attributions.set(r.attribution.provider, r.attribution);
    const show = (v: Decimal) => present(v, reporting).toJSON();
    const zero = dec('0');
    const topLine =
      (previous: ReadonlyMap<string, CategoryAmount> | null) =>
      (c: CategoryTotal): TopCategoryDto => {
        const before = previous?.get(c.categoryId);
        return {
          categoryId: c.categoryId,
          name: c.name,
          amount: show(c.amount),
          complete: c.complete,
          previousAmount:
            previous === null || (before && !before.complete) ? null : show(before?.amount ?? zero),
        };
      };

    const summary: ReportSummaryDto = {
      period: periodText,
      byCurrency,
      consolidated: {
        currency: reporting.code,
        income: show(income.total),
        expense: show(expense.total),
        net: show(savings),
        liquidBalance: show(liquid.total),
        assets: show(nw.assets),
        liabilities: show(nw.liabilities),
        netWorth: show(nw.netWorth),
        savingsRate: KpiCalculator.savingsRate(income.total, savings),
        complete: consolidatedComplete,
        unconverted: liquid.unconverted.map((m) => m.toJSON()),
      },
      comparison: comparisonDto,
      accounts: accountLines,
      topExpenseCategories: top.map(topLine(previousExpenseByCategory)),
      topIncomeCategories: topIncome.map(topLine(previousIncomeByCategory)),
      netWorth: {
        assets: show(nw.assets),
        liabilities: show(nw.liabilities),
        netWorth: show(nw.netWorth),
        complete: nw.complete,
        byCurrency: nw.byCurrency.map((c) => ({
          currency: c.currency.code,
          assets: c.assets.toJSON(),
          liabilities: c.liabilities.toJSON(),
          net: c.net.toJSON(),
          converted: c.converted === null ? null : show(c.converted),
        })),
        byAccountType: nw.byAccountType.map((t) => ({ type: t.type, amount: show(t.amount) })),
        unvalued: nw.unvalued.map((m) => m.toJSON()),
      },
      questions: homeQuestions({
        hasAccounts: accounts.length > 0,
        hasCommitments: await this.hasCommitments(ws, accounts.length > 0),
      }),
      meta: {
        generatedAt: nowText,
        reportingCurrency: reporting.code,
        approx: ratesUsed.some((r) => r.approx),
        timeZone,
        rateWindowDays: windowDays,
        complete:
          consolidatedComplete &&
          comparisonComplete &&
          top.every((c) => c.complete) &&
          topIncome.every((c) => c.complete),
        ...(balances.latestEntryAt ? { dataFreshness: balances.latestEntryAt } : {}),
        ratesUsed,
        attributions: [...attributions.values()],
      },
    };
    return {
      summary,
      dataVersion: await deps.versions.versionOf(ws),
      rateSets: {
        flows: [...usedFlows.values()],
        stocks: [...usedStocks.values()],
        flowsUnconverted: [...income.unconverted, ...expense.unconverted].map((m) => m.toJSON()),
        flowsComplete: income.complete && expense.complete,
      },
    };
  }

  /**
   * Q4/Q8 (add-upcoming-payments, decisión 11): ≥ 1 definición recurrente activa o ≥ 1 transacción pendiente de egreso
   * (un gasto, o una transferencia de una cuenta líquida a una que no lo es, D127).
   */
  private async hasCommitments(workspaceId: string, hasAccounts: boolean): Promise<boolean> {
    const { deps } = this;
    if (!hasAccounts) return false;
    if (await deps.commitments.hasActiveDefinitions({ workspaceId })) return true;
    const pending = await deps.pending.listPending({ workspaceId });
    if (pending.length === 0) return false;
    const all = await deps.accounts.listAccounts({ workspaceId, includeArchived: true });
    const classes = new Map(all.map((a) => [a.accountId, { nature: a.nature, liquidity: a.liquidity }]));
    return pending.some((p) =>
      countsAsOutflow({
        kind: p.kind,
        direction: p.direction,
        from: classes.get(p.accountId),
        to: p.toAccountId ? classes.get(p.toAccountId) : undefined,
      }),
    );
  }

  private period(query: GetReportSummaryQuery, today: LocalDate): DateRange {
    const hasRange = query.dateFrom !== undefined || query.dateTo !== undefined;
    if (query.month !== undefined && hasRange) {
      throw new DomainError('VALIDATION_FAILED', 'month is mutually exclusive with dateFrom/dateTo').at(
        '/month',
      );
    }
    if (query.month !== undefined) return PeriodComparator.month(query.month);
    if (hasRange) {
      if (query.dateFrom === undefined || query.dateTo === undefined) {
        throw new DomainError('VALIDATION_FAILED', 'dateFrom and dateTo must be given together').at(
          query.dateFrom === undefined ? '/dateFrom' : '/dateTo',
        );
      }
      return PeriodComparator.range(query.dateFrom, query.dateTo);
    }
    return PeriodComparator.currentMonth(today);
  }
}
