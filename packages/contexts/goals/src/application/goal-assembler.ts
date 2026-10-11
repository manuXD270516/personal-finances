import {
  DomainError,
  FlowValuation,
  LocalDate,
  Money,
  currency as makeCurrency,
  dec,
  type Currency,
} from '@pf/shared-kernel';
import {
  RESERVING_STATUSES,
  calculateExpectedDate,
  calculateProgress,
  calculateRequiredContribution,
  evaluateTracking,
  paceWindow,
  type ExpectedDate,
  type GoalProgress,
  type GoalState,
  type GoalTracking,
  type PeriodNet,
  type RequiredContribution,
  type SavingsGoal,
} from '../domain/index.js';
import { RateBook, type RateNeeds } from './rate-book.js';
import type { FlowRow, FundRow, GoalsDeps, PlanRecord } from './ports/index.js';
import {
  expectedDateView,
  moneyDto,
  paceView,
  planView,
  progressView,
  requiredView,
  trackingView,
  type GoalDetail,
  type GoalView,
  type GoalsMeta,
  type LinkedAccountView,
} from './views.js';

export interface CalendarInfo {
  readonly today: LocalDate;
  readonly timeZone: string;
  readonly startDay: number;
}

/** Cálculo completo de una meta (antes de convertirlo en vista): lo reutilizan Home, simulación y evaluación diaria. */
export interface GoalComputation {
  readonly goal: GoalState;
  readonly target: Money;
  readonly progress: GoalProgress;
  readonly required: RequiredContribution | null;
  readonly expected: ExpectedDate | null;
  readonly tracking: GoalTracking;
  readonly overAllocated: boolean;
}

export interface SimulationOverrides {
  readonly monthlyContribution?: string | undefined;
  readonly targetAmount?: string | undefined;
  readonly targetDate?: string | null | undefined;
}

export interface Assembled {
  readonly computations: ReadonlyMap<string, GoalComputation>;
  readonly views: readonly GoalView[];
  readonly meta: GoalsMeta;
}

/**
 * Ensambla las metas para lectura (openspec add-savings-goals, decisiones 11–14, 26): consultas por lote
 * (`SUM … GROUP BY`) y UNA resolución de tasas por petición. Nada derivado se persiste.
 */
export class GoalAssembler {
  private readonly scales = new Map<string, number>();

  constructor(private readonly deps: GoalsDeps) {}

  async currencyOf(code: string): Promise<Currency> {
    let scale = this.scales.get(code);
    if (scale === undefined) {
      const found = await this.deps.currencies.scaleOf(code);
      if (found === null) throw new DomainError('CURRENCY_NOT_ENABLED', `unknown currency ${code}`);
      scale = found;
      this.scales.set(code, scale);
    }
    return makeCurrency(code, scale);
  }

  async calendar(workspaceId: string): Promise<CalendarInfo> {
    const cal = await this.deps.calendar.calendarOf(workspaceId);
    return {
      today: LocalDate.ofInstant(this.deps.clock.now(), cal.timeZone),
      timeZone: cal.timeZone,
      startDay: cal.startDay,
    };
  }

  async assemble(
    workspaceId: string,
    goals: readonly SavingsGoal[],
    options: { readonly simulate?: SimulationOverrides } = {},
  ): Promise<Assembled> {
    const { deps } = this;
    const cal = await this.calendar(workspaceId);
    const ids = goals.map((g) => g.id);
    const sumRows = ids.length ? await deps.movements.sums(workspaceId, ids) : [];
    const fundRows = ids.length ? await deps.movements.funds(workspaceId, { goalIds: ids }) : [];
    const plans = ids.length ? await deps.plans.getMany(workspaceId, ids) : [];
    const overAllocated = new Set(
      (await deps.reservations.overAllocated(workspaceId)).map((s) => s.accountId),
    );
    const planOf = new Map(plans.map((p) => [p.goalId, p] as const));
    const waiting = new Map<string, boolean>();
    for (const p of plans) {
      if (p.automation === 'RECURRING') {
        waiting.set(p.goalId, (await deps.materializations.waitingForGoal(workspaceId, p.goalId)) > 0);
      }
    }

    // Ventana del ritmo de cada meta y movimientos de esos periodos (reasignaciones incluidas).
    const windows = new Map(
      goals.map((g) => {
        const s = g.snapshot;
        return [
          g.id,
          paceWindow({
            startDay: cal.startDay,
            today: cal.today,
            goalStartDate: LocalDate.parse(s.startDate),
            pacePeriods: s.pacePeriods,
          }),
        ] as const;
      }),
    );
    const allPeriods = [...windows.values()].flat();
    let flowRows: readonly FlowRow[] = [];
    if (allPeriods.length > 0 && ids.length > 0) {
      const from = allPeriods.map((p) => p.range.start.toString()).sort()[0] as string;
      const to = allPeriods
        .map((p) => p.range.end.toString())
        .sort()
        .at(-1) as string;
      flowRows = await deps.movements.flows(workspaceId, {
        goalIds: ids,
        from,
        to,
        includeReassignments: true,
      });
    }

    // Tasas: una sola resolución para el stock (hoy) y los flujos (cierre de cada fecha).
    const needs = this.needsOf(goals, sumRows, flowRows, windows);
    const book = await RateBook.resolve({
      valuation: deps.valuation,
      workspaceId,
      needs,
      timeZone: cal.timeZone,
      now: deps.clock.now(),
      windowDays: deps.settings.rateValidityWindowDays,
    });

    const accountIds = [
      ...new Set([...goals.flatMap((g) => g.snapshot.linkedAccountIds), ...fundRows.map((f) => f.accountId)]),
    ];
    const accountInfo = new Map(
      (accountIds.length ? await deps.accounts.find(workspaceId, accountIds) : []).map(
        (a) => [a.accountId, a] as const,
      ),
    );

    const computations = new Map<string, GoalComputation>();
    const views: GoalView[] = [];
    for (const goal of goals) {
      const simulate = goals.length === 1 ? options.simulate : undefined;
      const computation = await this.compute({
        goal,
        cal,
        book,
        sums: sumRows.filter((r) => r.goalId === goal.id),
        flows: flowRows.filter((r) => r.goalId === goal.id),
        window: windows.get(goal.id) ?? [],
        plan: planOf.get(goal.id) ?? null,
        overAllocatedAccounts: overAllocated,
        funds: fundRows.filter((f) => f.goalId === goal.id),
        simulate,
      });
      computations.set(goal.id, computation);
      views.push(
        await this.viewOf(
          computation,
          planOf.get(goal.id) ?? null,
          waiting.get(goal.id) ?? false,
          fundRows.filter((f) => f.goalId === goal.id),
          overAllocated,
          accountInfo,
        ),
      );
    }
    return {
      computations,
      views,
      meta: {
        ratesUsed: book.ratesUsed(),
        rateWindowDays: book.windowDays,
        asOf: book.asOf,
        today: cal.today.toString(),
      },
    };
  }

  /** Detalle de una meta con `meta` (tasas usadas con atribución). */
  async detail(workspaceId: string, goal: SavingsGoal): Promise<GoalDetail> {
    const { views, meta } = await this.assemble(workspaceId, [goal]);
    return { ...(views[0] as GoalView), meta };
  }

  // ───────────────────────────────────────────────────────────── internos

  private needsOf(
    goals: readonly SavingsGoal[],
    sums: readonly { goalId: string; currency: string; amount: string }[],
    flows: readonly FlowRow[],
    windows: ReadonlyMap<string, ReturnType<typeof paceWindow>>,
  ): RateNeeds {
    const stock = new Map<string, { from: string; to: string }>();
    const flowNeeds = new Map<string, { from: string; to: string; date: string }>();
    for (const g of goals) {
      const to = g.snapshot.currency;
      for (const s of sums) {
        if (s.goalId === g.id && s.currency !== to && !dec(s.amount).isZero()) {
          stock.set(`${s.currency}|${to}`, { from: s.currency, to });
        }
      }
      const periods = windows.get(g.id) ?? [];
      for (const f of flows) {
        if (f.goalId !== g.id || f.currency === to) continue;
        if (periods.some((p) => f.date >= p.range.start.toString() && f.date <= p.range.end.toString())) {
          flowNeeds.set(`${f.currency}|${to}|${f.date}`, { from: f.currency, to, date: f.date });
        }
      }
    }
    return { stock: [...stock.values()], flows: [...flowNeeds.values()] };
  }

  private async compute(input: {
    goal: SavingsGoal;
    cal: CalendarInfo;
    book: RateBook;
    sums: readonly { currency: string; amount: string }[];
    flows: readonly FlowRow[];
    window: ReturnType<typeof paceWindow>;
    plan: PlanRecord | null;
    overAllocatedAccounts: ReadonlySet<string>;
    funds: readonly FundRow[];
    simulate: SimulationOverrides | undefined;
  }): Promise<GoalComputation> {
    const { goal, cal, book } = input;
    const base = goal.snapshot;
    const state: GoalState = input.simulate
      ? {
          ...base,
          ...(input.simulate.targetAmount !== undefined ? { targetAmount: input.simulate.targetAmount } : {}),
          ...(input.simulate.targetDate !== undefined ? { targetDate: input.simulate.targetDate } : {}),
        }
      : base;
    const currency = await this.currencyOf(state.currency);
    const target = Money.parse(state.targetAmount, currency);
    const sums: Money[] = [];
    for (const s of input.sums) sums.push(Money.parse(s.amount, await this.currencyOf(s.currency)));
    const progress = calculateProgress({
      target,
      sums,
      rateFor: (code) => book.stock(code, currency.code),
    });
    const targetDate = state.targetDate ? LocalDate.parse(state.targetDate) : null;
    const live = state.status === 'ACTIVE' || state.status === 'PAUSED' || state.status === 'ACHIEVED';
    const required = live
      ? calculateRequiredContribution({
          remaining: progress.remainingExact,
          currency,
          today: cal.today,
          targetDate,
          startDay: cal.startDay,
        })
      : null;
    let expected: ExpectedDate | null = null;
    if (live) {
      const periodNets = new Map<string, PeriodNet>();
      for (const p of input.window) {
        const rows: { date: string; amount: Money }[] = [];
        for (const f of input.flows) {
          if (f.date >= p.range.start.toString() && f.date <= p.range.end.toString()) {
            rows.push({ date: f.date, amount: Money.parse(f.amount, await this.currencyOf(f.currency)) });
          }
        }
        const consolidated = FlowValuation.consolidate(rows, currency, (code, date) =>
          book.flow(code, currency.code, date),
        );
        periodNets.set(p.label, { net: consolidated.total, complete: consolidated.complete });
      }
      const simulated =
        input.simulate?.monthlyContribution !== undefined
          ? dec(input.simulate.monthlyContribution)
          : undefined;
      expected = calculateExpectedDate({
        remaining: progress.remainingExact,
        currency,
        today: cal.today,
        startDay: cal.startDay,
        goalStartDate: LocalDate.parse(state.startDate),
        pacePeriods: state.pacePeriods,
        periodNets,
        planMonthly: input.plan ? dec(input.plan.monthlyAmount) : null,
        achievedOn: state.achievedOn ? LocalDate.parse(state.achievedOn) : null,
        simulatedPace: simulated,
      });
    }
    const tracking = evaluateTracking({
      lifecycleStatus: state.status,
      target,
      progress: progress.totalExact,
      startDate: LocalDate.parse(state.startDate),
      targetDate,
      today: cal.today,
      tolerancePercent: state.tolerancePercent,
    });
    const overAllocated = input.funds.some(
      (f) =>
        RESERVING_STATUSES.includes(f.goalStatus) &&
        input.overAllocatedAccounts.has(f.accountId) &&
        dec(f.amount).gt(0),
    );
    return { goal: state, target, progress, required, expected, tracking, overAllocated };
  }

  private async viewOf(
    c: GoalComputation,
    plan: PlanRecord | null,
    waiting: boolean,
    funds: readonly FundRow[],
    overAllocatedAccounts: ReadonlySet<string>,
    accounts: ReadonlyMap<string, { currency: string }>,
  ): Promise<GoalView> {
    const s = c.goal;
    const linked: LinkedAccountView[] = [];
    const accountIds = [...new Set([...s.linkedAccountIds, ...funds.map((f) => f.accountId)])];
    for (const accountId of accountIds) {
      const code =
        accounts.get(accountId)?.currency ?? funds.find((f) => f.accountId === accountId)?.currency;
      if (!code) continue;
      const cur = await this.currencyOf(code);
      const sum = (fund: 'REAL' | 'EARMARK') =>
        funds
          .filter((f) => f.accountId === accountId && f.fund === fund)
          .reduce((acc, f) => acc.plus(dec(f.amount)), dec('0'));
      linked.push({
        accountId,
        funds: {
          real: moneyDto(Money.roundToScale(sum('REAL'), cur)),
          earmark: moneyDto(Money.roundToScale(sum('EARMARK'), cur)),
        },
        overAllocated: overAllocatedAccounts.has(accountId) && dec(sum('REAL').plus(sum('EARMARK'))).gt(0),
      });
    }
    return {
      id: s.id,
      name: s.name,
      type: s.type,
      target: moneyDto(c.target),
      startDate: s.startDate,
      targetDate: s.targetDate,
      linkedAccountIds: s.linkedAccountIds,
      priority: s.priority,
      icon: s.icon,
      color: s.color,
      notes: s.notes,
      tolerancePercent: s.tolerancePercent,
      pacePeriods: s.pacePeriods,
      status: s.status,
      achievedOn: s.achievedOn,
      closedOn: s.closedOn,
      cancelledOn: s.cancelledOn,
      cancelReason: s.cancelReason,
      archivedAt: s.archivedAt,
      version: s.version,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      progress: progressView(c.progress),
      required: c.required ? requiredView(c.required) : { monthly: null, periods: null, overdue: false },
      pace: c.expected ? paceView(c.expected) : { amount: null, periods: 0, source: 'NONE', complete: true },
      expectedDate: c.expected ? expectedDateView(c.expected) : { date: null, reason: null },
      tracking: trackingView(c.tracking),
      overAllocated: c.overAllocated,
      linkedAccounts: linked,
      plan: plan ? planView(plan, waiting) : null,
    };
  }
}
