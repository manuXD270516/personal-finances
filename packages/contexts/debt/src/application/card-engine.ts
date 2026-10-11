import type { ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import {
  DomainError,
  FlowValuation,
  LocalDate,
  Money,
  dec,
  currency as makeCurrency,
  present,
  type Currency,
} from '@pf/shared-kernel';
import {
  DEBT_EVENTS,
  type CardPaymentDueV1,
  type CardStatementIssuedV1,
  type CreditUtilizationThresholdReachedV1,
} from '../contracts/index.js';
import {
  CardInstallmentPlan,
  computeCycleFigures,
  computeStatementStanding,
  computeUtilization,
  creditUsed,
  evaluateThresholds,
  expectationForFuture,
  expectationForIssued,
  expectationForOpen,
  initialThresholdStates,
  sameExpectation,
  type CardAccountState,
  type CardCycle,
  type CardMovement,
  type CardStatementStatus,
  type CreditCard,
  type CycleFigures,
  type PlanExpectation,
  type StatementStanding,
  type ThresholdState,
  type Utilization,
} from '../domain/index.js';
import type { CardDeps, StatementRecord } from './card-ports.js';

export const CARD_AGGREGATE = 'CreditCard';

const UNRESOLVED = new Set(['SCHEDULED', 'DUE', 'OVERDUE']);
const rateKey = (r: ResolvedRateDto): string => JSON.stringify(r);

export interface CardClock {
  readonly today: LocalDate;
  readonly at: string;
  readonly timeZone: string;
}

/** Vista calculada de un ciclo de una cuenta. */
export interface CycleView {
  readonly cycle: CardCycle;
  readonly open: boolean;
  readonly record: StatementRecord | null;
  /** Cifras recalculadas hoy con el ledger. */
  readonly current: CycleFigures;
  /** Cifras congeladas al emitir (solo si hay estado emitido). */
  readonly issued: CycleFigures | null;
  /** Situación (lo que falta, estado) de un ciclo cerrado. */
  readonly standing: StatementStanding | null;
  readonly status: CardStatementStatus;
  readonly paymentsAfterClose: Money;
}

export interface AccountView {
  readonly account: CardAccountState;
  readonly currency: Currency;
  /** Saldo adeudado de hoy (presentado). */
  readonly balance: Money;
  /** Compras pendientes (egresos PENDING de la cuenta). */
  readonly pendingOut: Money;
  /** Crédito usado = saldo + pendientes. */
  readonly used: Money;
  /** Ascendentes; el último es el ciclo abierto. */
  readonly cycles: readonly CycleView[];
  readonly plans: readonly CardInstallmentPlan[];
}

export interface UtilizationScope {
  readonly scopeKey: string;
  readonly scope: 'SHARED' | 'ACCOUNT';
  readonly accountId: string | null;
  readonly limit: Money;
  /** `null` si no puede calcularse (falta de tasa); `missingRates` lo explica. */
  readonly utilization: Utilization | null;
  readonly used: Money | null;
  readonly missingRates: readonly string[];
  readonly ratesUsed: readonly ResolvedRateDto[];
}

export function figuresFromRecord(record: StatementRecord, currency: Currency): CycleFigures {
  const m = (v: string) => Money.parse(v, currency);
  const billed = m(record.billedBalance);
  const zero = Money.zero(currency);
  return {
    currency,
    previousBalance: m(record.previousBalance),
    purchases: m(record.purchases),
    refunds: m(record.refunds),
    payments: m(record.payments),
    otherNet: m(record.otherNet),
    closingBalance: m(record.closingBalance),
    unbilledInstallments: m(record.unbilledInstallments),
    billedBalance: billed,
    minimumDue: m(record.minimumDue),
    noInterestPayment: billed.isPositive() ? billed : zero,
    creditBalance: billed.isNegative() ? billed.negate() : zero,
    consistent: true,
  };
}

/**
 * Motor de lectura y sincronización de tarjetas (openspec add-credit-cards, decisiones 3–11): calcula las cifras de
 * los ciclos desde el ledger, mantiene las expectativas del plan de pago, la utilización y las alertas, emite los
 * estados de cuenta y los recordatorios. Los comandos, el consumidor y el job lo comparten. Corre en la unidad de
 * trabajo del llamador; las escrituras sobre la tarjeta suponen que ya la bloqueó (`FOR UPDATE`).
 */
export class CardEngine {
  constructor(private readonly deps: CardDeps) {}

  async clockOf(workspaceId: string): Promise<CardClock> {
    const timeZone = await this.deps.calendar.timeZoneOf(workspaceId);
    const now = this.deps.clock.now();
    return { today: LocalDate.ofInstant(now, timeZone), at: now.toString(), timeZone };
  }

  currencyOf(account: CardAccountState): Currency {
    return makeCurrency(account.currency, account.scale);
  }

  // ───────────────────────────────────────────── vistas calculadas

  async loadAccountView(
    card: CreditCard,
    account: CardAccountState,
    clock: CardClock,
    options: { readonly cycles?: number; readonly records?: readonly StatementRecord[] } = {},
  ): Promise<AccountView> {
    const { deps } = this;
    const workspaceId = card.workspaceId;
    const currency = this.currencyOf(account);
    const calendar = card.calendar;
    const history = options.cycles ?? deps.settings.historyCycles;
    const closed = calendar.closedCycles(clock.today, history).reverse();
    const open = calendar.openCycle(clock.today);
    const cycles = [...closed, open];
    const todayText = clock.today.toString();
    const first = cycles[0] as CardCycle;
    const cutDates = new Set<string>([todayText]);
    for (const c of cycles) {
      cutDates.add(c.start.plusDays(-1).toString());
      if (c.closing.compare(clock.today) < 0) cutDates.add(c.closing.toString());
    }
    // En serie: todas las lecturas comparten la conexión de la unidad de trabajo y `pg` deprecó encolar consultas
    // concurrentes en un mismo cliente (se rompe en pg@9).
    const balances = await deps.balances.at(workspaceId, account.accountId, [...cutDates]);
    const movementRows = await deps.movements.summarizeAccountMovements({
      workspaceId,
      accountIds: [account.accountId],
      dateFrom: first.start.toString(),
      dateTo: todayText,
      groupBy: 'DAY',
    });
    const pendingRows = await deps.pending.listPending({ workspaceId, accountIds: [account.accountId] });
    const records = options.records
      ? options.records.filter((r) => r.cardAccountId === account.id)
      : await deps.statements.listForAccounts(workspaceId, [account.id]);
    const plans = await deps.plans.listForCardAccounts(workspaceId, [account.id]);
    const money = (v: string | undefined): Money => Money.parse(v ?? '0', currency);
    const balanceOn = (d: string): Money => {
      const found = balances.get(d);
      if (found === undefined) {
        throw new DomainError('INTERNAL_ERROR', `balance of ${account.accountId} at ${d} was not resolved`);
      }
      return Money.parse(found, currency);
    };
    const movements: (CardMovement & { date: LocalDate })[] = movementRows.map((r) => ({
      businessDate: r.businessDate,
      movementClass: r.movementClass,
      amount: r.amount.amount,
      date: LocalDate.parse(r.businessDate),
    }));
    const recordByClosing = new Map(records.map((r) => [r.closingDate, r] as const));
    const balance = balanceOn(todayText);
    const pendingOut = pendingRows
      .filter((p) => p.direction === 'OUT' && p.accountId === account.accountId)
      .reduce(
        (acc, p) => acc.add(money(p.amount.currency === currency.code ? p.amount.amount : '0')),
        Money.zero(currency),
      );
    const views: CycleView[] = cycles.map((cycle) => {
      const isOpen = cycle.closing.compare(clock.today) >= 0;
      const upTo = isOpen ? clock.today : cycle.closing;
      const inCycle = movements.filter((m) => m.date.compare(cycle.start) >= 0 && m.date.compare(upTo) <= 0);
      const current = computeCycleFigures({
        currency,
        previousBalance: balanceOn(cycle.start.plusDays(-1).toString()),
        closingBalance: isOpen ? balance : balanceOn(cycle.closing.toString()),
        movements: inCycle,
        unbilledInstallments: CardInstallmentPlan.unbilledCapital(plans, cycle.closing, currency),
        minimumRule: account.minimumRule,
      });
      const record = recordByClosing.get(cycle.closing.toString()) ?? null;
      const paymentsAfterClose = isOpen
        ? Money.zero(currency)
        : movements
            .filter(
              (m) =>
                m.movementClass === 'PAYMENT' &&
                m.date.compare(cycle.closing) > 0 &&
                m.date.compare(clock.today) <= 0,
            )
            .reduce((acc, m) => acc.subtract(Money.parse(m.amount, currency)), Money.zero(currency));
      const standing = isOpen
        ? null
        : computeStatementStanding({
            figures: current,
            reported: record
              ? { billedBalance: record.reportedBilledBalance, minimumDue: record.reportedMinimumDue }
              : null,
            minimumRule: account.minimumRule,
            paymentsAfterClose,
            today: clock.today,
            dueDate: cycle.dueDate,
          });
      return {
        cycle,
        open: isOpen,
        record,
        current,
        issued: record ? figuresFromRecord(record, currency) : null,
        standing,
        status: isOpen ? 'OPEN' : (standing as StatementStanding).status,
        paymentsAfterClose,
      };
    });
    return {
      account,
      currency,
      balance,
      pendingOut,
      used: creditUsed({ presentedBalance: balance, pendingOut }),
      cycles: views,
      plans,
    };
  }

  async loadViews(card: CreditCard, clock: CardClock, cycles?: number): Promise<AccountView[]> {
    const state = card.snapshot;
    const records = await this.deps.statements.listForAccounts(
      card.workspaceId,
      state.accounts.map((a) => a.id),
    );
    const views: AccountView[] = [];
    for (const a of state.accounts) {
      views.push(await this.loadAccountView(card, a, clock, { records, ...(cycles ? { cycles } : {}) }));
    }
    return views;
  }

  // ───────────────────────────────────────────── utilización

  async utilizationScopes(
    card: CreditCard,
    views: readonly AccountView[],
    clock: CardClock,
  ): Promise<UtilizationScope[]> {
    const state = card.snapshot;
    if (state.limitMode === 'SEPARATE') {
      return views.flatMap((v): UtilizationScope[] => {
        if (v.account.creditLimit === null) return [];
        const limit = Money.parse(v.account.creditLimit, v.currency);
        return [
          {
            scopeKey: v.account.id,
            scope: 'ACCOUNT',
            accountId: v.account.accountId,
            limit,
            utilization: computeUtilization({ limit, used: v.used }),
            used: v.used,
            missingRates: [],
            ratesUsed: [],
          },
        ];
      });
    }
    const shared = state.sharedLimit;
    if (!shared) return [];
    const target = makeCurrency(shared.currency, shared.scale);
    const limit = Money.parse(shared.amount, target);
    const flows = views.map((v) => ({ date: clock.today.toString(), amount: v.used }));
    const rates = await FlowValuation.resolveRates<ResolvedRateDto>({
      flows,
      target,
      timeZone: clock.timeZone,
      now: this.deps.clock.now(),
      windowDays: this.deps.settings.rateValidityWindowDays,
      resolve: async ({ requests, windowDays }) => {
        const found = await this.deps.rates.resolveValuationRates({
          workspaceId: card.workspaceId,
          requests,
          windowDays,
        });
        return found.map((r: ValuationRateDto | null) =>
          r ? { exact: r.exact, resolved: r.resolved } : null,
        );
      },
      keyOf: rateKey,
    });
    const collector = rates.collector();
    const consolidated = FlowValuation.consolidate(flows, target, collector.rateFor);
    if (!consolidated.complete) {
      return [
        {
          scopeKey: 'SHARED',
          scope: 'SHARED',
          accountId: null,
          limit,
          utilization: null,
          used: null,
          missingRates: consolidated.unconverted.map((m) => m.currency.code),
          ratesUsed: collector.used(),
        },
      ];
    }
    const used = present(consolidated.total, target);
    return [
      {
        scopeKey: 'SHARED',
        scope: 'SHARED',
        accountId: null,
        limit,
        utilization: computeUtilization({ limit, used, usedExact: consolidated.total }),
        used,
        missingRates: [],
        ratesUsed: collector.used(),
      },
    ];
  }

  /**
   * Evalúa los umbrales de utilización (decisión 11) y publica a lo sumo un hecho por ámbito. Con `silent` solo
   * inicializa los estados (alta de la tarjeta). Devuelve cuántos hechos publicó (cada uno sube la versión de la tarjeta).
   */
  async evaluateUtilization(
    card: CreditCard,
    views: readonly AccountView[],
    clock: CardClock,
    options: { readonly silent?: boolean } = {},
  ): Promise<number> {
    const { deps } = this;
    const state = card.snapshot;
    const scopes = await this.utilizationScopes(card, views, clock);
    const stored = await deps.utilization.states(card.id);
    const thresholds = state.utilizationThresholds;
    let published = 0;
    for (const scope of scopes) {
      const percent = scope.utilization?.percent ?? null;
      const existing = stored.filter((s) => s.scopeKey === scope.scopeKey);
      const have = new Map(existing.map((s) => [s.threshold, s] as const));
      let current: ThresholdState[];
      if (options.silent) {
        current = initialThresholdStates(thresholds, percent);
      } else {
        current = thresholds.map((t) => {
          const found = have.get(t);
          return found
            ? { threshold: t, armed: found.armed, crossingNo: found.crossingNo }
            : { threshold: t, armed: true, crossingNo: 0 };
        });
      }
      const result = options.silent
        ? { states: current, crossings: [], event: null }
        : evaluateThresholds(current, percent);
      await deps.utilization.upsert(card.workspaceId, card.id, scope.scopeKey, result.states);
      if (result.event && scope.utilization && scope.used) {
        card.touch(['utilization'], clock.at);
        const eventId = deps.ids.next();
        const u = scope.utilization;
        const payload: CreditUtilizationThresholdReachedV1 = {
          workspaceId: card.workspaceId,
          cardId: card.id,
          cardName: state.name,
          scope: scope.scope,
          accountId: scope.accountId,
          limit: scope.limit.toJSON(),
          used: scope.used.toJSON(),
          utilization: u.display,
          threshold: result.event.threshold,
          alsoCrossed: result.event.alsoCrossed,
          crossingNo: result.event.crossingNo,
          crossedAt: clock.at,
        };
        await this.publish(card, DEBT_EVENTS.creditUtilizationThresholdReached, payload, eventId, clock.at);
        for (const c of result.crossings) {
          await deps.utilization.insertCrossing({
            workspaceId: card.workspaceId,
            cardId: card.id,
            scopeKey: scope.scopeKey,
            threshold: c.threshold,
            crossingNo: c.crossingNo,
            utilization: u.percent.toFixed(4),
            crossedAt: clock.at,
            eventId: c.threshold === result.event.threshold ? eventId : null,
          });
        }
        published += 1;
      }
    }
    await deps.utilization.prune(
      card.workspaceId,
      card.id,
      scopes.flatMap((s) => thresholds.map((t) => ({ scopeKey: s.scopeKey, threshold: t }))),
    );
    return published;
  }

  // ───────────────────────────────────────────── eventos

  async publish(
    card: CreditCard,
    kind: { readonly eventType: string; readonly eventVersion: number },
    payload: object,
    eventId: string,
    at: string,
  ): Promise<void> {
    await this.deps.outbox.append({
      eventId,
      eventType: kind.eventType,
      eventVersion: kind.eventVersion,
      occurredAt: at,
      workspaceId: card.workspaceId,
      aggregateType: CARD_AGGREGATE,
      aggregateId: card.id,
      aggregateVersion: card.version,
      payload,
    });
  }

  // ───────────────────────────────────────────── emisión y recordatorios

  /** Emite el estado de cuenta de un ciclo cerrado (una sola vez); devuelve `true` si lo insertó. */
  async issueCycle(
    card: CreditCard,
    view: AccountView,
    cycleView: CycleView,
    clock: CardClock,
  ): Promise<boolean> {
    const { deps } = this;
    if (cycleView.open || cycleView.record) return false;
    const f = cycleView.current;
    const record: StatementRecord = {
      id: deps.ids.next(),
      workspaceId: card.workspaceId,
      cardAccountId: view.account.id,
      cycleStart: cycleView.cycle.start.toString(),
      closingDate: cycleView.cycle.closing.toString(),
      dueDate: cycleView.cycle.dueDate.toString(),
      nominalDueDate: cycleView.cycle.nominalDue.toString(),
      currency: view.currency.code,
      previousBalance: f.previousBalance.toFixed(),
      purchases: f.purchases.toFixed(),
      refunds: f.refunds.toFixed(),
      payments: f.payments.toFixed(),
      otherNet: f.otherNet.toFixed(),
      closingBalance: f.closingBalance.toFixed(),
      unbilledInstallments: f.unbilledInstallments.toFixed(),
      billedBalance: f.billedBalance.toFixed(),
      minimumDue: f.minimumDue.toFixed(),
      reportedBilledBalance: null,
      reportedMinimumDue: null,
      status: (cycleView.standing as StatementStanding).status,
      issuedAt: clock.at,
      eventId: null,
      version: 1,
    };
    // Un cálculo que no cuadra no se esconde: se emite igual y la vista marca `consistent = false`.
    card.touch(['statement'], clock.at);
    const eventId = deps.ids.next();
    if (!(await deps.statements.insertIfAbsent({ ...record, eventId }))) return false;
    const payload: CardStatementIssuedV1 = {
      workspaceId: card.workspaceId,
      cardId: card.id,
      cardName: card.snapshot.name,
      cardAccountId: view.account.id,
      accountId: view.account.accountId,
      currency: view.currency.code,
      statementId: record.id,
      cycleStart: record.cycleStart,
      closingDate: record.closingDate,
      dueDate: record.dueDate,
      previousBalance: f.previousBalance.toJSON(),
      purchases: f.purchases.toJSON(),
      refunds: f.refunds.toJSON(),
      payments: f.payments.toJSON(),
      otherNet: f.otherNet.toJSON(),
      closingBalance: f.closingBalance.toJSON(),
      unbilledInstallments: f.unbilledInstallments.toJSON(),
      billedBalance: f.billedBalance.toJSON(),
      minimumDue: f.minimumDue.toJSON(),
      noInterestPayment: f.noInterestPayment.toJSON(),
    };
    await this.publish(card, DEBT_EVENTS.cardStatementIssued, payload, eventId, clock.at);
    await deps.audit.append({
      workspaceId: card.workspaceId,
      action: 'debt.card_statement.issued',
      aggregateType: 'CardStatement',
      aggregateId: record.id,
      aggregateVersion: 1,
      changes: [
        { field: 'cardAccountId', before: null, after: view.account.id },
        { field: 'closingDate', before: null, after: record.closingDate },
        { field: 'dueDate', before: null, after: record.dueDate },
        { field: 'billedBalance', before: null, after: f.billedBalance.toJSON() },
        { field: 'minimumDue', before: null, after: f.minimumDue.toJSON() },
      ],
    });
    return true;
  }

  /** Publica el recordatorio de vencimiento de un estado emitido si corresponde (una vez por cuenta y cierre). */
  async remindCycle(
    card: CreditCard,
    view: AccountView,
    cycleView: CycleView,
    clock: CardClock,
  ): Promise<boolean> {
    const { deps } = this;
    const { record, standing, cycle } = cycleView;
    if (!record || !standing || cycleView.open) return false;
    if (!standing.remainingNoInterest.isPositive()) return false;
    const days = card.snapshot.reminderDays;
    if (clock.today.compare(cycle.dueDate) > 0) return false;
    if (clock.today.compare(cycle.dueDate.plusDays(-days)) < 0) return false;
    const eventId = deps.ids.next();
    const inserted = await deps.reminders.insertIfAbsent({
      workspaceId: card.workspaceId,
      cardAccountId: view.account.id,
      closingDate: record.closingDate,
      dueDate: record.dueDate,
      emittedAt: clock.at,
      eventId,
    });
    if (!inserted) return false;
    card.touch(['reminder'], clock.at);
    const payload: CardPaymentDueV1 = {
      workspaceId: card.workspaceId,
      cardId: card.id,
      cardName: card.snapshot.name,
      cardAccountId: view.account.id,
      accountId: view.account.accountId,
      currency: view.currency.code,
      statementId: record.id,
      closingDate: record.closingDate,
      dueDate: record.dueDate,
      daysBefore: cycle.dueDate.toEpochDay() - clock.today.toEpochDay(),
      remainingNoInterest: standing.remainingNoInterest.toJSON(),
      remainingMinimum: standing.remainingMinimum.toJSON(),
      paymentPlanDefinitionId: view.account.paymentPlan?.definitionId ?? null,
    };
    await this.publish(card, DEBT_EVENTS.cardPaymentDue, payload, eventId, clock.at);
    return true;
  }

  // ───────────────────────────────────────────── plan de pago

  private cycleExpectation(
    view: AccountView,
    cycle: CardCycle,
    clock: CardClock,
    policy: 'NO_INTEREST' | 'MINIMUM',
  ): PlanExpectation | 'UNKNOWN' {
    const rule = view.account.minimumRule;
    const open = view.cycles.at(-1) as CycleView;
    if (cycle.closing.compare(clock.today) < 0) {
      const found = view.cycles.find((c) => !c.open && c.cycle.closing.equals(cycle.closing));
      if (!found?.standing) return 'UNKNOWN';
      return expectationForIssued({ policy, standing: found.standing });
    }
    if (cycle.closing.equals(open.cycle.closing)) {
      const dueIssuedRemaining = view.cycles
        .filter((c) => !c.open && c.standing && c.cycle.dueDate.compare(clock.today) >= 0)
        .reduce(
          (acc, c) => acc.add((c.standing as StatementStanding).remainingNoInterest),
          Money.zero(view.currency),
        );
      return expectationForOpen({
        policy,
        minimumRule: rule,
        presentedBalance: view.balance,
        dueIssuedRemaining,
        unbilledAfter: CardInstallmentPlan.unbilledCapital(view.plans, open.cycle.closing, view.currency),
      });
    }
    return expectationForFuture({
      policy,
      minimumRule: rule,
      installmentsTotal: CardInstallmentPlan.totalBilledAt(view.plans, cycle.closing, view.currency),
    });
  }

  /**
   * Mantiene el monto esperado de las ocurrencias no resueltas del plan de pago de una cuenta (decisión 7). Solo
   * escribe si cambia; nunca sobre ocurrencias resueltas ni sobre las que el usuario editó antes de la emisión.
   */
  async syncPlan(card: CreditCard, view: AccountView, clock: CardClock, userId: string): Promise<number> {
    const { deps } = this;
    const plan = view.account.paymentPlan;
    if (!plan || card.status !== 'ACTIVE') return 0;
    const occurrences = await deps.recurring.listOccurrences({
      workspaceId: card.workspaceId,
      definitionId: plan.definitionId,
      from: clock.today.plusDays(-180).toString(),
      to: clock.today.plusDays(deps.settings.planHorizonDays + 35).toString(),
    });
    let changes = 0;
    for (const occ of occurrences) {
      if (!UNRESOLVED.has(occ.status)) continue;
      const cycles = card.calendar.cyclesDueOn(LocalDate.parse(occ.key));
      if (cycles.length === 0) continue;
      const parts = cycles.map((c) => this.cycleExpectation(view, c, clock, plan.policy));
      if (parts.includes('UNKNOWN')) continue;
      const list = parts as PlanExpectation[];
      const allClosed = cycles.every((c) => c.closing.compare(clock.today) < 0);
      if (occ.editedByUser && !allClosed) continue;
      let wanted: PlanExpectation;
      const amounts = list.filter((e): e is Extract<PlanExpectation, { amount: Money }> => 'amount' in e);
      if (amounts.length > 0) {
        const sum = amounts.reduce((acc, e) => acc.add(e.amount), Money.zero(view.currency));
        wanted = {
          type: amounts.some((e) => e.type === 'ESTIMATED') ? 'ESTIMATED' : 'FIXED',
          amount: sum,
        };
      } else if (list.every((e) => e.type === 'SKIP')) {
        const reasons = list.map((e) => (e as Extract<PlanExpectation, { type: 'SKIP' }>).reason);
        wanted = {
          type: 'SKIP',
          reason: reasons.includes('STATEMENT_PAID') ? 'STATEMENT_PAID' : 'NOTHING_BILLED',
        };
      } else {
        wanted = { type: 'NONE' };
      }
      if (wanted.type === 'SKIP') {
        await deps.recurring.skip({
          workspaceId: card.workspaceId,
          userId,
          definitionId: plan.definitionId,
          key: occ.key,
          reason: wanted.reason,
        });
        changes += 1;
        continue;
      }
      if (
        sameExpectation(wanted, { type: occ.expected.type, amount: occ.expected.amount }, view.currency.scale)
      )
        continue;
      await deps.recurring.setExpected({
        workspaceId: card.workspaceId,
        userId,
        definitionId: plan.definitionId,
        key: occ.key,
        expectation:
          wanted.type === 'NONE' ? { type: 'NONE' } : { type: wanted.type, amount: wanted.amount.toFixed() },
      });
      changes += 1;
    }
    return changes;
  }

  /** Paga cada cifra monetaria de un estado emitido como `{amount, currency}` para las vistas. */
  static moneyJson(m: Money): { amount: string; currency: string } {
    return m.toJSON();
  }

  /** Utilidad: porcentaje de crédito usado de un ámbito como texto de 2 decimales, o `null`. */
  static percentText(u: Utilization | null): string | null {
    return u ? u.display : null;
  }
}

export { dec };
