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
  SpendableEssentials,
  SpendableHorizon,
  type EssentialPlanPeriod,
  type EssentialsResult,
  type ExactRate,
  type PlanCategoryNode,
  type SpendableCommittedItem,
  type UpcomingIncome,
} from '../domain/index.js';
import {
  DEFAULT_SPENDABLE_SETTINGS,
  type BudgetAvailabilityRow,
  type ReportingDeps,
  type SpendableDeps,
} from './ports/index.js';
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
  readonly detail: Pick<
    SpendableDto,
    'committedItems' | 'reservedByAccount' | 'plannedByGoal' | 'essentialItems' | 'essentialWarnings'
  >;
  /** Tasas usadas por el consolidado (el resumen las suma a `meta.ratesUsed`). */
  readonly ratesUsed: readonly ResolvedRateDto[];
}

/** Líneas del plan de un periodo en la forma que usan los esenciales; `null` si no hay plan o no trae líneas. */
function planOf(row: BudgetAvailabilityRow | null, scaleOf: (code: string, amount?: string) => Currency) {
  if (!row?.lines || row.currency === undefined) return null;
  const money = (dto: MoneyDto) => Money.parse(dto.amount, scaleOf(dto.currency, dto.amount));
  return {
    currency: row.currency,
    lines: row.lines
      .filter((l) => l.target.kind === 'CATEGORY' || l.target.kind === 'GROUP' || l.target.kind === 'TAG')
      .map((l) => ({
        targetKind: l.target.kind as 'CATEGORY' | 'GROUP' | 'TAG',
        targetId: l.target.id,
        nature: l.nature as 'EXPENSE' | 'INCOME',
        reference: money(l.reference),
        actual: money(l.actual),
      })),
  };
}

/**
 * Cálculo del disponible para gastar libre de compromisos (Q5; openspec add-spendable-amount, design.md decisiones 2 a
 * 13; add-cash-flow-forecast decisiones 10 a 12). Lee la FUENTE DE VERDAD en la unidad de trabajo ya abierta
 * (read-your-writes, D117) por los contratos públicos de COMMITMENTS, GOALS, IDENTITY, CLASSIFICATION y PLANNING, una
 * sola vez cada uno y por lote; todo lo financiero lo hace el DS puro `SpendableCalculator`. Sin efectos.
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

    // ---- ajustes del disponible (D377, D378): sin fila, valores por omisión
    const settings = (await ports.settings?.read(ws)) ?? DEFAULT_SPENDABLE_SETTINGS;

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

    // ---- horizonte: el periodo (por omisión) o hasta el próximo ingreso esperado (D377)
    const today = ctx.today.toString();
    let incomes: UpcomingIncome[] = [];
    if (settings.horizonMode === 'NEXT_INCOME' && ports.commitments.listForCashFlow) {
      const upcoming = await ports.commitments.listForCashFlow({
        workspaceId: ws,
        through: ctx.today.plusDays(90).toString(),
      });
      incomes = upcoming.items
        .filter((i) => i.kind === 'INCOME')
        .map((i) => ({ occurrenceId: i.occurrenceId, name: i.definitionName, date: i.dueDate }));
    }
    const horizon = SpendableHorizon.resolve({ mode: settings.horizonMode, today, period, incomes });
    // Periodos posteriores al de hoy que alcanza el horizonte por ingreso (sus aportes y esenciales entran, D387 y D388).
    const reached =
      horizon.mode === 'NEXT_INCOME'
        ? SpendableHorizon.periodsReached(
            periods.map((p) => ({ id: p.id, label: p.label, start: p.periodStart, end: p.periodEnd })),
            today,
            horizon.to,
          )
        : [];

    // ---- lecturas por lote (contratos públicos, misma transacción)
    const liquid = ctx.accounts.filter(isLiquidAccount);
    const reservations = await ports.reservations.getReservedByAccount({
      workspaceId: ws,
      accountIds: liquid.map((a) => a.accountId),
    });
    const committed = await ports.commitments.listForSpendable({
      workspaceId: ws,
      periodFrom: period.start,
      periodTo: horizon.to,
    });
    const currentPlans = await ports.goalPlans.getForPeriod({
      workspaceId: ws,
      from: period.start,
      to: period.end,
    });
    // Aportes planificados: lo pendiente del periodo en curso más lo planificado completo de cada periodo posterior (D388).
    const mergedPlans = new Map<string, { goalId: string; goalName: string; pending: Money }>();
    const addPlan = (p: { goalId: string; goalName: string; currency: string; pending: string }) => {
      const amount = money({ amount: p.pending, currency: p.currency });
      const prev = mergedPlans.get(p.goalId);
      mergedPlans.set(p.goalId, {
        goalId: p.goalId,
        goalName: p.goalName,
        pending: prev ? prev.pending.add(amount) : amount,
      });
    };
    currentPlans.forEach(addPlan);
    for (const later of reached) {
      const rows = await ports.goalPlans.getForPeriod({ workspaceId: ws, from: later.start, to: later.end });
      rows.forEach(addPlan);
    }
    const reserve = await ports.minimumReserve.getMinimumLiquidityReserve({ workspaceId: ws });
    const budget = period.id
      ? await ports.budgets.getForPeriod({ workspaceId: ws, periodId: period.id })
      : null;

    // ---- cálculo puro
    const items: SpendableCommittedItem[] = committed.items.map((i) => ({
      ...i,
      amount: i.amount === null ? null : money(i.amount),
    }));
    const base = SpendableCalculator.calculate({
      period: { from: period.start, to: horizon.to },
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
      planned: [...mergedPlans.values()].map((p) => ({
        goalId: p.goalId,
        goalName: p.goalName,
        pending: p.pending,
      })),
      minimumReserve: reserve ? money(reserve) : null,
    });

    // ---- esenciales presupuestados (D378): categorías propias de REPORTING, planes del periodo en curso y los alcanzados
    let essentials: EssentialsResult | null = null;
    if (settings.subtractEssentials) {
      essentials = await this.essentials(ctx, settings.essentialCategoryIds, {
        period,
        reached,
        horizonEnd: horizon.to,
        budget,
        counted: base.committedItems,
      });
    }
    const result = SpendableCalculator.applyEssentials(base, essentials?.byCurrency ?? null);

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
      horizon: {
        mode: horizon.mode,
        from: horizon.from,
        to: horizon.to,
        nextIncome: horizon.nextIncome,
        fallback: horizon.fallback,
      },
      reportingCurrency: ctx.reporting.code,
      byCurrency: result.byCurrency.map((t) => ({
        currency: t.currency.code,
        liquid: t.liquid.toJSON(),
        reservedForGoals: t.reservedForGoals.toJSON(),
        committed: t.committed.toJSON(),
        plannedGoalContributions: t.plannedGoalContributions.toJSON(),
        minimumReserve: t.minimumReserve?.toJSON() ?? null,
        essentials: t.essentials?.toJSON() ?? null,
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
        essentialItems: (essentials?.items ?? []).map((i) => ({
          categoryId: i.categoryId,
          name: i.name,
          periodLabel: i.periodLabel,
          reference: i.reference.toJSON(),
          actual: i.actual.toJSON(),
          committed: i.committed.toJSON(),
          counted: i.counted.toJSON(),
          prorated: i.prorated,
        })),
        essentialWarnings: (essentials?.warnings ?? []).map((w) => ({
          categoryId: w.categoryId,
          reason: w.reason,
          periodLabel: w.periodLabel,
        })),
      },
      ratesUsed: [...used.values()],
    };
  }

  /**
   * Término de esenciales (D378, D387): lee el árbol de categorías (para validar y resolver subcategorías) y los planes de
   * los periodos posteriores que alcanza el horizonte; los del periodo en curso ya vienen leídos.
   */
  private async essentials(
    ctx: SpendableContext,
    essentialIds: readonly string[],
    input: {
      readonly period: {
        readonly id: string | null;
        readonly label: string;
        readonly start: string;
        readonly end: string;
      };
      readonly reached: readonly {
        readonly id: string;
        readonly label: string;
        readonly start: string;
        readonly end: string;
      }[];
      readonly horizonEnd: string;
      readonly budget: BudgetAvailabilityRow | null;
      readonly counted: readonly SpendableCommittedItem[];
    },
  ): Promise<EssentialsResult> {
    const { ports } = this;
    const ws = ctx.workspaceId;
    if (essentialIds.length === 0 || !ports.categories) {
      return { byCurrency: new Map(), items: [], warnings: [] };
    }
    const tree = await ports.categories.categoryTree({ userId: '', workspaceId: ws });
    const nodes = new Map<string, PlanCategoryNode>(
      tree.categories.map((c) => [c.categoryId, { parentId: c.parentId, groupId: c.groupId }]),
    );
    const info = new Map(tree.categories.map((c) => [c.categoryId, c]));
    const current: EssentialPlanPeriod = {
      label: input.period.label,
      start: input.period.start,
      end: input.period.end,
      plan: planOf(input.budget, ctx.scaleOf),
    };
    const later: EssentialPlanPeriod[] = [];
    for (const p of input.reached) {
      const row = await ports.budgets.getForPeriod({ workspaceId: ws, periodId: p.id });
      later.push({ label: p.label, start: p.start, end: p.end, plan: planOf(row, ctx.scaleOf) });
    }
    return SpendableEssentials.compute({
      essentials: essentialIds.map((id) => ({
        categoryId: id,
        name: info.get(id)?.name ?? id,
        archived: info.get(id)?.archived ?? true,
      })),
      current,
      later,
      horizonEnd: input.horizonEnd,
      categories: nodes,
      committed: input.counted.map((i) => ({ categoryId: i.categoryId ?? null, amount: i.amount as Money })),
      currencyOf: (code) => ctx.scaleOf(code),
    });
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
