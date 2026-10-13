import { DomainError, FlowValuation, Money, dec, type Decimal } from '@pf/shared-kernel';
import type { LifecycleDto } from '@pf/audit/contracts';
import type {
  AccountReservationDto,
  GoalFlowDto,
  GoalFlowsQuery,
  GoalHomeSummaryDto,
  GoalPlanPeriodDto,
  GoalPlansQuery,
  GoalReservationsQuery,
  GoalSummaryQuery,
} from '../contracts/index.js';
import {
  GOAL_LIFECYCLE,
  RESERVING_STATUSES,
  calculateVoidImpact,
  type GoalMovement,
  type GoalStatus,
  type SavingsGoal,
} from '../domain/index.js';
import { GoalAssembler, type SimulationOverrides } from './goal-assembler.js';
import type { FundRow, GoalsDeps, SuggestionStatus } from './ports/index.js';
import { RateBook } from './rate-book.js';
import { reservedOf } from './reservation-watch.js';
import { notFound, parseDate, parseMoney } from './support.js';
import {
  expectedDateView,
  moneyDto,
  movementView,
  paceView,
  progressView,
  suggestionView,
  trackingView,
  type AccountReservationView,
  type GoalDetail,
  type GoalMovementView,
  type GoalSimulationView,
  type GoalTransactionLinkView,
  type GoalView,
  type GoalsMeta,
  type SuggestionView,
  type VoidImpactView,
} from './views.js';

const LIVE: readonly GoalStatus[] = ['ACTIVE', 'PAUSED', 'ACHIEVED'];

const encodeCursor = (c: { occurredOn: string; recordedAt: string; id: string }): string =>
  Buffer.from(`${c.occurredOn}|${c.recordedAt}|${c.id}`, 'utf8').toString('base64url');

function decodeCursor(raw: string): { occurredOn: string; recordedAt: string; id: string } {
  const parts = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const [occurredOn, recordedAt, id] = parts;
  if (parts.length !== 3 || !occurredOn || !recordedAt || !id) {
    throw new DomainError('INVALID_CURSOR', 'cursor is invalid for this resource');
  }
  return { occurredOn, recordedAt, id };
}

/** Consultas de GOALS (lecturas con VIEWER+) y contratos públicos para PLANNING, REPORTING y `add-spendable-amount`. */
export class GoalsQueries implements GoalReservationsQuery, GoalPlansQuery, GoalSummaryQuery, GoalFlowsQuery {
  private readonly assembler: GoalAssembler;

  constructor(private readonly deps: GoalsDeps) {
    this.assembler = new GoalAssembler(deps);
  }

  // ───────────────────────────────────────────────────────────── metas

  async list(
    workspaceId: string,
    filter: { statuses?: readonly GoalStatus[]; type?: string; includeArchived?: boolean } = {},
  ): Promise<{ data: readonly GoalView[]; meta: GoalsMeta }> {
    return this.deps.uow.run(workspaceId, async () => {
      const statuses = filter.statuses ?? LIVE;
      const goals = await this.deps.goals.list(workspaceId, {
        statuses,
        ...(filter.type ? { type: filter.type } : {}),
        includeArchived: filter.includeArchived ?? false,
      });
      const { views, meta } = await this.assembler.assemble(workspaceId, sortGoals(goals));
      return { data: views, meta };
    });
  }

  async get(workspaceId: string, goalId: string): Promise<GoalDetail> {
    return this.deps.uow.run(workspaceId, async () => {
      const goal = await this.deps.goals.findById(workspaceId, goalId);
      if (!goal) throw notFound('goal', goalId);
      return this.assembler.detail(workspaceId, goal);
    });
  }

  async movements(
    workspaceId: string,
    goalId: string,
    query: { from?: string; to?: string; cursor?: string; limit?: number } = {},
  ): Promise<{
    data: readonly GoalMovementView[];
    page: { limit: number; hasMore: boolean; nextCursor: string | null };
  }> {
    return this.deps.uow.run(workspaceId, async () => {
      const goal = await this.deps.goals.findById(workspaceId, goalId);
      if (!goal) throw notFound('goal', goalId);
      const limit = Math.min(Math.max(query.limit ?? this.deps.settings.pageSize, 1), 200);
      const rows = await this.deps.movements.list(workspaceId, goalId, {
        ...(query.from ? { from: parseDate(query.from, '/from').toString() } : {}),
        ...(query.to ? { to: parseDate(query.to, '/to').toString() } : {}),
        ...(query.cursor ? { cursor: decodeCursor(query.cursor) } : {}),
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        data: page.map(movementView),
        page: {
          limit,
          hasMore: rows.length > limit,
          nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
        },
      };
    });
  }

  /**
   * `PreviewTransactionVoidImpact` (fix-phase-4-gaps, decisión 3): efecto sobre los fondos de cada meta de anular la
   * transacción, antes de confirmar. Sin efectos; vacío si la transacción no respalda movimientos de metas; 404 si la
   * transacción no existe en el workspace.
   */
  async previewVoidImpact(workspaceId: string, transactionId: string): Promise<VoidImpactView> {
    return this.deps.uow.run(workspaceId, async () => {
      const { deps } = this;
      const link = await deps.links.getForLink({ workspaceId, transactionId });
      if (!link) throw notFound('transaction', transactionId);
      const live = await deps.movements.liveByTransaction(workspaceId, transactionId);
      if (live.length === 0) return { transactionId, goals: [] };
      const goalIds = [...new Set(live.map((m) => m.goalId))].sort();
      const movementsByGoal = new Map<string, readonly GoalMovement[]>();
      for (const goalId of goalIds)
        movementsByGoal.set(goalId, await deps.movements.listAll(workspaceId, goalId));
      const lines = calculateVoidImpact(live, movementsByGoal);
      const names = new Map<string, string>();
      for (const goalId of goalIds) {
        const goal = await deps.goals.findById(workspaceId, goalId);
        if (goal) names.set(goalId, goal.snapshot.name);
      }
      const accountIds = [...new Set(lines.map((l) => l.accountId))];
      const accounts = new Map(
        (await deps.accounts.find(workspaceId, accountIds)).map((a) => [a.accountId, a] as const),
      );
      const goals: VoidImpactView['goals'][number][] = [];
      for (const line of lines) {
        const account = accounts.get(line.accountId);
        const currency = await this.assembler.currencyOf(
          account?.currency ??
            live.find((m) => m.accountId === line.accountId)?.amount.currency.code ??
            'BOB',
        );
        goals.push({
          goalId: line.goalId,
          goalName: names.get(line.goalId) ?? '',
          accountId: line.accountId,
          accountName: account?.name ?? '',
          fund: line.fund,
          currency: currency.code,
          currentFunds: moneyDto(Money.roundToScale(line.currentFunds, currency)),
          fundsAfterVoid: moneyDto(Money.roundToScale(line.fundsAfterVoid, currency)),
          negative: line.negative,
        });
      }
      return { transactionId, goals };
    });
  }

  async simulate(
    workspaceId: string,
    goalId: string,
    input: {
      monthlyContribution?: { amount: string; currency: string } | undefined;
      targetAmount?: { amount: string; currency: string } | undefined;
      targetDate?: string | null | undefined;
    },
  ): Promise<GoalSimulationView> {
    return this.deps.uow.run(workspaceId, async () => {
      const goal = await this.deps.goals.findById(workspaceId, goalId);
      if (!goal) throw notFound('goal', goalId);
      const currency = goal.snapshot.currency;
      const overrides: { -readonly [K in keyof SimulationOverrides]: SimulationOverrides[K] } = {};
      for (const [key, value] of [
        ['monthlyContribution', input.monthlyContribution],
        ['targetAmount', input.targetAmount],
      ] as const) {
        if (value === undefined) continue;
        const money = await parseMoney(this.deps, value, `/${key}`, { positive: true });
        if (money.currency.code !== currency) {
          throw new DomainError('CURRENCY_MISMATCH', `the simulation must be in ${currency}`).at(
            `/${key}/currency`,
          );
        }
        overrides[key] = money.toFixed();
      }
      if (input.targetDate !== undefined) {
        overrides.targetDate =
          input.targetDate === null ? null : parseDate(input.targetDate, '/targetDate').toString();
      }
      if (overrides.targetDate && overrides.targetDate <= goal.snapshot.startDate) {
        throw new DomainError('VALIDATION_FAILED', 'the target date must be after the start date').at(
          '/targetDate',
        );
      }
      const { computations } = await this.assembler.assemble(workspaceId, [goal], { simulate: overrides });
      const c = computations.get(goal.id);
      if (!c) throw notFound('goal', goalId);
      return {
        requiredMonthly: c.required?.monthly ? moneyDto(c.required.monthly) : null,
        periods: c.required?.periods ?? null,
        overdue: c.required?.overdue ?? false,
        expectedDate: c.expected ? expectedDateView(c.expected) : { date: null, reason: null },
        tracking: trackingView(c.tracking),
        progress: progressView(c.progress),
        pace: c.expected
          ? paceView(c.expected)
          : { amount: null, periods: 0, source: 'NONE', complete: true },
      };
    });
  }

  // ───────────────────────────────────────────────────────────── reservas por cuenta

  async reservations(
    workspaceId: string,
    options: { accountId?: string } = {},
  ): Promise<readonly AccountReservationView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const { deps } = this;
      const funds = await deps.movements.funds(workspaceId, {
        ...(options.accountId ? { accountIds: [options.accountId] } : {}),
      });
      const states = await deps.reservations.states(
        workspaceId,
        options.accountId ? [options.accountId] : undefined,
      );
      const stateOf = new Map(states.map((s) => [s.accountId, s] as const));
      const ids = [
        ...new Set([
          ...funds.filter((f) => RESERVING_STATUSES.includes(f.goalStatus)).map((f) => f.accountId),
          ...states.filter((s) => s.state === 'OVER_ALLOCATED').map((s) => s.accountId),
          ...(options.accountId ? [options.accountId] : []),
        ]),
      ].sort();
      const accounts = new Map(
        (ids.length ? await deps.accounts.find(workspaceId, ids) : []).map((a) => [a.accountId, a] as const),
      );
      const balances = ids.length ? await deps.balances.presentedBalances(workspaceId, ids) : new Map();
      const out: AccountReservationView[] = [];
      for (const accountId of ids) {
        const account = accounts.get(accountId);
        if (!account) {
          if (options.accountId) throw notFound('account', accountId);
          continue;
        }
        const rows = funds.filter(
          (f) => f.accountId === accountId && RESERVING_STATUSES.includes(f.goalStatus),
        );
        const { reserved } = reservedOf(rows);
        if (!options.accountId && reserved.isZero() && stateOf.get(accountId)?.state !== 'OVER_ALLOCATED')
          continue;
        const currency = await this.assembler.currencyOf(account.currency);
        const balance = dec(balances.get(accountId) ?? '0');
        const state = stateOf.get(accountId);
        const present = (v: Decimal) => Money.roundToScale(v, currency).toFixed();
        const available = balance.minus(reserved);
        out.push({
          accountId,
          accountName: account.name,
          currency: account.currency,
          balance: present(balance),
          reserved: present(reserved),
          available: present(available),
          overAllocated: state?.state === 'OVER_ALLOCATED',
          shortfall: state?.state === 'OVER_ALLOCATED' ? (state.shortfall ?? null) : null,
          since: state?.state === 'OVER_ALLOCATED' ? (state.since ?? null) : null,
          accountStatus: account.status,
          goals: goalBreakdown(rows, present),
        });
      }
      return out;
    });
  }

  // ───────────────────────────────────────────────────────────── sugerencias y vínculos

  async suggestions(
    workspaceId: string,
    status?: SuggestionStatus,
  ): Promise<{ data: readonly SuggestionView[]; pendingCount: number }> {
    return this.deps.uow.run(workspaceId, async () => {
      const rows = await this.deps.suggestions.list(workspaceId, status ?? 'PENDING');
      return {
        data: rows.map(suggestionView),
        pendingCount: await this.deps.suggestions.pendingCount(workspaceId),
      };
    });
  }

  async transactionLinks(
    workspaceId: string,
    transactionIds: readonly string[],
  ): Promise<readonly GoalTransactionLinkView[]> {
    if (transactionIds.length > 100) {
      throw new DomainError('VALIDATION_FAILED', 'at most 100 transaction ids').at('/transactionIds');
    }
    return this.deps.uow.run(workspaceId, async () => {
      const rows = await this.deps.movements.byTransactions(workspaceId, transactionIds);
      const goals = new Map(
        (await this.deps.goals.list(workspaceId, { includeArchived: true })).map((g) => [g.id, g] as const),
      );
      const reversed = new Set(rows.map((r) => r.reversesId).filter((id): id is string => id !== null));
      return transactionIds.map((transactionId) => ({
        transactionId,
        links: rows
          .filter((r) => r.transactionId === transactionId)
          .map((r) => ({
            goalId: r.goalId,
            goalName: goals.get(r.goalId)?.snapshot.name ?? '',
            movementId: r.id,
            movement: r.kind,
            fund: r.fund,
            amount: moneyDto(r.amount),
            reversesId: r.reversesId,
            active: r.kind !== 'REVERSAL' && !reversed.has(r.id),
          })),
      }));
    });
  }

  async lifecycle(input: { userId: string; workspaceId: string; goalId: string }): Promise<LifecycleDto> {
    const { deps } = this;
    if (!deps.lifecycleQuery) throw new DomainError('INTERNAL_ERROR', 'lifecycle query is not composed');
    const query = deps.lifecycleQuery;
    return deps.uow.run(input.workspaceId, async () => {
      const goal = await deps.goals.findById(input.workspaceId, input.goalId);
      if (!goal) throw notFound('goal', input.goalId);
      return query.lifecycleOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        aggregateType: GOAL_LIFECYCLE.aggregateType as 'SavingsGoal',
        aggregateId: goal.id,
        currentState: goal.status,
      });
    });
  }

  async nameOf(workspaceId: string, goalId: string): Promise<string> {
    const goal = await this.deps.goals.findById(workspaceId, goalId);
    if (!goal) throw notFound('goal', goalId);
    return goal.snapshot.name;
  }

  // ───────────────────────────────────────────────────────────── contratos públicos

  async getReservedByAccount(input: {
    workspaceId: string;
    accountIds?: readonly string[];
  }): Promise<readonly AccountReservationDto[]> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const { deps } = this;
      const funds = await deps.movements.funds(input.workspaceId, {
        ...(input.accountIds ? { accountIds: input.accountIds } : {}),
        statuses: RESERVING_STATUSES,
      });
      const states = await deps.reservations.states(input.workspaceId, input.accountIds);
      const over = new Set(states.filter((s) => s.state === 'OVER_ALLOCATED').map((s) => s.accountId));
      const out: AccountReservationDto[] = [];
      for (const accountId of [...new Set(funds.map((f) => f.accountId))].sort()) {
        const rows = funds.filter((f) => f.accountId === accountId);
        const first = rows[0] as FundRow;
        const currency = await this.assembler.currencyOf(first.currency);
        const sums = reservedOf(rows);
        const present = (v: Decimal) => Money.roundToScale(v, currency).toFixed();
        out.push({
          accountId,
          currency: currency.code,
          reserved: present(sums.reserved),
          earmarked: present(sums.earmarked),
          realHeld: present(sums.realHeld),
          overAllocated: over.has(accountId),
        });
      }
      return out;
    });
  }

  async getForPeriod(input: {
    workspaceId: string;
    from: string;
    to: string;
  }): Promise<readonly GoalPlanPeriodDto[]> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const { deps } = this;
      const ws = input.workspaceId;
      const goals = (await deps.goals.list(ws, { statuses: ['ACTIVE'] })).filter(
        (g) => g.status === 'ACTIVE',
      );
      if (goals.length === 0) return [];
      const plans = await deps.plans.getMany(
        ws,
        goals.map((g) => g.id),
      );
      const planOf = new Map(plans.map((p) => [p.goalId, p] as const));
      const withPlan = goals.filter((g) => planOf.has(g.id));
      if (withPlan.length === 0) return [];
      const cal = await this.assembler.calendar(ws);
      const rows = await deps.movements.flows(ws, {
        goalIds: withPlan.map((g) => g.id),
        from: input.from,
        to: input.to,
        includeReassignments: false,
      });
      const book = await RateBook.resolve({
        valuation: deps.valuation,
        workspaceId: ws,
        needs: {
          stock: [],
          flows: rows
            .map((r) => ({ goal: withPlan.find((g) => g.id === r.goalId), r }))
            .filter(({ goal, r }) => goal && goal.snapshot.currency !== r.currency)
            .map(({ goal, r }) => ({
              from: r.currency,
              to: (goal as SavingsGoal).snapshot.currency,
              date: r.date,
            })),
        },
        timeZone: cal.timeZone,
        now: deps.clock.now(),
        windowDays: deps.settings.rateValidityWindowDays,
      });
      const out: GoalPlanPeriodDto[] = [];
      for (const goal of withPlan) {
        const plan = planOf.get(goal.id);
        if (!plan) continue;
        const currency = await this.assembler.currencyOf(goal.snapshot.currency);
        const flows = [];
        for (const r of rows.filter((x) => x.goalId === goal.id)) {
          flows.push({
            date: r.date,
            amount: Money.parse(r.amount, await this.assembler.currencyOf(r.currency)),
          });
        }
        const consolidated = FlowValuation.consolidate(flows, currency, (code, date) =>
          book.flow(code, currency.code, date),
        );
        const planned = dec(plan.monthlyAmount);
        const contributed = consolidated.total;
        const pending = planned.minus(contributed);
        const present = (v: Decimal) => Money.roundToScale(v, currency).toFixed();
        out.push({
          goalId: goal.id,
          goalName: goal.snapshot.name,
          currency: currency.code,
          planned: present(planned),
          contributed: present(contributed),
          pending: present(pending.isNegative() ? dec('0') : pending),
          exceededBy: present(pending.isNegative() ? pending.negated() : dec('0')),
          automation: plan.automation,
          definitionId: plan.definitionId,
          complete: consolidated.complete,
        });
      }
      return out;
    });
  }

  async listForHome(input: { workspaceId: string; limit: number }): Promise<GoalHomeSummaryDto> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const goals = sortGoals(await this.deps.goals.list(input.workspaceId, { statuses: LIVE }));
      const top = goals.slice(0, Math.max(0, input.limit));
      if (top.length === 0) {
        return { items: [], moreCount: goals.length, goalCount: goals.length, ratesUsed: [] };
      }
      const { computations, meta } = await this.assembler.assemble(input.workspaceId, top);
      return {
        items: top.map((g) => {
          const c = computations.get(g.id);
          if (!c) throw notFound('goal', g.id);
          return {
            goalId: g.id,
            name: c.goal.name,
            priority: c.goal.priority,
            percent: c.progress.percent,
            progress: moneyDto(c.progress.total),
            target: moneyDto(c.target),
            tracking: trackingView(c.tracking),
            lifecycleStatus: c.goal.status,
            requiredMonthly: c.required?.monthly ? moneyDto(c.required.monthly) : null,
            overdue: c.required?.overdue ?? false,
            expectedDate: c.expected?.date ? c.expected.date.toString() : null,
            overAllocated: c.overAllocated,
            complete: c.progress.complete,
          };
        }),
        moreCount: Math.max(0, goals.length - top.length),
        goalCount: goals.length,
        ratesUsed: meta.ratesUsed,
      };
    });
  }

  async netForRange(input: {
    workspaceId: string;
    from: string;
    to: string;
  }): Promise<readonly GoalFlowDto[]> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const rows = await this.deps.movements.flows(input.workspaceId, {
        from: parseDate(input.from, '/from').toString(),
        to: parseDate(input.to, '/to').toString(),
        includeReassignments: false,
      });
      const merged = new Map<string, { date: string; currency: string; amount: Decimal }>();
      for (const r of rows) {
        const key = `${r.date}|${r.currency}`;
        const prev = merged.get(key);
        merged.set(key, {
          date: r.date,
          currency: r.currency,
          amount: (prev?.amount ?? dec('0')).plus(dec(r.amount)),
        });
      }
      const out: GoalFlowDto[] = [];
      for (const key of [...merged.keys()].sort()) {
        const m = merged.get(key) as { date: string; currency: string; amount: Decimal };
        if (m.amount.isZero()) continue;
        const currency = await this.assembler.currencyOf(m.currency);
        out.push({ date: m.date, amount: moneyDto(Money.roundToScale(m.amount, currency)) });
      }
      return out;
    });
  }
}

/** Orden de Q9 y del listado: prioridad, fecha objetivo (sin fecha al final) y nombre. */
export function sortGoals(goals: readonly SavingsGoal[]): SavingsGoal[] {
  return [...goals].sort((a, b) => {
    const x = a.snapshot;
    const y = b.snapshot;
    if (x.priority !== y.priority) return x.priority - y.priority;
    if (x.targetDate !== y.targetDate) {
      if (x.targetDate === null) return 1;
      if (y.targetDate === null) return -1;
      return x.targetDate < y.targetDate ? -1 : 1;
    }
    return x.name.localeCompare(y.name, 'es');
  });
}

function goalBreakdown(rows: readonly FundRow[], present: (v: Decimal) => string) {
  const byGoal = new Map<
    string,
    { name: string; status: GoalStatus; earmarked: Decimal; realHeld: Decimal }
  >();
  for (const r of rows) {
    const row = byGoal.get(r.goalId) ?? {
      name: r.goalName,
      status: r.goalStatus,
      earmarked: dec('0'),
      realHeld: dec('0'),
    };
    if (r.fund === 'EARMARK') row.earmarked = row.earmarked.plus(dec(r.amount));
    else row.realHeld = row.realHeld.plus(dec(r.amount));
    byGoal.set(r.goalId, row);
  }
  return [...byGoal.entries()]
    .filter(([, g]) => !g.earmarked.isZero() || !g.realHeld.isZero())
    .map(([goalId, g]) => ({
      goalId,
      name: g.name,
      status: g.status,
      earmarked: present(g.earmarked),
      realHeld: present(g.realHeld),
    }));
}
