import { addDays } from './dataset/calendar.js';
import {
  toDecimal,
  type AccountKey,
  type CategoryRef,
  type CounterpartyKey,
  type DemoMoney,
} from './dataset/demo-plan.js';
import type {
  CardKey,
  DefinitionKey,
  GoalKey,
  LoanKey,
  ModuleOp,
  OccurrenceOp,
  OccurrenceTarget,
  SubscriptionKey,
} from './dataset/module-ops.js';
import type { financeRuntimes } from '../identity/identity-wiring.js';

type Runtimes = ReturnType<typeof financeRuntimes>;

const dto = (m: DemoMoney) => ({ amount: toDecimal(m), currency: m.currency });

export class DemoModuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DemoModuleError';
  }
}

export interface ModuleExecutorContext {
  readonly r: Runtimes;
  readonly ws: string;
  readonly user: string;
  readonly account: (key: AccountKey) => string;
  readonly category: (ref: CategoryRef) => string;
  readonly counterparties: ReadonlyMap<string, string>;
  readonly institutions: ReadonlyMap<string, string>;
  /** Transacciones registradas por clave del plan (para vincular, comprar en cuotas, etc.). */
  readonly recorded: ReadonlyMap<string, { id: string; version: number }>;
  /** Cuentas de los préstamos que crea DEBT (se completan al registrarlos). */
  readonly loanAccounts: Map<LoanKey, string>;
}

/**
 * Ejecutor de las operaciones de módulo del dataset Demo v2 (openspec add-phase-4-demo-data, design.md decisión 2):
 * cada operación llama al caso de uso PÚBLICO del contexto dueño (COMMITMENTS, DEBT, GOALS, NOTIFICATIONS) a través de
 * `financeRuntimes`, dentro de la unidad de trabajo del lote que abre el cargador y con el reloj simulado ya
 * posicionado. Nunca escribe tablas ni usa repositorios.
 */
export class DemoModuleExecutor {
  private readonly subscriptions = new Map<SubscriptionKey, { id: string; definitionId: string }>();
  private readonly definitions = new Map<DefinitionKey, string>();
  private readonly cards = new Map<CardKey, { id: string; payments: Map<AccountKey, string> }>();
  private readonly loans = new Map<LoanKey, string>();
  private readonly goals = new Map<GoalKey, string>();
  private readonly goalDefinitions = new Map<GoalKey, string>();

  constructor(private readonly ctx: ModuleExecutorContext) {}

  /** Identificadores de lo creado por el plan (para la verificación final). */
  idsOf(): {
    readonly cards: ReadonlyMap<CardKey, string>;
    readonly loans: ReadonlyMap<LoanKey, string>;
    readonly goals: ReadonlyMap<GoalKey, string>;
  } {
    return {
      cards: new Map([...this.cards].map(([k, v]) => [k, v.id])),
      loans: this.loans,
      goals: this.goals,
    };
  }

  async apply(op: ModuleOp): Promise<void> {
    switch (op.op) {
      case 'subscription':
        return this.createSubscription(op);
      case 'subscriptionPrice': {
        const sub = this.subscription(op.sub);
        await this.ctx.r.commitments.subscriptions.changePrice({
          workspaceId: this.ctx.ws,
          userId: this.ctx.user,
          subscriptionId: sub.id,
          expectedVersion: await this.subscriptionVersion(sub.id),
          price: dto(op.price),
          effectiveFrom: op.effectiveFrom,
        });
        return;
      }
      case 'subscriptionStatus': {
        const sub = this.subscription(op.sub);
        const base = {
          workspaceId: this.ctx.ws,
          userId: this.ctx.user,
          subscriptionId: sub.id,
          expectedVersion: await this.subscriptionVersion(sub.id),
        };
        if (op.action === 'pause') await this.ctx.r.commitments.subscriptions.pause(base);
        else
          await this.ctx.r.commitments.subscriptions.cancel({
            ...base,
            ...(op.reason ? { reason: op.reason } : {}),
          });
        return;
      }
      case 'recurring':
        return this.createDefinition(op);
      case 'occurrence':
        return this.resolveOccurrence(op);
      case 'card':
        return this.registerCard(op);
      case 'installments': {
        const card = this.card(op.card);
        const purchase = this.ctx.recorded.get(op.purchase);
        if (!purchase) throw new DemoModuleError('DEMO_LOAD_FAILED', `unknown purchase ${op.purchase}`);
        await this.ctx.r.cards.installments.create({
          workspaceId: this.ctx.ws,
          userId: this.ctx.user,
          cardId: card.id,
          purchaseTransactionId: purchase.id,
          installmentCount: op.count,
        });
        return;
      }
      case 'loan':
        return this.registerLoan(op);
      case 'loanPayment': {
        const { payment } = await this.ctx.r.debt.payments.record({
          workspaceId: this.ctx.ws,
          userId: this.ctx.user,
          loanId: this.loan(op.loan),
          amount: dto(op.total),
          businessDate: op.date,
          accountId: this.ctx.account(op.account),
        });
        const expected = `${toDecimal(op.principal)}/${toDecimal(op.interest)}`;
        if (`${payment.principal}/${payment.interest}` !== expected) {
          throw new DemoModuleError(
            'DEMO_GOLDEN_MISMATCH',
            `${op.loan} installment ${op.installmentNo}: expected ${expected}, got ${payment.principal}/${payment.interest}`,
          );
        }
        return;
      }
      case 'loanPrepayment':
        await this.ctx.r.debt.amortization.recordPrepayment({
          workspaceId: this.ctx.ws,
          userId: this.ctx.user,
          loanId: this.loan(op.loan),
          amount: dto(op.amount),
          businessDate: op.date,
          option: 'REDUCE_TERM',
          accountId: this.ctx.account(op.account),
        });
        return;
      case 'goal':
        return this.createGoal(op);
      case 'goalPlan':
        return this.setGoalPlan(op);
      case 'goalMovement':
        await this.ctx.r.goals.movements.contribute({
          workspaceId: this.ctx.ws,
          userId: this.ctx.user,
          goalId: this.goal(op.goal),
          fund: 'EARMARK',
          amount: dto(op.amount),
          businessDate: op.date,
          sourceAccountId: this.ctx.account(op.account),
        });
        return;
      case 'notificationPrefs':
        return this.silenceEmail();
      case 'tick':
        return this.tick(op.runner);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────── suscripciones y recurrentes

  private subscription(key: SubscriptionKey) {
    const found = this.subscriptions.get(key);
    if (!found) throw new DemoModuleError('DEMO_LOAD_FAILED', `unknown subscription ${key}`);
    return found;
  }

  private async subscriptionVersion(id: string): Promise<number> {
    return (await this.ctx.r.commitments.subscriptionQueries.get(this.ctx.ws, id)).version;
  }

  private async createSubscription(op: Extract<ModuleOp, { op: 'subscription' }>): Promise<void> {
    const { r, ws, user } = this.ctx;
    const created = await r.commitments.subscriptions.create({
      workspaceId: ws,
      userId: user,
      counterpartyId: this.counterparty(op.counterparty),
      name: op.name,
      price: dto(op.price),
      billingCycle: { cadence: op.cadence },
      firstRenewalOn: op.firstRenewalOn,
      paymentAccountId: this.ctx.account(op.account),
      materialization: { mode: 'PENDING_APPROVAL' },
      categoryId: this.ctx.category(op.category),
      ...(op.trialEndsOn ? { trialEndsOn: op.trialEndsOn } : {}),
    });
    this.subscriptions.set(op.key, { id: created.id, definitionId: created.definitionId });
  }

  private counterparty(key: CounterpartyKey): string {
    const id = this.ctx.counterparties.get(key);
    if (!id) throw new DemoModuleError('DEMO_LOAD_FAILED', `unknown counterparty ${key}`);
    return id;
  }

  private async createDefinition(op: Extract<ModuleOp, { op: 'recurring' }>): Promise<void> {
    const { r, ws, user } = this.ctx;
    const created = await r.commitments.definitions.create({
      workspaceId: ws,
      userId: user,
      name: op.name,
      kind: op.kind,
      template: {
        accountId: this.ctx.account(op.account),
        ...(op.toAccount ? { toAccountId: this.ctx.account(op.toAccount) } : {}),
        amount: { type: op.amountType, amount: dto(op.amount) },
        ...(op.category ? { categoryId: this.ctx.category(op.category) } : {}),
        ...(op.counterparty ? { counterpartyId: this.counterparty(op.counterparty) } : {}),
        schedule: {
          cadence: op.cadence,
          monthDays: op.monthDays,
          startDate: op.startDate,
          weekendAdjustment: op.weekendAdjustment,
        },
        materialization: {
          mode: op.mode,
          ...(op.mode === 'AUTO_CREATE' ? { autoCreateStatus: 'POSTED' } : {}),
        },
      },
    });
    this.definitions.set(op.key, created.id);
  }

  private definitionOf(target: OccurrenceTarget): string {
    let id: string | undefined;
    if (target.type === 'subscription') id = this.subscriptions.get(target.key)?.definitionId;
    else if (target.type === 'definition') id = this.definitions.get(target.key);
    else if (target.type === 'goalPlan') id = this.goalDefinitions.get(target.key);
    else id = this.cards.get(target.key)?.payments.get(target.account);
    if (!id)
      throw new DemoModuleError('DEMO_LOAD_FAILED', `no recurring definition for ${JSON.stringify(target)}`);
    return id;
  }

  private async findOccurrence(op: OccurrenceOp) {
    const { r, ws } = this.ctx;
    const rows = await r.commitments.queries.listOccurrences(ws, {
      definitionId: this.definitionOf(op.target),
      from: addDays(op.occurrenceDate, -5),
      to: addDays(op.occurrenceDate, 5),
      limit: 20,
    });
    const found = rows.find((o) => o.occurrenceDate === op.occurrenceDate);
    if (!found) {
      throw new DemoModuleError(
        'DEMO_LOAD_FAILED',
        `occurrence ${JSON.stringify(op.target)} of ${op.occurrenceDate} not found`,
      );
    }
    return found;
  }

  private async resolveOccurrence(op: OccurrenceOp): Promise<void> {
    const { r, ws, user } = this.ctx;
    const occurrence = await this.findOccurrence(op);
    switch (op.action) {
      case 'leave':
        return;
      case 'auto':
        // Lo creó el runner de generación con el reloj simulado; el plan solo comprueba que quedó resuelta.
        if (occurrence.status !== 'MATERIALIZED') {
          throw new DemoModuleError(
            'DEMO_LOAD_FAILED',
            `automatic occurrence ${JSON.stringify(op.target)} of ${op.occurrenceDate} is ${occurrence.status}`,
          );
        }
        return;
      case 'link': {
        const tx = op.linkTo ? this.ctx.recorded.get(op.linkTo) : undefined;
        if (!tx) throw new DemoModuleError('DEMO_LOAD_FAILED', `unknown transaction ${String(op.linkTo)}`);
        await r.commitments.occurrences.link({
          workspaceId: ws,
          userId: user,
          occurrenceId: occurrence.id,
          transactionId: tx.id,
          matchedBy: 'USER_LINK',
        });
        return;
      }
      case 'approve': {
        if (op.expectedFromPlan) {
          const expected = occurrence.expected.amount?.amount;
          if (expected !== toDecimal(op.expectedFromPlan)) {
            throw new DemoModuleError(
              'DEMO_GOLDEN_MISMATCH',
              `${JSON.stringify(op.target)} of ${op.occurrenceDate}: the plan computed ${toDecimal(op.expectedFromPlan)}, the engine expects ${String(expected)}`,
            );
          }
        }
        const { transactionId } = await r.commitments.occurrences.materialize({
          workspaceId: ws,
          userId: user,
          occurrenceId: occurrence.id,
          businessDate: op.date,
          ...(op.amount ? { amount: dto(op.amount) } : {}),
        });
        if (op.target.type === 'goalPlan') {
          // El aporte recurrente se registra como movimiento de la meta en esta misma unidad de trabajo: la meta ya
          // está al día en `READY` y el consumidor asíncrono, que haría lo mismo, lo encuentra registrado (sin
          // sugerencias de aporte duplicadas por la carrera entre consumidores de GOALS).
          await r.goals.movements.link({
            workspaceId: ws,
            userId: user,
            goalId: this.goal(op.target.key),
            transactionId,
            origin: 'RECURRING',
          });
        }
        return;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────── tarjetas y préstamos

  private card(key: CardKey) {
    const found = this.cards.get(key);
    if (!found) throw new DemoModuleError('DEMO_LOAD_FAILED', `unknown card ${key}`);
    return found;
  }

  private async registerCard(op: Extract<ModuleOp, { op: 'card' }>): Promise<void> {
    const { r, ws, user } = this.ctx;
    const created = await r.cards.cards.register({
      workspaceId: ws,
      userId: user,
      name: op.name,
      accounts: op.accounts.map((a) => ({
        accountId: this.ctx.account(a.account),
        ...(a.limit ? { creditLimit: { amount: toDecimal(a.limit) } } : {}),
        minimumRule: { type: 'PERCENT', percent: a.minPercent, floor: toDecimal(a.minFloor) },
        ...(a.payment
          ? {
              paymentPlan: {
                sourceAccountId: this.ctx.account(a.payment.from),
                policy: a.payment.policy,
                materialization: { mode: 'PENDING_APPROVAL' },
              },
            }
          : {}),
      })),
      ...(op.sharedLimit ? { limitMode: 'SHARED', sharedLimit: dto(op.sharedLimit) } : {}),
      statementDay: op.statementDay,
      dueDay: op.dueDay,
      dueWeekendAdjustment: 'NONE',
    });
    const view = await r.cards.queries.get(ws, created.id);
    const payments = new Map<AccountKey, string>();
    for (const [i, a] of op.accounts.entries()) {
      const plan = view.accounts[i]?.paymentPlan;
      if (plan) payments.set(a.account, plan.definitionId);
    }
    this.cards.set(op.key, { id: created.id, payments });
  }

  private loan(key: LoanKey): string {
    const id = this.loans.get(key);
    if (!id) throw new DemoModuleError('DEMO_LOAD_FAILED', `unknown loan ${key}`);
    return id;
  }

  private async registerLoan(op: Extract<ModuleOp, { op: 'loan' }>): Promise<void> {
    const { r, ws, user } = this.ctx;
    const institution = op.institution ? this.ctx.institutions.get(op.institution) : undefined;
    const registered = await r.debt.loans.register({
      workspaceId: ws,
      userId: user,
      name: op.name,
      principal: dto(op.principal),
      annualRate: op.annualRate,
      termInstallments: op.term,
      method: op.method,
      disbursementDate: op.disbursementDate,
      firstDueDate: op.firstDueDate,
      origin: 'NEW',
      account: { create: { name: op.name, ...(institution ? { institutionId: institution } : {}) } },
      disbursementAccountId: this.ctx.account(op.account),
      paymentAccountId: this.ctx.account(op.account),
      lenderCounterpartyId: this.counterparty(op.lender),
      disburseNow: true,
    });
    this.loans.set(op.key, registered.id);
    this.ctx.loanAccounts.set(op.key, registered.accountId);
    // Identificador ficticio `DEMO-LOAN-000N` en las notas de la cuenta que DEBT creó (caso de uso público de ACCOUNTS).
    const created = await r.accounts.accounts.getAccount(ws, registered.accountId);
    await r.accounts.accounts.updateAccount(ws, registered.accountId, created.account.version, {
      notes: op.reference,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────── metas

  private goal(key: GoalKey): string {
    const id = this.goals.get(key);
    if (!id) throw new DemoModuleError('DEMO_LOAD_FAILED', `unknown goal ${key}`);
    return id;
  }

  private async createGoal(op: Extract<ModuleOp, { op: 'goal' }>): Promise<void> {
    const { r, ws, user } = this.ctx;
    const goal = await r.goals.goals.create({
      workspaceId: ws,
      userId: user,
      name: op.name,
      type: op.type,
      target: dto(op.target),
      startDate: op.startDate,
      targetDate: op.targetDate,
      linkedAccountIds: op.linked.map((a) => this.ctx.account(a)),
      priority: op.priority,
    });
    this.goals.set(op.key, goal.id);
  }

  private async setGoalPlan(op: Extract<ModuleOp, { op: 'goalPlan' }>): Promise<void> {
    const { r, ws, user } = this.ctx;
    const goalId = this.goal(op.goal);
    const current = await r.goals.queries.get(ws, goalId);
    await r.goals.plans.set({
      workspaceId: ws,
      userId: user,
      goalId,
      expectedVersion: current.version,
      monthlyAmount: dto(op.monthly),
      fund: op.fund,
      sourceAccountId: this.ctx.account(op.source),
      destinationAccountId: op.destination ? this.ctx.account(op.destination) : null,
      dayOfMonth: op.dayOfMonth,
      automation: op.automation,
      ...(op.automation === 'RECURRING' ? { materialization: { mode: 'PENDING_APPROVAL' as const } } : {}),
    });
    if (op.automation === 'RECURRING') {
      const after = await r.goals.queries.get(ws, goalId);
      if (after.plan?.definitionId) this.goalDefinitions.set(op.goal, after.plan.definitionId);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────── notificaciones y ticks

  /** Apaga el canal email de todos los tipos para el usuario en el workspace demo (el in-app queda activo). */
  private async silenceEmail(): Promise<void> {
    const { r, ws, user } = this.ctx;
    const current = await r.notifications.preferences.get(ws, user);
    await r.notifications.preferences.update({
      workspaceId: ws,
      userId: user,
      expectedVersion: current.version,
      preferences: {
        types: current.types.map((t) => ({ type: t.type, inApp: t.inApp, email: false })),
        quietHours: current.quietHours,
        includeDetailsInEmail: current.includeDetailsInEmail,
      },
    });
  }

  /**
   * Runners de tiempo con el reloj simulado (decisión 3): generación de ocurrencias, trials y renovaciones,
   * estados de cuenta y evaluación de metas. Un elemento que falla aborta la carga (nunca READY parcial).
   */
  private async tick(runner: 'occurrences' | 'subscriptions' | 'cards' | 'goals'): Promise<void> {
    const { r, ws } = this.ctx;
    const failures: string[] = [];
    if (runner === 'occurrences') {
      const result = await r.commitments.generate.runWorkspace(ws);
      failures.push(...result.failed.map((f) => `${f.definitionId}: ${f.error}`));
    } else if (runner === 'subscriptions') {
      const result = await r.commitments.subscriptionDaily.runWorkspace(ws);
      failures.push(...result.failed.map((f) => `${f.subscriptionId}: ${f.error}`));
    } else if (runner === 'cards') {
      const result = await r.cards.daily.runWorkspace(ws);
      failures.push(...result.failed.map((f) => `${f.cardId}: ${f.error}`));
    } else {
      await r.goals.reactions.runDaily(ws);
    }
    if (failures.length > 0) {
      throw new DemoModuleError('DEMO_LOAD_FAILED', `tick ${runner} failed: ${failures.join('; ')}`);
    }
  }
}
