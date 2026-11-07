import type { AccountSummaryDto } from '@pf/accounts/contracts';
import type { RateAttributionDto, ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import { attributionsOf } from '@pf/fx/contracts';
import {
  currency as makeCurrency,
  DomainError,
  LocalDate,
  Money,
  type Currency,
  type Decimal,
  type Instant,
} from '@pf/shared-kernel';
import {
  CASH_FLOW_HORIZONS,
  type CashFlowAccountDto,
  type CashFlowCalendarDto,
  type CashFlowCurrencyDto,
  type CashFlowEventDto,
  type CashFlowHomeBlockDto,
  type MoneyDto,
} from '../contracts/index.js';
import {
  CASH_FLOW_CALENDAR_DURATION_METRIC,
  CashFlowCalendar,
  CashFlowConsolidator,
  CashFlowRiskPolicy,
  CashFlowSuggester,
  PlannedSpending,
  type CashFlowAmountType,
  type CashFlowCurrencyBlock,
  type CashFlowEventKind,
  type CashFlowMovementInput,
  type CashFlowResult,
  type CashFlowRiskAssessment,
  type ExactRate,
  type PlanCategoryNode,
  type PlannedLineInput,
  type PlannedPeriodInput,
} from '../domain/index.js';
import type {
  PendingTransactionRow,
  ReportingDeps,
  UpcomingCommitmentsPort,
  UpcomingPaymentsDeps,
} from './ports/index.js';
import { isLiquidAccount } from './spendable.queries.js';
import { DEFAULT_RATE_VALIDITY_WINDOW_DAYS, rateKey, toExact } from './valuation-support.js';

const monotonic = () => Number(process.hrtime.bigint()) / 1e9;

/** Lo que el cálculo toma de la petición en curso (el resumen del Home y el job comparten las lecturas comunes). */
export interface CashFlowContext {
  readonly workspaceId: string;
  readonly now: Instant;
  readonly today: LocalDate;
  readonly reporting: Currency;
  readonly scaleOf: (code: string, amount?: string) => Currency;
  /** Cuentas no archivadas del workspace. */
  readonly accounts: readonly AccountSummaryDto[];
  readonly balanceOf: (accountId: string) => Money;
  /** Tasas de valoración ya resueltas en la petición (stocks a "ahora"): solo se piden las que falten. */
  readonly knownRates: ReadonlyMap<string, ValuationRateDto>;
  readonly windowDays: number;
}

export interface CashFlowOptions {
  readonly horizonDays: number;
  /** Serie de gasto planificado del plan (Should); el Home y el job no la piden. */
  readonly withPlan: boolean;
  /** Sugerencia de conversión (Could); el Home y el job no la piden. */
  readonly withSuggestions: boolean;
}

export interface CashFlowComputation {
  readonly result: CashFlowResult;
  readonly assessments: ReadonlyMap<string, CashFlowRiskAssessment>;
  readonly plannedPeriods: readonly { periodId: string | null; label: string; status: 'PLAN' | 'NO_PLAN' }[];
  readonly suggestions: CashFlowCalendarDto['suggestions'];
  readonly consolidated: CashFlowCalendarDto['consolidated'];
  readonly coverage: { readonly through: string; readonly complete: boolean };
  readonly ratesUsed: readonly ResolvedRateDto[];
  /** Filas leídas (métrica de volumen). */
  readonly rows: number;
}

const OCCURRENCE_KINDS: ReadonlySet<string> = new Set([
  'INCOME',
  'EXPENSE',
  'TRANSFER',
  'LOAN_PAYMENT',
  'CARD_PAYMENT',
]);

/**
 * Cálculo del calendario de flujo de caja (openspec add-cash-flow-forecast, design.md decisiones 2 a 9): lee la FUENTE DE
 * VERDAD en la unidad de trabajo ya abierta (read-your-writes, D117) por los contratos públicos —COMMITMENTS (S1),
 * TRANSACTIONS (pendientes, S3), PLANNING (planes), CLASSIFICATION (árbol), IDENTITY (reserva), FX (una sola resolución de
 * tasas)— y delega todo lo financiero en los DS puros. Sin efectos. Lo comparten la consulta HTTP, el bloque del Home y el
 * job que detecta el riesgo.
 */
/** Lo mínimo que el cálculo necesita de las dependencias (el resumen del Home no tiene las de próximos pagos). */
export type CashFlowCalculationDeps = Pick<ReportingDeps, 'rates' | 'pending' | 'spendable'> & {
  readonly commitments: Pick<UpcomingCommitmentsPort, 'listForCashFlow'>;
};

export class CashFlowCalculation {
  constructor(private readonly deps: CashFlowCalculationDeps) {}

  async compute(ctx: CashFlowContext, options: CashFlowOptions): Promise<CashFlowComputation> {
    const { deps } = this;
    const ws = ctx.workspaceId;
    const today = ctx.today.toString();
    const horizonEnd = ctx.today.plusDays(options.horizonDays).toString();
    const money = (amount: string, currency: string) => Money.parse(amount, ctx.scaleOf(currency, amount));

    // ---- lecturas (contratos públicos, misma transacción)
    const liquid = ctx.accounts.filter(isLiquidAccount);
    const occurrences = await deps.commitments.listForCashFlow({ workspaceId: ws, through: horizonEnd });
    const pending = await deps.pending.listPending({
      workspaceId: ws,
      dateTo: horizonEnd,
      includeConversions: true,
    });
    const reserveDto = deps.spendable
      ? await deps.spendable.minimumReserve.getMinimumLiquidityReserve({ workspaceId: ws })
      : null;
    const reserve = reserveDto ? money(reserveDto.amount, reserveDto.currency) : null;

    // ---- movimientos
    const movements: CashFlowMovementInput[] = [];
    for (const o of occurrences.items) {
      if (!OCCURRENCE_KINDS.has(o.kind)) continue;
      const isIncome = o.kind === 'INCOME';
      const e = o.expected;
      // Conservador: el máximo en los egresos de rango y el mínimo en los ingresos (FR-COMMITMENTS-004).
      const raw = e.type === 'VARIABLE' ? null : e.type === 'MIN_MAX' ? (isIncome ? e.min : e.max) : e.amount;
      movements.push({
        id: o.occurrenceId,
        source: 'OCCURRENCE',
        kind: o.kind,
        date: o.dueDate,
        accountId: o.accountId,
        toAccountId: o.toAccountId,
        amountType: e.type as CashFlowAmountType,
        name: o.definitionName,
        managedBy: o.managedBy,
        categoryId: o.categoryId,
        amount: raw === null ? null : money(raw, e.currency),
        toAmount: null,
      });
    }
    for (const p of pending) {
      movements.push(this.pendingMovement(p, money));
    }

    // ---- gasto planificado de los planes del horizonte (Should)
    let plannedByDay: Map<string, Map<string, Decimal>> | undefined;
    let plannedPeriods: CashFlowComputation['plannedPeriods'] = [];
    if (options.withPlan && deps.spendable) {
      const planned = await this.planned(ctx, horizonEnd, movements, liquid);
      plannedPeriods = planned.periods;
      if (planned.byCurrency.size > 0) plannedByDay = planned.byCurrency;
    }

    // ---- dominio: series por cuenta y moneda
    const result = CashFlowCalendar.compute({
      today,
      horizonDays: options.horizonDays,
      accounts: liquid.map((a) => ({
        accountId: a.accountId,
        name: a.name,
        balance: ctx.balanceOf(a.accountId),
      })),
      movements,
      ...(plannedByDay ? { plannedByDay } : {}),
    });
    const assessments = new Map<string, CashFlowRiskAssessment>();
    for (const block of result.currencies) {
      assessments.set(block.currency.code, CashFlowRiskPolicy.assess(block, reserve));
    }

    // ---- tasas: una sola resolución (consolidado hacia la moneda de reporte y, si se piden, pares de la sugerencia)
    const rates = new Map<string, ValuationRateDto>(ctx.knownRates);
    const wantsRate = result.currencies
      .map((c) => c.currency.code)
      .filter((code) => code !== ctx.reporting.code && !rates.has(code));
    const suggestionPairs: { from: string; to: string }[] = [];
    if (options.withSuggestions) {
      for (const [code, a] of assessments) {
        if (a.risk !== 'HIGH') continue;
        for (const other of result.currencies) {
          if (other.currency.code !== code) suggestionPairs.push({ from: other.currency.code, to: code });
        }
      }
    }
    const requests = [
      ...wantsRate.map((code) => ({ base: code, quote: ctx.reporting.code, at: ctx.now.toString() })),
      ...suggestionPairs.map((p) => ({ base: p.from, quote: p.to, at: ctx.now.toString() })),
    ];
    const resolved = requests.length
      ? await deps.rates.resolveValuationRates({ workspaceId: ws, requests, windowDays: ctx.windowDays })
      : [];
    wantsRate.forEach((code, i) => {
      const r = resolved[i];
      if (r) rates.set(code, r);
    });
    const pairRates = new Map<string, ValuationRateDto>();
    suggestionPairs.forEach((p, i) => {
      const r = resolved[wantsRate.length + i];
      if (r) pairRates.set(`${p.from}>${p.to}`, r);
    });
    const used = new Map<string, ResolvedRateDto>();
    const useRate = (r: ValuationRateDto | undefined): ExactRate | null => {
      if (!r) return null;
      return toExact(r);
    };
    const noteUsed = (r: ValuationRateDto) => used.set(rateKey(r.resolved), r.resolved);

    const consolidation = CashFlowConsolidator.lowest(result.currencies, ctx.reporting, (code) =>
      useRate(rates.get(code)),
    );
    for (const code of consolidation.convertedCurrencies) {
      const r = rates.get(code);
      if (r) noteUsed(r);
    }
    const suggestionRates = new Map<string, ValuationRateDto>();
    const suggestions = CashFlowSuggester.suggest({
      blocks: result.currencies.map((block) => ({
        block,
        assessment: assessments.get(block.currency.code) as CashFlowRiskAssessment,
      })),
      rateFor: (from, to) => {
        const r = pairRates.get(`${from}>${to}`);
        if (r) suggestionRates.set(`${from}>${to}`, r);
        return useRate(r);
      },
    });
    const suggestionDtos: CashFlowCalendarDto['suggestions'] = suggestions.map((s) => {
      const r = suggestionRates.get(`${s.fromCurrency}>${s.toCurrency}`) as ValuationRateDto;
      noteUsed(r);
      return {
        fromCurrency: s.fromCurrency,
        toCurrency: s.toCurrency,
        approxAmount: s.approxAmount.toJSON(),
        rate: r.resolved,
        before: s.before,
      };
    });

    const generatedThrough = occurrences.generatedThrough;
    return {
      result,
      assessments,
      plannedPeriods,
      suggestions: suggestionDtos,
      consolidated: {
        lowest: consolidation.lowest
          ? { amount: consolidation.lowest.amount.toJSON(), date: consolidation.lowest.date }
          : null,
        complete: consolidation.complete,
        unconverted: consolidation.unconverted.map((m) => m.toJSON()),
      },
      coverage: {
        through: generatedThrough < horizonEnd ? generatedThrough : horizonEnd,
        complete: generatedThrough >= horizonEnd,
      },
      ratesUsed: [...used.values()],
      rows: occurrences.items.length + pending.length,
    };
  }

  private pendingMovement(
    p: PendingTransactionRow,
    money: (amount: string, currency: string) => Money,
  ): CashFlowMovementInput {
    const kind: CashFlowEventKind =
      p.kind === 'INCOME'
        ? 'INCOME'
        : p.kind === 'TRANSFER'
          ? 'TRANSFER'
          : p.kind === 'CONVERSION'
            ? 'CONVERSION'
            : 'EXPENSE';
    return {
      id: p.transactionId,
      source: 'PENDING',
      kind,
      date: p.businessDate,
      accountId: p.accountId,
      toAccountId: p.toAccountId,
      amountType: null,
      name: p.description,
      managedBy: null,
      categoryId: p.categoryId ?? null,
      amount: money(p.amount.amount, p.amount.currency),
      toAmount: p.toAmount ? money(p.toAmount.amount, p.toAmount.currency) : null,
    };
  }

  /** Planes de los periodos que intersectan el horizonte y reparto del gasto planificado restante. */
  private async planned(
    ctx: CashFlowContext,
    horizonEnd: string,
    movements: readonly CashFlowMovementInput[],
    liquid: readonly AccountSummaryDto[],
  ) {
    const ports = this.deps.spendable;
    const empty = {
      byCurrency: new Map<string, Map<string, Decimal>>(),
      periods: [] as CashFlowComputation['plannedPeriods'],
    };
    if (!ports) return empty;
    const ws = ctx.workspaceId;
    const today = ctx.today.toString();
    const periods = (await ports.periods.listPeriods({ workspaceId: ws })).filter(
      (p) => p.periodEnd >= today && p.periodStart <= horizonEnd,
    );
    if (periods.length === 0) return empty;
    const tree = ports.categories
      ? await ports.categories.categoryTree({ userId: '', workspaceId: ws })
      : null;
    const categories = new Map<string, PlanCategoryNode>(
      (tree?.categories ?? []).map((c) => [c.categoryId, { parentId: c.parentId, groupId: c.groupId }]),
    );
    const money = (dto: MoneyDto) => Money.parse(dto.amount, ctx.scaleOf(dto.currency, dto.amount));
    const inputs: PlannedPeriodInput[] = [];
    for (const p of periods) {
      const row = await ports.budgets.getForPeriod({ workspaceId: ws, periodId: p.id });
      const lines: PlannedLineInput[] =
        row?.lines
          ?.filter(
            (l) => l.target.kind === 'CATEGORY' || l.target.kind === 'GROUP' || l.target.kind === 'TAG',
          )
          .map((l) => ({
            targetKind: l.target.kind as 'CATEGORY' | 'GROUP' | 'TAG',
            targetId: l.target.id,
            nature: l.nature as 'EXPENSE' | 'INCOME',
            reference: money(l.reference),
            actual: money(l.actual),
          })) ?? [];
      inputs.push({
        periodId: p.id,
        label: p.label,
        start: p.periodStart,
        end: p.periodEnd,
        plan: row && row.currency !== undefined ? { currency: row.currency, lines } : null,
      });
    }
    const out = PlannedSpending.compute({
      today,
      horizonEnd,
      periods: inputs,
      categories,
      committed: movements
        .filter((m) => m.kind === 'EXPENSE' && m.categoryId !== null && m.amount !== null)
        .map((m) => ({ date: m.date, categoryId: m.categoryId, amount: m.amount as Money })),
      liquidCurrencies: new Set(liquid.map((a) => a.currency)),
    });
    return {
      byCurrency: out.byCurrency as Map<string, Map<string, Decimal>>,
      periods: out.periods.map((x) => ({ periodId: x.periodId, label: x.label, status: x.status })),
    };
  }
}

// ───────────────────────────────────────────── DTOs

const dayDto = (p: { date: string; balance: Money; low: Money }) => ({
  date: p.date,
  balance: p.balance.toJSON(),
  low: p.low.toJSON(),
});

export function currencyDto(block: CashFlowCurrencyBlock, a: CashFlowRiskAssessment): CashFlowCurrencyDto {
  return {
    currency: block.currency.code,
    threshold: { amount: a.threshold.toJSON(), source: a.thresholdSource },
    startBalance: block.startBalance.toJSON(),
    endBalance: block.endBalance.toJSON(),
    lowest: { amount: block.lowest.amount.toJSON(), date: block.lowest.date },
    risk: a.risk,
    firstShortfallDate: a.firstShortfallDate,
    shortfallAmount: a.shortfallAmount?.toJSON() ?? null,
    belowZero: a.belowZero,
    outflowTotal: block.outflowTotal.toJSON(),
    inflowTotal: block.inflowTotal.toJSON(),
    withoutAmountCount: block.withoutAmountCount,
    series: block.series.map(dayDto),
    planned: block.planned
      ? {
          lowest: { amount: block.planned.lowest.amount.toJSON(), date: block.planned.lowest.date },
          endBalance: block.planned.endBalance.toJSON(),
          series: block.planned.series.map((p) => ({ date: p.date, balance: p.balance.toJSON() })),
        }
      : null,
    withoutExpectedIncome: {
      lowest: {
        amount: block.withoutExpectedIncome.lowest.amount.toJSON(),
        date: block.withoutExpectedIncome.lowest.date,
      },
      endBalance: block.withoutExpectedIncome.endBalance.toJSON(),
    },
  };
}

/** Bloque `cashFlow` del Home (Q8): la moneda con el riesgo más alto o, sin riesgo, el mínimo consolidado. */
export function homeBlock(c: CashFlowComputation): CashFlowHomeBlockDto {
  const entries = c.result.currencies.map((block) => ({
    block,
    a: c.assessments.get(block.currency.code) as CashFlowRiskAssessment,
  }));
  const worst = CashFlowRiskPolicy.worst(
    entries.map((e) => ({
      code: e.block.currency.code,
      risk: e.a.risk,
      shortfallAmount: e.a.shortfallAmount,
    })),
  );
  const worstEntry = worst ? entries.find((e) => e.block.currency.code === worst.code) : undefined;
  return {
    horizonDays: 30,
    worst: worstEntry
      ? {
          currency: worstEntry.block.currency.code,
          risk: worstEntry.a.risk,
          lowest: worstEntry.block.lowest.amount.toJSON(),
          lowestDate: worstEntry.block.lowest.date,
          firstShortfallDate: worstEntry.a.firstShortfallDate,
        }
      : null,
    consolidatedLowest: c.consolidated.lowest,
    complete: c.consolidated.complete,
  };
}

function eventDto(e: CashFlowResult['events'][number]): CashFlowEventDto {
  return {
    id: e.id,
    date: e.date,
    originalDate: e.originalDate,
    source: e.source,
    kind: e.kind,
    certainty: e.certainty,
    amountType: e.amountType,
    name: e.name,
    accountId: e.accountId,
    toAccountId: e.toAccountId,
    amount: e.amount?.toJSON() ?? null,
    toAmount: e.toAmount?.toJSON() ?? null,
    overdue: e.overdue,
    daysOverdue: e.daysOverdue,
    managedBy: e.managedBy,
    sourceRef: { context: e.source === 'OCCURRENCE' ? 'COMMITMENTS' : 'TRANSACTIONS', id: e.id },
  };
}

// ───────────────────────────────────────────── consulta

export interface GetCashFlowCalendarQuery {
  readonly userId: string | null;
  readonly workspaceId: string;
  /** 7, 30, 60 o 90 (por omisión 30); otro valor ⇒ `INVALID_FILTER`. */
  readonly horizon?: number;
  /** Cuenta líquida de la que se pide la serie diaria; no líquida, archivada o ajena ⇒ `INVALID_FILTER`. */
  readonly accountId?: string;
  /** Por defecto la moneda base del workspace. */
  readonly reportingCurrency?: string;
}

export interface CashFlowCalendarResult {
  readonly calendar: CashFlowCalendarDto;
  readonly dataVersion: string;
}

export const DEFAULT_CASH_FLOW_HORIZON = 30;

/** Riesgo de una moneda en el horizonte evaluado (insumo del job `reporting.cash-flow-watch`). */
export interface CurrencyRiskEvaluation {
  readonly currency: string;
  readonly risk: CashFlowRiskAssessment['risk'];
  readonly lowest: Money;
  readonly lowestDate: string;
  readonly firstShortfallDate: string | null;
  readonly threshold: Money;
  readonly thresholdSource: 'MINIMUM_RESERVE' | 'ZERO';
  readonly belowZero: boolean;
}

export interface RiskEvaluation {
  readonly today: string;
  readonly now: string;
  readonly horizonDays: number;
  readonly currencies: readonly CurrencyRiskEvaluation[];
}

/**
 * `GetCashFlowCalendar` (`GET /reports/cash-flow-calendar`, VIEWER): el calendario de flujo de caja de las cuentas líquidas
 * (reporting/cash-flow-calendar). Una sola transacción de lectura con RLS del workspace (read-your-writes, D117); sin
 * caché ni read model.
 */
export class CashFlowCalendarQueries {
  constructor(private readonly deps: UpcomingPaymentsDeps) {}

  getCashFlowCalendar(query: GetCashFlowCalendarQuery): Promise<CashFlowCalendarResult> {
    return this.deps.uow.run({ userId: query.userId, workspaceId: query.workspaceId }, () =>
      this.compute(query),
    );
  }

  /**
   * Riesgo de déficit por moneda, SIN serie del plan, dentro de la unidad de trabajo YA abierta por el llamador (el job
   * `reporting.cash-flow-watch`, que escribe el episodio, el evento y la notificación en esa misma transacción). La zona y
   * la moneda base las entrega el llamador (el directorio de workspaces ya las leyó: ninguna conexión extra del pool).
   */
  async evaluateRisk(input: {
    readonly workspaceId: string;
    readonly timeZone: string;
    readonly baseCurrency: string;
    readonly horizonDays: number;
  }): Promise<RiskEvaluation> {
    const { ctx } = await this.context(input.workspaceId, {
      timeZone: input.timeZone,
      baseCurrency: input.baseCurrency,
    });
    const computation = await new CashFlowCalculation(this.deps).compute(ctx, {
      horizonDays: input.horizonDays,
      withPlan: false,
      withSuggestions: false,
    });
    return {
      today: ctx.today.toString(),
      now: ctx.now.toString(),
      horizonDays: input.horizonDays,
      currencies: computation.result.currencies.map((block) => {
        const a = computation.assessments.get(block.currency.code) as CashFlowRiskAssessment;
        return {
          currency: block.currency.code,
          risk: a.risk,
          lowest: block.lowest.amount,
          lowestDate: block.lowest.date,
          firstShortfallDate: a.firstShortfallDate,
          threshold: a.threshold,
          thresholdSource: a.thresholdSource,
          belowZero: a.belowZero,
        };
      }),
    };
  }

  /** Moneda de reporte, escalas, hoy, cuentas y saldos de la petición (lecturas comunes al calendario y al job). */
  private async context(
    ws: string,
    settingsOverride?: { readonly timeZone: string; readonly baseCurrency: string },
    reportingCurrency?: string,
    accountId?: string,
  ) {
    const { deps } = this;
    const settings = settingsOverride ?? (await deps.workspaces.settingsOf(ws));
    const catalog = await deps.rates.workspaceCurrencies(ws);
    const known = new Map<string, Currency>(catalog.map((c) => [c.code, makeCurrency(c.code, c.scale)]));
    const enabled = new Set(catalog.filter((c) => c.enabled).map((c) => c.code));
    const reportingCode = reportingCurrency ?? settings.baseCurrency;
    const reporting = enabled.has(reportingCode) ? known.get(reportingCode) : undefined;
    if (!reporting) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${reportingCode} is not enabled`).at(
        '/reportingCurrency',
      );
    }
    const decimalsOf = (amount: string) => amount.split('.')[1]?.length ?? 0;
    const scaleOf = (code: string, amount = '0') => known.get(code) ?? makeCurrency(code, decimalsOf(amount));
    const now = deps.clock.now();
    const today = LocalDate.ofInstant(now, settings.timeZone);
    const accounts = await deps.accounts.listAccounts({ workspaceId: ws });
    if (accountId !== undefined) {
      const found = accounts.find((a) => a.accountId === accountId);
      if (!found || !isLiquidAccount(found)) {
        throw new DomainError('INVALID_FILTER', 'accountId must be a liquid account of the workspace').at(
          '/accountId',
        );
      }
    }
    const balances = await deps.balances.getAccountBalances({
      workspaceId: ws,
      accountIds: accounts.map((a) => a.accountId),
      asOf: today.toString(),
    });
    const presented = new Map(
      balances.balances.filter((b) => b.accountId !== null).map((b) => [b.accountId as string, b.presented]),
    );
    const windowDays = deps.rateValidityWindowDays ?? DEFAULT_RATE_VALIDITY_WINDOW_DAYS;
    const ctx: CashFlowContext = {
      workspaceId: ws,
      now,
      today,
      reporting,
      scaleOf,
      accounts,
      balanceOf: (id) => {
        const p = presented.get(id);
        const account = accounts.find((a) => a.accountId === id) as AccountSummaryDto;
        return p
          ? Money.parse(p.amount, scaleOf(p.currency, p.amount))
          : Money.zero(scaleOf(account.currency));
      },
      knownRates: new Map(),
      windowDays,
    };
    return { ctx, balances };
  }

  private async compute(query: GetCashFlowCalendarQuery): Promise<CashFlowCalendarResult> {
    const { deps } = this;
    const started = monotonic();
    const ws = query.workspaceId;
    const horizon = query.horizon ?? DEFAULT_CASH_FLOW_HORIZON;
    if (!(CASH_FLOW_HORIZONS as readonly number[]).includes(horizon)) {
      throw new DomainError('INVALID_FILTER', 'horizon must be 7, 30, 60 or 90').at('/horizon');
    }
    const { ctx, balances } = await this.context(ws, undefined, query.reportingCurrency, query.accountId);
    const { now, today, reporting, windowDays } = ctx;
    const computation = await new CashFlowCalculation(deps).compute(ctx, {
      horizonDays: horizon,
      withPlan: true,
      withSuggestions: true,
    });
    const { result } = computation;
    const accountDtos: CashFlowAccountDto[] = result.accounts.map((a) => ({
      accountId: a.accountId,
      name: a.name,
      currency: a.currency.code,
      startBalance: a.startBalance.toJSON(),
      endBalance: a.endBalance.toJSON(),
      lowest: { amount: a.lowest.amount.toJSON(), date: a.lowest.date },
      series: a.accountId === query.accountId ? a.series.map(dayDto) : null,
    }));
    const attributions = new Map<string, RateAttributionDto>();
    for (const r of computation.ratesUsed) for (const a of attributionsOf(r)) attributions.set(a.provider, a);
    const calendar: CashFlowCalendarDto = {
      horizonDays: horizon,
      today: today.toString(),
      from: result.from,
      to: result.to,
      reportingCurrency: reporting.code,
      coverage: computation.coverage,
      currencies: result.currencies.map((b) =>
        currencyDto(b, computation.assessments.get(b.currency.code) as CashFlowRiskAssessment),
      ),
      accounts: accountDtos,
      events: result.events.map(eventDto),
      plannedSpending: { periods: computation.plannedPeriods },
      suggestions: computation.suggestions,
      consolidated: computation.consolidated,
      meta: {
        generatedAt: now.toString(),
        rateWindowDays: windowDays,
        ...(balances.latestEntryAt ? { dataFreshness: balances.latestEntryAt } : {}),
        ratesUsed: computation.ratesUsed,
        attributions: [...attributions.values()],
      },
    };
    deps.metrics?.observe(CASH_FLOW_CALENDAR_DURATION_METRIC, monotonic() - started);
    return { calendar, dataVersion: await deps.versions.versionOf(ws) };
  }
}
