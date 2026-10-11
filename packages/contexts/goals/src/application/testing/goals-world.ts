import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditEntry, LifecycleStepInput } from '@pf/audit/contracts';
import type { ManagedOccurrenceDto, RecurringDefinitionPort } from '@pf/commitments/contracts';
import type { FxRateTypeDto, ValuationRateDto } from '@pf/fx/contracts';
import {
  DomainError,
  FixedClock,
  Instant,
  LocalDate,
  Money,
  currency as makeCurrency,
  dec,
  type Decimal,
} from '@pf/shared-kernel';
import {
  GOAL_MOVEMENT_NAMESPACE,
  type GoalTransferPort,
  type TransactionLinkDto,
  type TransactionLinkQuery,
} from '@pf/transactions/contracts';
import {
  SavingsGoal,
  type GoalFund,
  type GoalState,
  type GoalStatus,
  type MovementKind,
} from '../../domain/index.js';
import { GoalsService, type CreateGoalCommand } from '../goals.service.js';
import { GoalsQueries } from '../goals.queries.js';
import { MovementsService } from '../movements.service.js';
import { PlanService } from '../plan.service.js';
import type {
  AccountInfo,
  GoalFilter,
  GoalRepository,
  GoalsDeps,
  MaterializationRecord,
  MaterializationRepository,
  MovementRepository,
  MovementRow,
  PlanRecord,
  PlanRepository,
  ReservationStateRecord,
  ReservationStateRepository,
  SuggestionRecord,
  SuggestionRepository,
  SuggestionStatus,
  UnitOfWork,
} from '../ports/index.js';
import { GoalReactions, type DomainEventInput } from '../reactions.js';

/** Ids estables (formato UUID v7) de las cuentas del escenario "W1" de los casos TC-GOALS-SAVINGS-*. */
export const WS = '0190a000-0000-7000-8000-00000000a001';
export const EDITOR = '0190a000-0000-7000-8000-0000000b0001';
export const VIEWER = '0190a000-0000-7000-8000-0000000b0002';
export const BANK = '0190a000-0000-7000-8000-0000000acc01';
export const SAVINGS = '0190a000-0000-7000-8000-0000000acc02';
export const CASH = '0190a000-0000-7000-8000-0000000acc03';
export const USD_CASH = '0190a000-0000-7000-8000-0000000acc04';
export const CARD = '0190a000-0000-7000-8000-0000000acc05';

const SCALES: Readonly<Record<string, number>> = { BOB: 2, USD: 2, EUR: 2, USDT: 6 };
const ENABLED: ReadonlySet<string> = new Set(['BOB', 'USD', 'USDT']);
const POSTED_STATUSES: ReadonlySet<string> = new Set(['POSTED', 'CLEARED', 'RECONCILED']);

export interface FakeTransaction extends TransactionLinkDto {
  readonly description: string;
}

export interface Recorded {
  readonly entry: AuditEntry;
  readonly steps: readonly LifecycleStepInput[];
}

export interface CapturedEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: Record<string, unknown>;
}

export interface RecurringCall {
  readonly method: 'createManaged' | 'reviseManaged' | 'pauseManaged' | 'resumeManaged' | 'end';
  readonly input: Record<string, unknown>;
}

export interface FakeDefinition {
  readonly id: string;
  readonly managedRef: string;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED';
  input: Record<string, unknown>;
}

interface SeedRate {
  readonly value: string;
  readonly asOf: string;
  readonly rateType: FxRateTypeDto;
  readonly sourceLabel: string | null;
  readonly attributionText: string | null;
}

interface Snapshot {
  goals: Map<string, GoalState>;
  movements: MovementRow[];
  plans: Map<string, PlanRecord>;
  states: Map<string, ReservationStateRecord>;
  materializations: Map<string, MaterializationRecord>;
  suggestions: SuggestionRecord[];
  transactions: Map<string, FakeTransaction>;
  balances: Map<string, string>;
  events: CapturedEvent[];
  trail: Recorded[];
  definitions: Map<string, { status: FakeDefinition['status']; input: Record<string, unknown> }>;
  recurringCalls: RecurringCall[];
  transferCalls: Record<string, unknown>[];
}

const iso = (m: Instant): string => m.toString();

/**
 * Mundo en memoria de GOALS para las pruebas de aplicación (mismo estilo que `CardWorld` y `InMemoryCommitments`):
 * dobles de TODOS los puertos de `GoalsDeps` con la semántica de `infrastructure/pg-goals.ts` (claves únicas parciales
 * de aporte y retiro por transacción, `reverses_id` único, bloqueo de metas en orden de id), cuentas del escenario "W1",
 * un ledger mínimo (saldos contables que cambian al registrar transferencias), el puerto de transferencias de metas,
 * las transacciones sembrables, el puerto de definiciones recurrentes y una unidad de trabajo que revierte todo el
 * estado si la función falla (atomicidad).
 */
export class GoalsWorld {
  readonly clock = new FixedClock(Instant.parse('2026-10-15T14:00:00.000Z'));
  readonly workspaceId = WS;
  timeZone = 'America/La_Paz';
  startDay = 1;

  // ───────────────────────────────────────────── estado (se restaura si una unidad de trabajo falla)
  goalStore = new Map<string, GoalState>();
  movementStore: MovementRow[] = [];
  planStore = new Map<string, PlanRecord>();
  stateStore = new Map<string, ReservationStateRecord>();
  materializationStore = new Map<string, MaterializationRecord>();
  suggestionStore: SuggestionRecord[] = [];
  txStore = new Map<string, FakeTransaction>();
  balanceStore = new Map<string, string>();
  events: CapturedEvent[] = [];
  trail: Recorded[] = [];
  definitionStore = new Map<string, { status: FakeDefinition['status']; input: Record<string, unknown> }>();
  recurringCalls: RecurringCall[] = [];
  transferCalls: Record<string, unknown>[] = [];

  // ───────────────────────────────────────────── configuración y observaciones fuera de la transacción
  readonly accounts: AccountInfo[] = [
    account(BANK, 'Banco BOB', 'ASSET', 'BOB'),
    account(SAVINGS, 'Ahorro BOB', 'ASSET', 'BOB'),
    account(CASH, 'Efectivo BOB', 'ASSET', 'BOB'),
    account(USD_CASH, 'Caja USD', 'ASSET', 'USD'),
    account(CARD, 'Tarjeta X', 'LIABILITY', 'BOB'),
  ];
  /** Meses `YYYY-MM` cerrados: el puerto de transferencias rechaza con `PERIOD_CLOSED`. */
  readonly closedPeriods = new Set<string>();
  /** Fallos a inyectar: `outbox:<eventType>`, `audit:<action>` o `transfer`. */
  readonly failures = new Set<string>();
  /** Orden real en que `lockMany` bloqueó cada lote de metas. */
  readonly lockLog: string[][] = [];
  /** Intentos de registrar transferencias (no se revierten con la unidad de trabajo). */
  transferAttempts = 0;
  private readonly rateSeries = new Map<string, SeedRate[]>();
  private idCounter = 0;
  private txCounter = 0;
  private mutex: Promise<void> = Promise.resolve();
  private readonly nesting = new AsyncLocalStorage<true>();

  readonly deps: GoalsDeps;
  readonly service: GoalsService;
  readonly movements: MovementsService;
  readonly plans: PlanService;
  readonly queries: GoalsQueries;
  readonly reactions: GoalReactions;

  constructor(now?: string) {
    if (now) this.clock.set(Instant.parse(now));
    this.deps = this.compose();
    this.service = new GoalsService(this.deps);
    this.movements = new MovementsService(this.deps);
    this.plans = new PlanService(this.deps);
    this.queries = new GoalsQueries(this.deps);
    this.reactions = new GoalReactions(this.deps);
  }

  // ─────────────────────────────────────────────────────────────────────── helpers de la prueba

  nextId(): string {
    this.idCounter += 1;
    return `0190a000-0000-7000-8000-${String(this.idCounter).padStart(12, '0')}`;
  }

  setNow(isoInstant: string): void {
    this.clock.set(Instant.parse(isoInstant));
  }

  today(): string {
    return LocalDate.ofInstant(this.clock.now(), this.timeZone).toString();
  }

  accountName(id: string): string {
    return this.accounts.find((a) => a.accountId === id)?.name ?? id;
  }

  setAccountStatus(accountId: string, status: AccountInfo['status']): void {
    const i = this.accounts.findIndex((a) => a.accountId === accountId);
    const found = this.accounts[i];
    if (found) this.accounts[i] = { ...found, status };
  }

  setBalance(accountId: string, amount: string): void {
    this.balanceStore.set(accountId, amount);
  }

  balanceOf(accountId: string): string {
    const scale = SCALES[this.currencyOf(accountId)] ?? 2;
    return dec(this.balanceStore.get(accountId) ?? '0').toFixed(scale);
  }

  currencyOf(accountId: string): string {
    return this.accounts.find((a) => a.accountId === accountId)?.currency ?? 'BOB';
  }

  /** Crea una meta por el caso de uso real (`create`). */
  async createGoal(
    overrides: Partial<CreateGoalCommand> & Pick<CreateGoalCommand, 'name'>,
  ): Promise<SavingsGoal> {
    return this.service.create({
      workspaceId: WS,
      userId: EDITOR,
      type: 'CUSTOM',
      target: { amount: '1000.00', currency: 'BOB' },
      ...overrides,
    });
  }

  /** "Fondo de emergencia" (EMERGENCY_FUND, 15000.00 BOB, 2026-10-01 → 2027-03-31, vinculada a "Ahorro BOB", prioridad 1). */
  async emergencyFund(overrides: Partial<CreateGoalCommand> = {}): Promise<SavingsGoal> {
    return this.createGoal({
      name: 'Fondo de emergencia',
      type: 'EMERGENCY_FUND',
      target: { amount: '15000.00', currency: 'BOB' },
      startDate: '2026-10-01',
      targetDate: '2027-03-31',
      linkedAccountIds: [SAVINGS],
      priority: 1,
      ...overrides,
    });
  }

  /** "Laptop" (PURCHASE, 9000.00 BOB, sin fecha objetivo, sin cuentas vinculadas). */
  async laptop(overrides: Partial<CreateGoalCommand> = {}): Promise<SavingsGoal> {
    return this.createGoal({
      name: 'Laptop',
      type: 'PURCHASE',
      target: { amount: '9000.00', currency: 'BOB' },
      ...overrides,
    });
  }

  goalState(goalId: string): GoalState {
    const s = this.goalStore.get(goalId);
    if (!s) throw new Error(`no goal ${goalId}`);
    return s;
  }

  /** Ajusta el estado persistido de una meta (fixture: p. ej. `CANCELLED`). */
  patchGoal(goalId: string, patch: Partial<{ -readonly [K in keyof GoalState]: GoalState[K] }>): void {
    this.goalStore.set(goalId, { ...this.goalState(goalId), ...patch } as GoalState);
  }

  /**
   * Siembra un movimiento sin pasar por los servicios (fixture). `REAL` crea además su transferencia posteada
   * (`MANUAL`, mueve los saldos) salvo que se pase `transactionId`; `EARMARK` no toca el ledger.
   */
  seedMovement(input: {
    readonly goalId: string;
    readonly fund: GoalFund;
    readonly kind?: MovementKind;
    /** Firmado (aportes positivos, retiros negativos). */
    readonly amount: string;
    readonly accountId: string;
    readonly occurredOn?: string;
    readonly transactionId?: string;
    readonly transactionRevision?: number;
    readonly origin?: MovementRow['origin'];
  }): MovementRow {
    const currency = this.currencyOf(input.accountId);
    const money = Money.parse(input.amount, makeCurrency(currency, SCALES[currency] ?? 2));
    const kind: MovementKind = input.kind ?? (money.isNegative() ? 'WITHDRAWAL' : 'CONTRIBUTION');
    let transactionId = input.transactionId ?? null;
    let transactionRevision = input.transactionRevision ?? null;
    if (input.fund === 'REAL' && transactionId === null) {
      transactionId = this.seedTransfer({
        from: money.isNegative() ? input.accountId : BANK,
        to: money.isNegative() ? BANK : input.accountId,
        amount: money.abs().toFixed(),
        businessDate: input.occurredOn ?? this.today(),
        currency,
      });
      transactionRevision = 1;
    }
    const row: MovementRow = {
      id: this.nextId(),
      goalId: input.goalId,
      fund: input.fund,
      kind,
      amount: money,
      accountId: input.accountId,
      occurredOn: input.occurredOn ?? this.today(),
      transactionId: input.fund === 'REAL' ? transactionId : null,
      transactionRevision: input.fund === 'REAL' ? (transactionRevision ?? 1) : null,
      reversesId: null,
      reassignmentId: null,
      origin: input.origin ?? 'USER',
      note: null,
      recordedAt: iso(this.clock.now()),
      recordedBy: EDITOR,
    };
    this.movementStore.push(row);
    return row;
  }

  /** Siembra una transferencia; si está posteada mueve los saldos. Devuelve su id. */
  seedTransfer(input: {
    readonly from: string;
    readonly to: string;
    readonly amount: string;
    readonly status?: string;
    readonly businessDate?: string;
    readonly source?: string;
    readonly transactionId?: string;
    readonly currency?: string;
    readonly externalRef?: TransactionLinkDto['externalRef'];
  }): string {
    return this.putTransaction({
      kind: 'TRANSFER',
      status: input.status ?? 'POSTED',
      accountId: input.from,
      toAccountId: input.to,
      amount: input.amount,
      businessDate: input.businessDate ?? this.today(),
      source: input.source ?? 'MANUAL',
      externalRef: input.externalRef ?? null,
      ...(input.transactionId ? { transactionId: input.transactionId } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
    });
  }

  /** Siembra un gasto; si está posteado baja el saldo de la cuenta. */
  seedExpense(input: {
    readonly account: string;
    readonly amount: string;
    readonly status?: string;
    readonly businessDate?: string;
    readonly description?: string;
  }): string {
    return this.putTransaction({
      kind: 'EXPENSE',
      status: input.status ?? 'POSTED',
      accountId: input.account,
      toAccountId: null,
      amount: input.amount,
      businessDate: input.businessDate ?? this.today(),
      source: 'MANUAL',
      externalRef: null,
      ...(input.description ? { description: input.description } : {}),
    });
  }

  seedIncome(input: {
    readonly account: string;
    readonly amount: string;
    readonly businessDate?: string;
  }): string {
    return this.putTransaction({
      kind: 'INCOME',
      status: 'POSTED',
      accountId: input.account,
      toAccountId: null,
      amount: input.amount,
      businessDate: input.businessDate ?? this.today(),
      source: 'MANUAL',
      externalRef: null,
    });
  }

  private putTransaction(input: {
    readonly kind: string;
    readonly status: string;
    readonly accountId: string;
    readonly toAccountId: string | null;
    readonly amount: string;
    readonly businessDate: string;
    readonly source: string;
    readonly externalRef: TransactionLinkDto['externalRef'];
    readonly transactionId?: string;
    readonly currency?: string;
    readonly description?: string;
  }): string {
    this.txCounter += 1;
    const id =
      input.transactionId ?? `0190a000-0000-7000-8000-${String(900000 + this.txCounter).padStart(12, '0')}`;
    const tx: FakeTransaction = {
      transactionId: id,
      kind: input.kind,
      status: input.status,
      businessDate: input.businessDate,
      amount: { amount: input.amount, currency: input.currency ?? this.currencyOf(input.accountId) },
      accountId: input.accountId,
      toAccountId: input.toAccountId,
      counterpartyId: null,
      source: input.source,
      externalRef: input.externalRef,
      revision: 1,
      description: input.description ?? 'manual',
    };
    this.txStore.set(id, tx);
    if (POSTED_STATUSES.has(tx.status)) this.applyEffect(tx, 1);
    return id;
  }

  /** Efecto de una transacción sobre los saldos contables (`sign` = −1 para deshacerlo). */
  private applyEffect(tx: FakeTransaction, sign: 1 | -1): void {
    const amount = dec(tx.amount.amount).times(sign);
    const move = (accountId: string, delta: Decimal) =>
      this.balanceStore.set(
        accountId,
        dec(this.balanceStore.get(accountId) ?? '0')
          .plus(delta)
          .toString(),
      );
    if (tx.kind === 'TRANSFER') {
      move(tx.accountId, amount.negated());
      if (tx.toAccountId) move(tx.toAccountId, amount);
    } else if (tx.kind === 'EXPENSE') move(tx.accountId, amount.negated());
    else if (tx.kind === 'INCOME') move(tx.accountId, amount);
  }

  transaction(id: string): FakeTransaction {
    const tx = this.txStore.get(id);
    if (!tx) throw new Error(`no transaction ${id}`);
    return tx;
  }

  /** Anula la transacción (deshace su efecto en los saldos); el hecho lo entrega la prueba (`voidedEvent`). */
  voidTransaction(id: string): void {
    const tx = this.transaction(id);
    if (POSTED_STATUSES.has(tx.status)) this.applyEffect(tx, -1);
    this.txStore.set(id, { ...tx, status: 'VOIDED' });
  }

  /** Revisa una transferencia (revisión + 1) y ajusta los saldos; devuelve el hecho `TransferRevised`. */
  reviseTransfer(
    id: string,
    changes: { amount?: string; toAccountId?: string; businessDate?: string },
  ): DomainEventInput {
    const tx = this.transaction(id);
    if (POSTED_STATUSES.has(tx.status)) this.applyEffect(tx, -1);
    const next: FakeTransaction = {
      ...tx,
      amount: { amount: changes.amount ?? tx.amount.amount, currency: tx.amount.currency },
      toAccountId: changes.toAccountId ?? tx.toAccountId,
      businessDate: changes.businessDate ?? tx.businessDate,
      revision: tx.revision + 1,
    };
    this.txStore.set(id, next);
    if (POSTED_STATUSES.has(next.status)) this.applyEffect(next, 1);
    return this.event('transactions.TransferRevised', {
      transactionId: id,
      revisionFrom: tx.revision,
      revisionTo: next.revision,
      fromAccountId: next.accountId,
      toAccountId: next.toAccountId,
      amount: next.amount,
      businessDate: next.businessDate,
    });
  }

  /** Una transferencia pendiente pasa a posteada (mueve saldos); devuelve `TransferCompleted`. */
  completeTransfer(id: string): DomainEventInput {
    const tx = this.transaction(id);
    const next: FakeTransaction = { ...tx, status: 'POSTED' };
    this.txStore.set(id, next);
    this.applyEffect(next, 1);
    return this.transferCompletedEvent(id);
  }

  // ─────────────────────────────────────────────────────────────────────── atajos de comandos

  /** Reserva `amount` (BOB por omisión) de `accountId` para la meta. */
  earmark(
    goalId: string,
    accountId: string,
    amount: string,
    options: { readonly businessDate?: string; readonly currency?: string; readonly userId?: string } = {},
  ): Promise<MovementRow> {
    return this.movements.contribute({
      workspaceId: WS,
      userId: options.userId ?? EDITOR,
      goalId,
      fund: 'EARMARK',
      amount: { amount, currency: options.currency ?? this.currencyOf(accountId) },
      sourceAccountId: accountId,
      ...(options.businessDate ? { businessDate: options.businessDate } : {}),
    });
  }

  /** Aporte real por transferencia `from` → `to` (por omisión "Banco BOB" → "Ahorro BOB"). */
  contribute(
    goalId: string,
    amount: string,
    options: { readonly from?: string; readonly to?: string; readonly businessDate?: string } = {},
  ): Promise<MovementRow> {
    const to = options.to ?? SAVINGS;
    return this.movements.contribute({
      workspaceId: WS,
      userId: EDITOR,
      goalId,
      fund: 'REAL',
      amount: { amount, currency: this.currencyOf(to) },
      sourceAccountId: options.from ?? BANK,
      destinationAccountId: to,
      ...(options.businessDate ? { businessDate: options.businessDate } : {}),
    });
  }

  /** Libera `amount` de la reserva de la meta en `accountId`. */
  release(goalId: string, accountId: string, amount: string): Promise<MovementRow> {
    return this.movements.withdraw({
      workspaceId: WS,
      userId: EDITOR,
      goalId,
      fund: 'EARMARK',
      accountId,
      amount: { amount, currency: this.currencyOf(accountId) },
      mode: { type: 'RELEASE' },
    });
  }

  /** Vincula una transferencia existente como aporte real. */
  linkTransaction(goalId: string, transactionId: string): Promise<MovementRow> {
    return this.movements.link({ workspaceId: WS, userId: EDITOR, goalId, transactionId });
  }

  /** Versión persistida de la meta. */
  versionOf(goalId: string): number {
    return this.goalState(goalId).version;
  }

  // ─────────────────────────────────────────────────────────────────────── hechos de entrada

  event(eventType: string, payload: unknown, eventId?: string): DomainEventInput {
    return { workspaceId: WS, eventType, eventId: eventId ?? this.nextId(), payload };
  }

  voidedEvent(transactionId: string): DomainEventInput {
    return this.event('transactions.TransactionVoided', { transactionId });
  }

  transferCompletedEvent(transactionId: string): DomainEventInput {
    return this.event('transactions.TransferCompleted', { transactionId });
  }

  journalPostedEvent(accountIds: readonly string[]): DomainEventInput {
    return this.event('ledger.JournalEntryPosted', {
      postings: accountIds.map((accountId) => ({ accountId })),
    });
  }

  /**
   * Materializa una ocurrencia de la definición administrada por la meta: crea la transferencia (origen `RECURRING`) y
   * devuelve el hecho `RecurringOccurrenceMaterialized` (`managedBy = GOAL`).
   */
  materializeOccurrence(
    definitionId: string,
    input: { readonly date: string; readonly status: 'POSTED' | 'PENDING' },
  ): { readonly transactionId: string; readonly event: DomainEventInput } {
    const def = this.definitionStore.get(definitionId);
    if (!def) throw new Error(`no definition ${definitionId}`);
    const occurrenceId = this.nextId();
    const transactionId = this.seedTransfer({
      from: def.input['accountId'] as string,
      to: def.input['toAccountId'] as string,
      amount: def.input['amount'] as string,
      status: input.status,
      businessDate: input.date,
      source: 'RECURRING',
      externalRef: { namespace: 'commitments.occurrence', id: occurrenceId },
    });
    return {
      transactionId,
      event: this.event('commitments.RecurringOccurrenceMaterialized', {
        managedBy: 'GOAL',
        definitionId,
        occurrenceId,
        transactionId,
      }),
    };
  }

  definition(definitionId: string): FakeDefinition {
    const found = this.definitionStore.get(definitionId);
    if (!found) throw new Error(`no definition ${definitionId}`);
    return { id: definitionId, managedRef: String(found.input['managedRef'] ?? ''), ...found };
  }

  // ─────────────────────────────────────────────────────────────────────── tasas

  /** Siembra una tasa: 1 `base` = `value` `quote`, vigente desde `asOf`. */
  setRate(
    base: string,
    quote: string,
    value: string,
    options: {
      readonly asOf?: string;
      readonly rateType?: FxRateTypeDto;
      readonly sourceLabel?: string | null;
      readonly attributionText?: string | null;
    } = {},
  ): void {
    const key = `${base}/${quote}`;
    const list = this.rateSeries.get(key) ?? [];
    list.push({
      value,
      asOf: options.asOf ?? iso(this.clock.now()),
      rateType: options.rateType ?? 'OFFICIAL',
      sourceLabel: options.sourceLabel ?? null,
      attributionText: options.attributionText ?? null,
    });
    list.sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
    this.rateSeries.set(key, list);
  }

  clearRates(): void {
    this.rateSeries.clear();
  }

  // ─────────────────────────────────────────────────────────────────────── consultas de la prueba

  /** Movimientos de una meta en orden de registro. */
  movementsOf(goalId: string): MovementRow[] {
    return this.movementStore.filter((m) => m.goalId === goalId);
  }

  eventsOf(eventType: string): CapturedEvent[] {
    return this.events.filter((e) => e.eventType === eventType);
  }

  auditActions(): string[] {
    return this.trail.map((r) => r.entry.action);
  }

  /** Σ firmada de los movimientos de la meta (INV-018) en la moneda dada. */
  sumOf(goalId: string, currency = 'BOB'): string {
    const scale = SCALES[currency] ?? 2;
    return this.movementsOf(goalId)
      .filter((m) => m.amount.currency.code === currency)
      .reduce((acc, m) => acc.plus(m.amount.amount), dec('0'))
      .toFixed(scale);
  }

  // ─────────────────────────────────────────────────────────────────────── composición

  private snapshot(): Snapshot {
    return {
      goals: new Map(this.goalStore),
      movements: [...this.movementStore],
      plans: new Map(this.planStore),
      states: new Map(this.stateStore),
      materializations: new Map(this.materializationStore),
      suggestions: [...this.suggestionStore],
      transactions: new Map(this.txStore),
      balances: new Map(this.balanceStore),
      events: [...this.events],
      trail: [...this.trail],
      definitions: new Map([...this.definitionStore].map(([k, v]) => [k, { ...v }])),
      recurringCalls: [...this.recurringCalls],
      transferCalls: [...this.transferCalls],
    };
  }

  private restore(s: Snapshot): void {
    this.goalStore = s.goals;
    this.movementStore = s.movements;
    this.planStore = s.plans;
    this.stateStore = s.states;
    this.materializationStore = s.materializations;
    this.suggestionStore = s.suggestions;
    this.txStore = s.transactions;
    this.balanceStore = s.balances;
    this.events = s.events;
    this.trail = s.trail;
    this.definitionStore = s.definitions;
    this.recurringCalls = s.recurringCalls;
    this.transferCalls = s.transferCalls;
  }

  private compose(): GoalsDeps {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- los dobles de los repositorios leen el mundo
    const world = this;
    const fixed = (value: Decimal | string, code: string) => dec(value).toFixed(SCALES[code] ?? 2);

    /** Unidad de trabajo: serializa las raíces (como el `FOR UPDATE`) y revierte todo el estado si falla. */
    const uow: UnitOfWork = {
      run: async <T>(_ws: string, fn: () => Promise<T>): Promise<T> => {
        if (world.nesting.getStore()) return fn();
        const previous = world.mutex;
        let release!: () => void;
        world.mutex = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const snap = world.snapshot();
        try {
          return await world.nesting.run(true, fn);
        } catch (err) {
          world.restore(snap);
          throw err;
        } finally {
          release();
        }
      },
    };

    const sortGoals = (list: GoalState[]): GoalState[] =>
      list.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        if (a.targetDate !== b.targetDate) {
          if (a.targetDate === null) return 1;
          if (b.targetDate === null) return -1;
          return a.targetDate < b.targetDate ? -1 : 1;
        }
        const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        return byName !== 0 ? byName : a.id < b.id ? -1 : 1;
      });

    const goals: GoalRepository = {
      findById: async (_ws, id) => {
        const s = world.goalStore.get(id);
        return s ? SavingsGoal.restore(s) : null;
      },
      lockMany: async (_ws, ids) => {
        const sorted = [...new Set(ids)].sort();
        world.lockLog.push(sorted);
        return sorted.flatMap((id) => {
          const s = world.goalStore.get(id);
          return s ? [SavingsGoal.restore(s)] : [];
        });
      },
      insert: async (goal) => {
        if (world.goalStore.has(goal.id)) throw new Error('duplicate goal id');
        world.goalStore.set(goal.id, goal.snapshot);
      },
      save: async (goal) => {
        const stored = world.goalStore.get(goal.id);
        if (!stored || stored.version !== goal.persistedVersion) return false;
        world.goalStore.set(goal.id, goal.snapshot);
        return true;
      },
      list: async (_ws, filter: GoalFilter) =>
        sortGoals(
          [...world.goalStore.values()].filter(
            (s) =>
              (!filter.statuses || filter.statuses.length === 0 || filter.statuses.includes(s.status)) &&
              (!filter.type || s.type === filter.type) &&
              ((filter.includeArchived ?? false) || s.archivedAt === null),
          ),
        ).map((s) => SavingsGoal.restore(s)),
      nameTaken: async (_ws, name, exceptId) =>
        [...world.goalStore.values()].some(
          (s) =>
            s.archivedAt === null &&
            s.name.toLowerCase() === name.toLowerCase() &&
            (exceptId === undefined || s.id !== exceptId),
        ),
      linkedToAccounts: async (_ws, accountIds) =>
        [...world.goalStore.values()]
          .filter((s) => s.status === 'ACTIVE' || s.status === 'PAUSED')
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .flatMap((s) =>
            s.linkedAccountIds
              .filter((a) => accountIds.includes(a))
              .map((accountId) => ({ goalId: s.id, accountId, status: s.status as GoalStatus })),
          ),
      withForeignFunds: async () =>
        [...world.goalStore.values()]
          .filter(
            (s) =>
              (s.status === 'ACTIVE' || s.status === 'PAUSED') &&
              world.movementStore.some((m) => m.goalId === s.id && m.amount.currency.code !== s.currency),
          )
          .map((s) => s.id)
          .sort(),
    };

    const isReversed = (id: string) => world.movementStore.some((m) => m.reversesId === id);

    const movements: MovementRepository = {
      insert: async (_ws, m) => {
        // Claves únicas: reverses_id, aporte real por (transacción, revisión), retiro real por (transacción, revisión, meta).
        if (m.reversesId && world.movementStore.some((x) => x.reversesId === m.reversesId)) return false;
        if (m.kind === 'CONTRIBUTION' && m.fund === 'REAL') {
          if (
            world.movementStore.some(
              (x) =>
                x.kind === 'CONTRIBUTION' &&
                x.fund === 'REAL' &&
                x.transactionId === m.transactionId &&
                x.transactionRevision === m.transactionRevision,
            )
          ) {
            return false;
          }
        }
        if (m.kind === 'WITHDRAWAL' && m.fund === 'REAL') {
          if (
            world.movementStore.some(
              (x) =>
                x.kind === 'WITHDRAWAL' &&
                x.fund === 'REAL' &&
                x.transactionId === m.transactionId &&
                x.transactionRevision === m.transactionRevision &&
                x.goalId === m.goalId,
            )
          ) {
            return false;
          }
        }
        world.movementStore.push(m);
        return true;
      },
      find: async (_ws, id) => world.movementStore.find((m) => m.id === id) ?? null,
      listAll: async (_ws, goalId) => world.movementStore.filter((m) => m.goalId === goalId),
      list: async (_ws, goalId, filter) => {
        const cursor = filter.cursor;
        const key = (m: { occurredOn: string; recordedAt: string; id: string }) =>
          `${m.occurredOn}|${m.recordedAt}|${m.id}`;
        return world.movementStore
          .filter(
            (m) =>
              m.goalId === goalId &&
              (!filter.from || m.occurredOn >= filter.from) &&
              (!filter.to || m.occurredOn <= filter.to) &&
              (!cursor || key(m) < key(cursor)),
          )
          .sort((a, b) => (key(a) < key(b) ? 1 : -1))
          .slice(0, filter.limit ?? 50);
      },
      hasAny: async (_ws, goalId) => world.movementStore.some((m) => m.goalId === goalId),
      sums: async (_ws, goalIds) => {
        const groups = new Map<string, { goalId: string; currency: string; total: Decimal }>();
        for (const m of world.movementStore) {
          if (!goalIds.includes(m.goalId)) continue;
          const key = `${m.goalId}|${m.amount.currency.code}`;
          const prev = groups.get(key) ?? {
            goalId: m.goalId,
            currency: m.amount.currency.code,
            total: dec('0'),
          };
          prev.total = prev.total.plus(m.amount.amount);
          groups.set(key, prev);
        }
        return [...groups.values()]
          .sort((a, b) => (`${a.goalId}|${a.currency}` < `${b.goalId}|${b.currency}` ? -1 : 1))
          .map((g) => ({ goalId: g.goalId, currency: g.currency, amount: fixed(g.total, g.currency) }));
      },
      funds: async (_ws, filter) => {
        const groups = new Map<
          string,
          { goalId: string; accountId: string; fund: GoalFund; currency: string; total: Decimal }
        >();
        for (const m of world.movementStore) {
          const goal = world.goalStore.get(m.goalId);
          if (!goal) continue;
          if (filter.goalIds && !filter.goalIds.includes(m.goalId)) continue;
          if (filter.accountIds && !filter.accountIds.includes(m.accountId)) continue;
          if (filter.statuses && !filter.statuses.includes(goal.status)) continue;
          const key = `${m.goalId}|${m.accountId}|${m.fund}|${m.amount.currency.code}`;
          const prev = groups.get(key) ?? {
            goalId: m.goalId,
            accountId: m.accountId,
            fund: m.fund,
            currency: m.amount.currency.code,
            total: dec('0'),
          };
          prev.total = prev.total.plus(m.amount.amount);
          groups.set(key, prev);
        }
        return [...groups.values()]
          .sort((a, b) =>
            `${a.goalId}|${a.accountId}|${a.fund}` < `${b.goalId}|${b.accountId}|${b.fund}` ? -1 : 1,
          )
          .map((g) => {
            const goal = world.goalStore.get(g.goalId) as GoalState;
            return {
              goalId: g.goalId,
              goalName: goal.name,
              goalStatus: goal.status,
              accountId: g.accountId,
              fund: g.fund,
              currency: g.currency,
              amount: fixed(g.total, g.currency),
            };
          });
      },
      byTransactions: async (_ws, ids) =>
        world.movementStore.filter((m) => m.transactionId !== null && ids.includes(m.transactionId)),
      liveByTransaction: async (_ws, transactionId) =>
        world.movementStore.filter(
          (m) =>
            m.transactionId === transactionId &&
            m.fund === 'REAL' &&
            (m.kind === 'CONTRIBUTION' || m.kind === 'WITHDRAWAL') &&
            !isReversed(m.id),
        ),
      isReversed: async (_ws, id) => isReversed(id),
      flows: async (_ws, filter) => {
        const groups = new Map<string, { goalId: string; date: string; currency: string; total: Decimal }>();
        for (const m of world.movementStore) {
          if (filter.goalIds && !filter.goalIds.includes(m.goalId)) continue;
          if (m.occurredOn < filter.from || m.occurredOn > filter.to) continue;
          if (!filter.includeReassignments && (m.kind === 'REASSIGN_IN' || m.kind === 'REASSIGN_OUT'))
            continue;
          const key = `${m.goalId}|${m.occurredOn}|${m.amount.currency.code}`;
          const prev = groups.get(key) ?? {
            goalId: m.goalId,
            date: m.occurredOn,
            currency: m.amount.currency.code,
            total: dec('0'),
          };
          prev.total = prev.total.plus(m.amount.amount);
          groups.set(key, prev);
        }
        return [...groups.values()]
          .sort((a, b) =>
            `${a.goalId}|${a.date}|${a.currency}` < `${b.goalId}|${b.date}|${b.currency}` ? -1 : 1,
          )
          .map((g) => ({
            goalId: g.goalId,
            date: g.date,
            currency: g.currency,
            amount: fixed(g.total, g.currency),
          }));
      },
      accountsWithMovements: async () => [...new Set(world.movementStore.map((m) => m.accountId))].sort(),
      withdrawnFromTransaction: async (_ws, transactionId) =>
        world.movementStore
          .filter(
            (m) =>
              m.transactionId === transactionId &&
              m.fund === 'REAL' &&
              m.kind === 'WITHDRAWAL' &&
              !isReversed(m.id),
          )
          .reduce((acc, m) => acc.plus(m.amount.amount.negated()), dec('0'))
          .toString(),
    };

    const plans: PlanRepository = {
      get: async (_ws, goalId) => world.planStore.get(goalId) ?? null,
      getMany: async (_ws, goalIds) =>
        goalIds.flatMap((id) => {
          const p = world.planStore.get(id);
          return p ? [p] : [];
        }),
      upsert: async (_ws, plan) => {
        world.planStore.set(plan.goalId, plan);
      },
      remove: async (_ws, goalId) => {
        world.planStore.delete(goalId);
      },
      findByDefinition: async (_ws, definitionId) =>
        [...world.planStore.values()].find((p) => p.definitionId === definitionId) ?? null,
    };

    const reservations: ReservationStateRepository = {
      lock: async (_ws, accountId) => {
        const existing = world.stateStore.get(accountId);
        if (existing) return existing;
        const created: ReservationStateRecord = {
          accountId,
          state: 'NORMAL',
          episodeId: null,
          since: null,
          shortfall: null,
          currency: null,
          version: 1,
        };
        world.stateStore.set(accountId, created);
        return created;
      },
      save: async (_ws, state) => {
        world.stateStore.set(state.accountId, state);
      },
      overAllocated: async () => [...world.stateStore.values()].filter((s) => s.state === 'OVER_ALLOCATED'),
      states: async (_ws, accountIds) =>
        [...world.stateStore.values()].filter((s) => !accountIds || accountIds.includes(s.accountId)),
    };

    const materializations: MaterializationRepository = {
      find: async (_ws, transactionId) => world.materializationStore.get(transactionId) ?? null,
      upsert: async (_ws, record) => {
        world.materializationStore.set(record.transactionId, record);
      },
      setStatus: async (_ws, transactionId, status) => {
        const found = world.materializationStore.get(transactionId);
        if (found) world.materializationStore.set(transactionId, { ...found, status });
      },
      waitingForGoal: async (_ws, goalId) =>
        [...world.materializationStore.values()].filter((m) => m.goalId === goalId && m.status === 'WAITING')
          .length,
    };

    const suggestions: SuggestionRepository = {
      insertIfAbsent: async (_ws, s) => {
        if (
          world.suggestionStore.some(
            (x) => x.transactionId === s.transactionId && x.transactionRevision === s.transactionRevision,
          )
        ) {
          return false;
        }
        world.suggestionStore.push(s);
        return true;
      },
      find: async (_ws, id) => world.suggestionStore.find((s) => s.id === id) ?? null,
      list: async (_ws, status?: SuggestionStatus) =>
        world.suggestionStore
          .filter((s) => !status || s.status === status)
          .sort((a, b) => (`${a.createdAt}|${a.id}` < `${b.createdAt}|${b.id}` ? 1 : -1))
          .slice(0, 200),
      pendingCount: async () => world.suggestionStore.filter((s) => s.status === 'PENDING').length,
      decide: async (_ws, id, input) => {
        const i = world.suggestionStore.findIndex((s) => s.id === id);
        const found = world.suggestionStore[i];
        if (found) {
          world.suggestionStore[i] = {
            ...found,
            status: input.status,
            decidedAt: input.at,
            decidedBy: input.by,
            movementId: input.movementId,
          };
        }
      },
      expireForTransaction: async (_ws, transactionId) => {
        let n = 0;
        world.suggestionStore = world.suggestionStore.map((s) => {
          if (s.transactionId === transactionId && s.status === 'PENDING') {
            n += 1;
            return { ...s, status: 'EXPIRED' as const };
          }
          return s;
        });
        return n;
      },
    };

    const transfers: GoalTransferPort = {
      recordTransfer: async (input) => {
        world.transferAttempts += 1;
        world.transferCalls.push({ ...input });
        if (world.failures.has('transfer')) throw new Error('injected failure: transfer');
        const from = world.accounts.find((a) => a.accountId === input.fromAccountId);
        const to = world.accounts.find((a) => a.accountId === input.toAccountId);
        if (!from || !to) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
        if (from.accountId === to.accountId) {
          throw new DomainError('TRANSFER_SAME_ACCOUNT', 'source and destination must differ');
        }
        for (const a of [from, to]) {
          if (a.status === 'ARCHIVED') throw new DomainError('ACCOUNT_ARCHIVED', 'account is archived');
          if (a.status === 'CLOSED') throw new DomainError('ACCOUNT_CLOSED', 'account is closed');
        }
        if (from.currency !== to.currency || input.amount.currency !== from.currency) {
          throw new DomainError(
            'TRANSFER_CURRENCY_MISMATCH',
            'a transfer needs accounts in the same currency',
          );
        }
        const month = input.businessDate.slice(0, 7);
        if (world.closedPeriods.has(month)) {
          throw new DomainError('PERIOD_CLOSED', `period ${month} is closed`);
        }
        const transactionId = world.putTransaction({
          kind: 'TRANSFER',
          status: 'POSTED',
          accountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amount: input.amount.amount,
          businessDate: input.businessDate,
          source: 'GOAL',
          externalRef: { namespace: GOAL_MOVEMENT_NAMESPACE, id: input.goalRef.movementId },
          description: input.description,
        });
        // La unidad de trabajo del llamador también confirma el hecho de Transactions.
        await outbox.append({
          eventId: world.nextId(),
          eventType: 'transactions.TransferCompleted',
          eventVersion: 1,
          occurredAt: iso(world.clock.now()),
          workspaceId: input.workspaceId,
          aggregateType: 'Transaction',
          aggregateId: transactionId,
          aggregateVersion: 1,
          payload: { transactionId, source: 'GOAL' },
        });
        return { transactionId, businessDate: input.businessDate, revision: 1 };
      },
    };

    const links: TransactionLinkQuery = {
      getForLink: async ({ transactionId }) => world.txStore.get(transactionId) ?? null,
      getManyForLink: async ({ transactionIds }) =>
        transactionIds.flatMap((id) => {
          const tx = world.txStore.get(id);
          return tx ? [tx] : [];
        }),
      listLinkCandidates: async (input) =>
        [...world.txStore.values()].filter(
          (t) =>
            t.status !== 'VOIDED' &&
            input.accountIds.includes(t.accountId) &&
            t.businessDate >= input.from &&
            t.businessDate <= input.to,
        ),
    };

    const record = (method: RecurringCall['method'], input: object) => {
      world.recurringCalls.push({ method, input: { ...input } as Record<string, unknown> });
    };
    const notUsed = async () => {
      throw new Error('not used by GOALS');
    };
    const recurring: RecurringDefinitionPort = {
      createManaged: async (input) => {
        record('createManaged', input);
        if (!('monthlyRule' in input)) throw new Error('only monthly rules in this fake');
        const id = world.nextId();
        const rule = input.monthlyRule;
        world.definitionStore.set(id, {
          status: 'ACTIVE',
          input: {
            managedBy: input.managedBy,
            managedRef: input.managedRef,
            accountId: input.accountId,
            toAccountId: input.toAccountId,
            amount: 'amount' in input ? input.amount : undefined,
            currency: input.currency,
            kind: input.kind,
            monthDays: [...rule.monthDays],
            startDate: rule.startDate,
            materialization: input.materialization,
          },
        });
        return { definitionId: id };
      },
      revise: async (input) => {
        record('reviseManaged', input);
        const def = world.definitionStore.get(input.definitionId);
        if (def) {
          def.input = {
            ...def.input,
            ...(input.accountId ? { accountId: input.accountId } : {}),
            ...(input.toAccountId ? { toAccountId: input.toAccountId } : {}),
            ...(input.amount ? { amount: input.amount } : {}),
            ...(input.monthDays ? { monthDays: [...input.monthDays] } : {}),
          };
        }
      },
      reviseManaged: async (input) => recurring.revise(input),
      pauseManaged: async (input) => {
        record('pauseManaged', input);
        const def = world.definitionStore.get(input.definitionId);
        if (def) def.status = 'PAUSED';
      },
      resumeManaged: async (input) => {
        record('resumeManaged', input);
        const def = world.definitionStore.get(input.definitionId);
        if (def) def.status = 'ACTIVE';
      },
      end: async (input) => {
        record('end', input);
        const def = world.definitionStore.get(input.definitionId);
        if (def) def.status = 'ENDED';
      },
      settle: notUsed,
      unsettle: notUsed,
      setExpected: notUsed,
      skip: notUsed,
      listOccurrences: async (): Promise<readonly ManagedOccurrenceDto[]> => [],
    };

    const outbox: GoalsDeps['outbox'] = {
      append: async (event) => {
        if (world.failures.has(`outbox:${event.eventType}`)) {
          throw new Error(`injected failure: outbox ${event.eventType}`);
        }
        const dup = world.events.some(
          (e) =>
            e.eventType === event.eventType &&
            e.aggregateId === event.aggregateId &&
            e.aggregateVersion === event.aggregateVersion,
        );
        if (dup) {
          throw new Error(
            `duplicated outbox key ${event.eventType} ${event.aggregateId} v${event.aggregateVersion}`,
          );
        }
        world.events.push({
          eventId: event.eventId,
          eventType: event.eventType,
          eventVersion: event.eventVersion,
          occurredAt: event.occurredAt,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          aggregateVersion: event.aggregateVersion,
          payload: event.payload as Record<string, unknown>,
        });
      },
    };

    return {
      uow,
      goals,
      movements,
      plans,
      reservations,
      materializations,
      suggestions,
      accounts: {
        find: async (_ws, ids) => world.accounts.filter((a) => ids.includes(a.accountId)),
      },
      balances: {
        presentedBalances: async (_ws, ids) => new Map(ids.map((id) => [id, world.balanceOf(id)] as const)),
      },
      currencies: {
        scaleOf: async (code) => SCALES[code] ?? null,
        isEnabled: async (_ws, code) => ENABLED.has(code),
      },
      calendar: { calendarOf: async () => ({ timeZone: world.timeZone, startDay: world.startDay }) },
      valuation: {
        resolve: async (input) =>
          input.requests.map((r): ValuationRateDto | null => world.resolveRate(r, input.windowDays)),
      },
      transfers,
      links,
      recurring,
      audit: {
        append: async (entry) => {
          if (world.failures.has(`audit:${entry.action}`)) {
            throw new Error(`injected failure: audit ${entry.action}`);
          }
          world.trail.push({ entry, steps: [] });
        },
      },
      lifecycle: {
        record: async (entry, steps) => {
          if (world.failures.has(`audit:${entry.action}`)) {
            throw new Error(`injected failure: audit ${entry.action}`);
          }
          world.trail.push({ entry, steps });
        },
      },
      outbox,
      ids: { next: () => world.nextId() },
      clock: this.clock,
      settings: { rateValidityWindowDays: 7, pageSize: 50 },
    };
  }

  /** Tasa de valoración vigente en `at` (directa o inversa) dentro de la ventana; `null` si no hay ninguna. */
  private resolveRate(
    request: { readonly base: string; readonly quote: string; readonly at: string },
    windowDays: number,
  ): ValuationRateDto | null {
    const at = Instant.parse(request.at).epochMillis;
    const windowMs = windowDays * 86_400_000;
    const pick = (base: string, quote: string) => {
      const usable = (this.rateSeries.get(`${base}/${quote}`) ?? []).filter((r) => {
        const asOf = Instant.parse(r.asOf).epochMillis;
        return asOf <= at && at - asOf <= windowMs;
      });
      return usable.at(-1) ?? null;
    };
    const direct = pick(request.base, request.quote);
    const inverse = direct ? null : pick(request.quote, request.base);
    const seed = direct ?? inverse;
    if (!seed) return null;
    const stored = direct
      ? { base: request.base, quote: request.quote }
      : { base: request.quote, quote: request.base };
    const asOfMs = Instant.parse(seed.asOf).epochMillis;
    const presented = direct ? seed.value : dec('1').div(dec(seed.value)).toDecimalPlaces(8).toString();
    return {
      exact: { ...stored, value: seed.value },
      resolved: {
        rate: { base: request.base, quote: request.quote, value: presented },
        fxRateId: `rate-${stored.base}-${stored.quote}-${seed.asOf}`,
        derivation: direct ? 'DIRECT' : 'INVERSE',
        components: direct ? [] : [{ base: stored.base, quote: stored.quote, value: seed.value }],
        rateType: seed.rateType,
        requestedRateType: null,
        source: 'MANUAL',
        sourceLabel: seed.sourceLabel,
        asOf: seed.asOf,
        ageDays: Math.floor((at - asOfMs) / 86_400_000),
        ageSeconds: Math.floor((at - asOfMs) / 1000),
        approx: false,
        provider: null,
        selection: 'MANUAL',
        stale: false,
        attribution: seed.attributionText
          ? {
              provider: 'PARALELO_BO',
              text: seed.attributionText,
              url: 'https://paralelo.bo',
              license: null,
              licenseUrl: null,
            }
          : null,
      },
    };
  }
}

function account(
  accountId: string,
  name: string,
  nature: AccountInfo['nature'],
  currency: string,
): AccountInfo {
  return { accountId, name, nature, currency, status: 'ACTIVE' };
}

/** Código de dominio con el que falla `fn` (`'ok'` si no falla). */
export async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'ok';
  } catch (err) {
    return err instanceof DomainError ? err.code : `other:${String(err)}`;
  }
}

/** El `DomainError` con el que falla `fn`; falla la prueba si no lanza o lanza otra cosa. */
export async function errorOf(fn: () => Promise<unknown>): Promise<DomainError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error('expected the command to fail');
}
