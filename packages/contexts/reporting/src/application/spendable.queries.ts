import type { AccountSummaryDto } from '@pf/accounts/contracts';
import type { RateAttributionDto, ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import { attributionsOf } from '@pf/fx/contracts';
import {
  currency as makeCurrency,
  DomainError,
  LocalDate,
  Money,
  type Currency,
  type Instant,
} from '@pf/shared-kernel';
import type {
  MoneyDto,
  SpendableBudgetViewDto,
  SpendableDto,
  SpendableSummaryDto,
} from '../contracts/index.js';
import {
  CommittedPeriod,
  PeriodComparator,
  SPENDABLE_DURATION_METRIC,
  SpendableCalculator,
  type ExactRate,
  type SpendableCommittedItem,
} from '../domain/index.js';
import type { ReportingDeps, SpendableDeps } from './ports/index.js';
import { DEFAULT_RATE_VALIDITY_WINDOW_DAYS, rateKey, toExact } from './valuation-support.js';

const monotonic = () => Number(process.hrtime.bigint()) / 1e9;

/** Cuenta líquida (D35): `ASSET` + `LIQUID`; el catálogo por omisión ya excluye las archivadas. */
export const isLiquidAccount = (a: AccountSummaryDto) => a.nature === 'ASSET' && a.liquidity === 'LIQUID';

/** Lo que el cálculo toma de la petición en curso (las lecturas comunes con el resumen del Home se comparten). */
export interface SpendableContext {
  readonly workspaceId: string;
  readonly now: Instant;
  readonly today: LocalDate;
  readonly reporting: Currency;
  readonly scaleOf: (code: string, amount?: string) => Currency;
  /** Cuentas no archivadas del workspace. */
  readonly accounts: readonly AccountSummaryDto[];
  /** Saldo presentado de la cuenta (cero si aún no tiene ledger account). */
  readonly balanceOf: (accountId: string) => Money;
  /** Tasas de valoración ya resueltas en la petición (stocks a "ahora"): solo se piden las que falten. */
  readonly knownRates: ReadonlyMap<string, ValuationRateDto>;
  readonly windowDays: number;
}

export interface SpendableComputation {
  readonly summary: SpendableSummaryDto;
  readonly detail: Pick<SpendableDto, 'committedItems' | 'reservedByAccount' | 'plannedByGoal'>;
  /** Tasas usadas por el consolidado (el resumen las suma a `meta.ratesUsed`). */
  readonly ratesUsed: readonly ResolvedRateDto[];
}

/**
 * Cálculo del disponible para gastar libre de compromisos (Q5; openspec add-spendable-amount, design.md decisiones 2 a
 * 13). Lee la FUENTE DE VERDAD en la unidad de trabajo ya abierta (read-your-writes, D117) por los contratos públicos
 * de COMMITMENTS, GOALS, IDENTITY y PLANNING, una sola vez cada uno y por lote; todo lo financiero lo hace el DS puro
 * `SpendableCalculator`. Sin efectos.
 */
export class SpendableCalculation {
  constructor(
    private readonly deps: ReportingDeps,
    private readonly ports: SpendableDeps,
  ) {}

  async compute(ctx: SpendableContext): Promise<SpendableComputation> {
    const started = monotonic();
    const { ports } = this;
    const ws = ctx.workspaceId;
    const money = (dto: MoneyDto): Money => Money.parse(dto.amount, ctx.scaleOf(dto.currency, dto.amount));

    // ---- periodo financiero que contiene hoy (zona del workspace, día de inicio ya resuelto en los periodos)
    const periods = await ports.periods.listPeriods({ workspaceId: ws });
    const located = CommittedPeriod.locate(periods, ctx.today.toString());
    // Sin periodo que cubra hoy (workspace sin actividad aún): el mes calendario; sin plan que consultar.
    const month = PeriodComparator.currentMonth(ctx.today);
    const period = located
      ? {
          id: located.id as string | null,
          label: located.label,
          start: located.periodStart,
          end: located.periodEnd,
        }
      : {
          id: null as string | null,
          label: month.from.toString().slice(0, 7),
          start: month.from.toString(),
          end: month.to.toString(),
        };

    // ---- lecturas por lote (contratos públicos, misma transacción)
    const liquid = ctx.accounts.filter(isLiquidAccount);
    const reservations = await ports.reservations.getReservedByAccount({
      workspaceId: ws,
      accountIds: liquid.map((a) => a.accountId),
    });
    const committed = await ports.commitments.listForSpendable({
      workspaceId: ws,
      periodFrom: period.start,
      periodTo: period.end,
    });
    const plans = await ports.goalPlans.getForPeriod({ workspaceId: ws, from: period.start, to: period.end });
    const reserve = await ports.minimumReserve.getMinimumLiquidityReserve({ workspaceId: ws });
    const budget = period.id
      ? await ports.budgets.getForPeriod({ workspaceId: ws, periodId: period.id })
      : null;

    // ---- cálculo puro
    const items: SpendableCommittedItem[] = committed.items.map((i) => ({
      ...i,
      amount: i.amount === null ? null : money(i.amount),
    }));
    const result = SpendableCalculator.calculate({
      period: { from: period.start, to: period.end },
      liquidAccounts: liquid.map((a) => ({
        accountId: a.accountId,
        name: a.name,
        balance: ctx.balanceOf(a.accountId),
      })),
      reservations: reservations.map((r) => ({
        accountId: r.accountId,
        reserved: money({ amount: r.reserved, currency: r.currency }),
      })),
      committed: items,
      planned: plans.map((p) => ({
        goalId: p.goalId,
        goalName: p.goalName,
        pending: money({ amount: p.pending, currency: p.currency }),
      })),
      minimumReserve: reserve ? money(reserve) : null,
    });

    // ---- consolidado: una sola resolución de tasas por petición (solo las monedas sin tasa ya resuelta)
    const rates = new Map(ctx.knownRates);
    const missing = result.byCurrency
      .map((t) => t.currency.code)
      .filter((code) => code !== ctx.reporting.code && !rates.has(code));
    if (missing.length > 0) {
      const found = await this.deps.rates.resolveValuationRates({
        workspaceId: ws,
        requests: missing.map((code) => ({ base: code, quote: ctx.reporting.code, at: ctx.now.toString() })),
        windowDays: ctx.windowDays,
      });
      missing.forEach((code, i) => {
        const r = found[i];
        if (r) rates.set(code, r);
      });
    }
    const used = new Map<string, ResolvedRateDto>();
    const rateFor = (code: string): ExactRate | null => {
      const r = rates.get(code);
      if (!r) return null;
      used.set(rateKey(r.resolved), r.resolved);
      return toExact(r);
    };
    const consolidated = SpendableCalculator.consolidate(result.byCurrency, ctx.reporting, rateFor);

    const cards = ctx.accounts
      .filter((a) => a.type === 'CREDIT_CARD' && a.nature === 'LIABILITY')
      .filter((a) => ctx.balanceOf(a.accountId).isPositive())
      .map((a) => a.accountId);
    const budgetView: SpendableBudgetViewDto = budget
      ? {
          status: 'AVAILABLE',
          action: null,
          budgetId: budget.budgetId,
          amount: budget.totals.availableToSpend,
          complete: budget.totals.complete,
        }
      : { status: 'NO_PLAN', action: 'CREATE_BUDGET', budgetId: null, amount: null, complete: null };

    const summary: SpendableSummaryDto = {
      period,
      reportingCurrency: ctx.reporting.code,
      byCurrency: result.byCurrency.map((t) => ({
        currency: t.currency.code,
        liquid: t.liquid.toJSON(),
        reservedForGoals: t.reservedForGoals.toJSON(),
        committed: t.committed.toJSON(),
        plannedGoalContributions: t.plannedGoalContributions.toJSON(),
        minimumReserve: t.minimumReserve?.toJSON() ?? null,
        spendable: t.spendable.toJSON(),
      })),
      consolidated: {
        total: SpendableCalculator.present(consolidated.total, ctx.reporting).toJSON(),
        complete: consolidated.complete,
        unconverted: consolidated.unconverted.map((m) => m.toJSON()),
      },
      shortfalls: consolidated.shortfalls.map((m) => m.toJSON()),
      status: consolidated.status,
      withoutAmountCount: result.withoutAmountCount,
      cardsWithoutPaymentCount: SpendableCalculator.cardsWithoutPayment(cards, items),
      budgetView,
    };
    ports.metrics?.observe(SPENDABLE_DURATION_METRIC, monotonic() - started);
    return {
      summary,
      detail: {
        committedItems: result.committedItems.map((i) => ({
          source: i.source,
          id: i.id,
          definitionId: i.definitionId,
          name: i.name,
          kind: i.kind,
          date: i.date,
          accountId: i.accountId,
          amount: (i.amount as Money).toJSON(),
          overdueFromPrevious: i.overdueFromPrevious,
        })),
        reservedByAccount: result.reservedByAccount.map((r) => ({
          accountId: r.accountId,
          name: r.name,
          balance: r.balance.toJSON(),
          reserved: r.reserved.toJSON(),
          counted: r.counted.toJSON(),
        })),
        plannedByGoal: result.planned.map((p) => ({
          goalId: p.goalId,
          goalName: p.goalName,
          pending: p.pending.toJSON(),
        })),
      },
      ratesUsed: [...used.values()],
    };
  }
}

export interface GetSpendableQuery {
  readonly userId: string | null;
  readonly workspaceId: string;
  /** Por defecto la moneda base del workspace. */
  readonly reportingCurrency?: string;
}

export interface SpendableQueryResult {
  readonly spendable: SpendableDto;
  /** Versión derivada de los datos del workspace (parte del ETag). */
  readonly dataVersion: string;
}

/**
 * `GetSpendable` (`GET /reports/spendable`, VIEWER): el detalle del disponible (ítems comprometidos, reservas por cuenta,
 * aportes planificados por meta y tasas usadas). Una sola transacción de lectura con RLS del workspace.
 */
export class SpendableQueries {
  constructor(
    private readonly deps: ReportingDeps,
    private readonly ports: SpendableDeps,
  ) {}

  getSpendable(query: GetSpendableQuery): Promise<SpendableQueryResult> {
    return this.deps.uow.run({ userId: query.userId, workspaceId: query.workspaceId }, () =>
      this.compute(query),
    );
  }

  private async compute(query: GetSpendableQuery): Promise<SpendableQueryResult> {
    const { deps } = this;
    const ws = query.workspaceId;
    const settings = await deps.workspaces.settingsOf(ws);
    const catalog = await deps.rates.workspaceCurrencies(ws);
    const known = new Map<string, Currency>(catalog.map((c) => [c.code, makeCurrency(c.code, c.scale)]));
    const enabled = new Set(catalog.filter((c) => c.enabled).map((c) => c.code));
    const reportingCode = query.reportingCurrency ?? settings.baseCurrency;
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
    const balances = await deps.balances.getAccountBalances({
      workspaceId: ws,
      accountIds: accounts.map((a) => a.accountId),
      asOf: today.toString(),
    });
    const presented = new Map(
      balances.balances.filter((b) => b.accountId !== null).map((b) => [b.accountId as string, b.presented]),
    );
    const windowDays = deps.rateValidityWindowDays ?? DEFAULT_RATE_VALIDITY_WINDOW_DAYS;
    const calculation = await new SpendableCalculation(deps, this.ports).compute({
      workspaceId: ws,
      now,
      today,
      reporting,
      scaleOf,
      accounts,
      balanceOf: (accountId) => {
        const p = presented.get(accountId);
        const account = accounts.find((a) => a.accountId === accountId) as AccountSummaryDto;
        return p
          ? Money.parse(p.amount, scaleOf(p.currency, p.amount))
          : Money.zero(scaleOf(account.currency));
      },
      knownRates: new Map(),
      windowDays,
    });
    const attributions = new Map<string, RateAttributionDto>();
    for (const r of calculation.ratesUsed) for (const a of attributionsOf(r)) attributions.set(a.provider, a);
    const spendable: SpendableDto = {
      ...calculation.summary,
      ...calculation.detail,
      meta: {
        generatedAt: now.toString(),
        rateWindowDays: windowDays,
        ...(balances.latestEntryAt ? { dataFreshness: balances.latestEntryAt } : {}),
        ratesUsed: calculation.ratesUsed,
        attributions: [...attributions.values()],
      },
    };
    return { spendable, dataVersion: await deps.versions.versionOf(ws) };
  }
}
