import { DomainError, LocalDate, Money, currency as makeCurrency, dec } from '@pf/shared-kernel';
import {
  GOAL_LIFECYCLE,
  isTerminalGoalStatus,
  type GoalStatus,
  type GoalTransition,
  type GoalTransitionRecord,
} from './goal-lifecycle.js';
import {
  DEFAULT_PACE_PERIODS,
  DEFAULT_PRIORITY,
  DEFAULT_TOLERANCE_PERCENT,
  GOAL_TYPES,
  MAX_PRIORITY,
  MAX_TOLERANCE_PERCENT,
  MIN_PRIORITY,
  type GoalType,
} from './goal-types.js';

export const MAX_GOAL_NAME = 120;
export const MAX_GOAL_NOTES = 2000;
export const MAX_GOAL_ICON = 40;
export const MAX_GOAL_COLOR = 32;
export const MAX_CANCEL_REASON = 500;
export const MIN_PACE_PERIODS = 1;
export const MAX_PACE_PERIODS = 12;

export interface GoalState {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly type: GoalType;
  /** Objetivo (decimal a la escala de su moneda). */
  readonly targetAmount: string;
  readonly currency: string;
  readonly startDate: string;
  readonly targetDate: string | null;
  readonly linkedAccountIds: readonly string[];
  readonly priority: number;
  readonly icon: string | null;
  readonly color: string | null;
  readonly notes: string | null;
  /** Porcentaje con 2 decimales (`"5.00"`). */
  readonly tolerancePercent: string;
  readonly pacePeriods: number;
  readonly status: GoalStatus;
  readonly achievedOn: string | null;
  readonly closedOn: string | null;
  readonly cancelledOn: string | null;
  readonly cancelReason: string | null;
  readonly archivedAt: string | null;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const fail = (message: string, pointer: string): never => {
  throw new DomainError('VALIDATION_FAILED', message).at(pointer);
};

export function validGoalName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 1 || name.length > MAX_GOAL_NAME) {
    fail(`name must have between 1 and ${MAX_GOAL_NAME} characters`, '/name');
  }
  return name;
}

function parseDate(value: unknown, pointer: string): string {
  try {
    return LocalDate.parse(value as string).toString();
  } catch {
    return fail('date must be YYYY-MM-DD', pointer);
  }
}

function optionalText(value: unknown, max: number, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail('must be text', pointer);
  const text = value.trim();
  if (text === '') return null;
  if (text.length > max) return fail(`must have at most ${max} characters`, pointer);
  return text;
}

function goalType(value: unknown): GoalType {
  if (typeof value !== 'string' || !(GOAL_TYPES as readonly string[]).includes(value)) {
    return fail(`type must be one of ${GOAL_TYPES.join(', ')}`, '/type');
  }
  return value as GoalType;
}

function validPriority(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_PRIORITY;
  if (!Number.isInteger(value) || (value as number) < MIN_PRIORITY || (value as number) > MAX_PRIORITY) {
    return fail(`priority must be an integer between ${MIN_PRIORITY} and ${MAX_PRIORITY}`, '/priority');
  }
  return value as number;
}

function validTolerance(value: unknown): string {
  if (value === undefined || value === null) return DEFAULT_TOLERANCE_PERCENT;
  if (typeof value !== 'string' || !/^\d{1,2}(\.\d{1,2})?$/.test(value)) {
    return fail('tolerancePercent must be a decimal string with at most 2 decimals', '/tolerancePercent');
  }
  const d = dec(value);
  if (d.gt(dec(MAX_TOLERANCE_PERCENT))) {
    return fail(`tolerancePercent must be between 0 and ${MAX_TOLERANCE_PERCENT}`, '/tolerancePercent');
  }
  return d.toFixed(2);
}

function validPacePeriods(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_PACE_PERIODS;
  if (
    !Number.isInteger(value) ||
    (value as number) < MIN_PACE_PERIODS ||
    (value as number) > MAX_PACE_PERIODS
  ) {
    return fail(
      `pacePeriods must be an integer between ${MIN_PACE_PERIODS} and ${MAX_PACE_PERIODS}`,
      '/pacePeriods',
    );
  }
  return value as number;
}

/** Objetivo positivo a la escala de su moneda (`AMOUNT_NOT_POSITIVE`, `AMOUNT_SCALE_EXCEEDED`). */
export function validTarget(amount: unknown, code: string, scale: number): string {
  if (typeof amount !== 'string') return fail('target.amount must be a decimal string', '/target/amount');
  let money: Money;
  try {
    money = Money.parse(amount, makeCurrency(code, scale));
  } catch (err) {
    if (err instanceof DomainError) throw err.at('/target/amount');
    throw err;
  }
  if (!money.isPositive()) {
    throw new DomainError('AMOUNT_NOT_POSITIVE', 'the target must be greater than zero').at('/target/amount');
  }
  return money.toFixed();
}

function linkedIds(value: readonly string[] | undefined): readonly string[] {
  return [...new Set(value ?? [])];
}

function checkDates(startDate: string, targetDate: string | null): void {
  if (targetDate !== null && targetDate <= startDate) {
    fail('the target date must be after the start date', '/targetDate');
  }
}

export interface GoalCreateInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly type: string;
  readonly target: { readonly amount: string; readonly currency: string };
  readonly currencyScale: number;
  readonly startDate: string;
  readonly targetDate?: string | null | undefined;
  readonly linkedAccountIds?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly icon?: string | null | undefined;
  readonly color?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly tolerancePercent?: string | undefined;
  readonly pacePeriods?: number | undefined;
  readonly at: string;
  readonly by: string;
}

export interface GoalEdit {
  readonly name?: string | undefined;
  readonly type?: string | undefined;
  readonly target?: { readonly amount: string; readonly currency?: string | undefined } | undefined;
  readonly targetDate?: string | null | undefined;
  readonly linkedAccountIds?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly icon?: string | null | undefined;
  readonly color?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly tolerancePercent?: string | undefined;
  readonly pacePeriods?: number | undefined;
}

/**
 * AR `SavingsGoal` (GOALS, docs/04 §3.8; openspec add-savings-goals decisión 15). Datos de la meta y su estado; el
 * progreso nunca se guarda: se deriva de los movimientos (INV-018). Toda transición se valida contra `GOAL_LIFECYCLE`;
 * cada cambio publicado sube `version` (el outbox exige una versión por hecho).
 */
export class SavingsGoal {
  private transition: GoalTransitionRecord | null = null;
  private fieldsChanged: string[] = [];

  private constructor(
    private state: GoalState,
    private persisted: number,
  ) {}

  /** Alta (∅ → ACTIVE). Las cuentas vinculadas ya fueron verificadas (activas, de naturaleza activo) por el llamador. */
  static create(input: GoalCreateInput): SavingsGoal {
    const startDate = parseDate(input.startDate, '/startDate');
    const targetDate =
      input.targetDate === undefined || input.targetDate === null
        ? null
        : parseDate(input.targetDate, '/targetDate');
    checkDates(startDate, targetDate);
    const goal = new SavingsGoal(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        name: validGoalName(input.name),
        type: goalType(input.type),
        targetAmount: validTarget(input.target.amount, input.target.currency, input.currencyScale),
        currency: input.target.currency,
        startDate,
        targetDate,
        linkedAccountIds: linkedIds(input.linkedAccountIds),
        priority: validPriority(input.priority),
        icon: optionalText(input.icon, MAX_GOAL_ICON, '/icon'),
        color: optionalText(input.color, MAX_GOAL_COLOR, '/color'),
        notes: optionalText(input.notes, MAX_GOAL_NOTES, '/notes'),
        tolerancePercent: validTolerance(input.tolerancePercent),
        pacePeriods: validPacePeriods(input.pacePeriods),
        status: 'ACTIVE',
        achievedOn: null,
        closedOn: null,
        cancelledOn: null,
        cancelReason: null,
        archivedAt: null,
        version: 1,
        createdBy: input.by,
        createdAt: input.at,
        updatedBy: input.by,
        updatedAt: input.at,
      },
      0,
    );
    goal.mark('CREATE', null, 'ACTIVE');
    return goal;
  }

  /** Reconstruye la meta desde su estado persistido. */
  static restore(state: GoalState): SavingsGoal {
    return new SavingsGoal(state, state.version);
  }

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get status(): GoalStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }
  /** Versión leída de la base (0 si la meta es nueva): control optimista. */
  get persistedVersion(): number {
    return this.persisted;
  }
  get snapshot(): GoalState {
    return this.state;
  }
  get lastTransition(): GoalTransitionRecord | null {
    return this.transition;
  }
  get changedFields(): readonly string[] {
    return this.fieldsChanged;
  }
  get isTerminal(): boolean {
    return isTerminalGoalStatus(this.state.status);
  }

  /** `GOAL_CLOSED`: aportar, retirar, reasignar o vincular sobre una meta `CLOSED` o `CANCELLED`. */
  assertAcceptsMovements(): void {
    if (this.isTerminal) {
      throw new DomainError('GOAL_CLOSED', `the goal is ${this.state.status.toLowerCase()}`, {
        details: { status: this.state.status },
      });
    }
  }

  isLinked(accountId: string): boolean {
    return this.state.linkedAccountIds.includes(accountId);
  }

  /**
   * Edición de datos (anotación). La moneda del objetivo no cambia con movimientos (`GOAL_CURRENCY_LOCKED`); una meta
   * terminal no se edita (`GOAL_CLOSED`). `currencyScale` es la escala de la moneda del objetivo resultante.
   */
  update(
    changes: GoalEdit,
    context: {
      readonly hasMovements: boolean;
      readonly currencyScale: number;
      readonly at: string;
      readonly by: string;
    },
  ): void {
    this.assertAcceptsMovements();
    const s = this.state;
    const patch: Partial<Mutable<GoalState>> = {};
    const fields: string[] = [];
    const set = <K extends keyof GoalState>(key: K, value: GoalState[K]) => {
      if (JSON.stringify(s[key]) !== JSON.stringify(value)) {
        (patch as Record<string, unknown>)[key] = value;
        fields.push(key);
      }
    };
    if (changes.name !== undefined) set('name', validGoalName(changes.name));
    if (changes.type !== undefined) set('type', goalType(changes.type));
    if (changes.target !== undefined) {
      const newCurrency = changes.target.currency ?? s.currency;
      if (newCurrency !== s.currency && context.hasMovements) {
        throw new DomainError(
          'GOAL_CURRENCY_LOCKED',
          'the target currency cannot change once the goal has movements',
        ).at('/target/currency');
      }
      set('targetAmount', validTarget(changes.target.amount, newCurrency, context.currencyScale));
      set('currency', newCurrency);
    }
    const nextTargetDate =
      changes.targetDate === undefined
        ? s.targetDate
        : changes.targetDate === null
          ? null
          : parseDate(changes.targetDate, '/targetDate');
    checkDates(s.startDate, nextTargetDate);
    set('targetDate', nextTargetDate);
    if (changes.linkedAccountIds !== undefined) set('linkedAccountIds', linkedIds(changes.linkedAccountIds));
    if (changes.priority !== undefined) set('priority', validPriority(changes.priority));
    if (changes.icon !== undefined) set('icon', optionalText(changes.icon, MAX_GOAL_ICON, '/icon'));
    if (changes.color !== undefined) set('color', optionalText(changes.color, MAX_GOAL_COLOR, '/color'));
    if (changes.notes !== undefined) set('notes', optionalText(changes.notes, MAX_GOAL_NOTES, '/notes'));
    if (changes.tolerancePercent !== undefined)
      set('tolerancePercent', validTolerance(changes.tolerancePercent));
    if (changes.pacePeriods !== undefined) set('pacePeriods', validPacePeriods(changes.pacePeriods));
    this.transition = null;
    this.fieldsChanged = fields;
    if (fields.length === 0) return;
    this.apply(patch, context.at, context.by);
  }

  /** ACTIVE → PAUSED. */
  pause(at: string, by: string): void {
    this.go('PAUSE', 'PAUSED', {}, at, by);
  }

  /** PAUSED → ACTIVE. */
  resume(at: string, by: string): void {
    this.go('RESUME', 'ACTIVE', {}, at, by);
  }

  /** ACTIVE|PAUSED → ACHIEVED (sistema). */
  reach(on: string, at: string, by: string): void {
    this.go('REACH', 'ACHIEVED', { achievedOn: on }, at, by);
  }

  /** ACHIEVED → ACTIVE (sistema): un movimiento o un cambio de objetivo la deja por debajo del objetivo. */
  reopen(at: string, by: string): void {
    this.go('REOPEN', 'ACTIVE', { achievedOn: null }, at, by);
  }

  /** ACHIEVED → CLOSED (terminal). */
  close(on: string, at: string, by: string): void {
    this.go('CLOSE', 'CLOSED', { closedOn: on }, at, by);
  }

  /** ACTIVE|PAUSED|ACHIEVED → CANCELLED (terminal) con motivo opcional. */
  cancel(on: string, reason: string | null | undefined, at: string, by: string): void {
    const text = optionalText(reason, MAX_CANCEL_REASON, '/reason');
    this.go('CANCEL', 'CANCELLED', { cancelledOn: on, cancelReason: text }, at, by);
  }

  /** Oculta una meta terminal del listado por defecto (anotación, sin transición). */
  archive(at: string, by: string): void {
    if (!this.isTerminal) {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        `SavingsGoal: only a closed or cancelled goal can be archived (${this.state.status})`,
      );
    }
    if (this.state.archivedAt !== null) {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'SavingsGoal: the goal is already archived');
    }
    this.apply({ archivedAt: at }, at, by);
    this.transition = null;
    this.fieldsChanged = ['archivedAt'];
  }

  /** Anotación sin cambio de datos: cada movimiento sube la versión (el outbox exige una versión por hecho). */
  touch(fields: readonly string[], at: string, by: string): void {
    this.apply({}, at, by);
    this.transition = null;
    this.fieldsChanged = [...fields];
  }

  /** Cambia el objetivo de una meta recién creada o en edición ya validada (reevaluación del estado). */
  get targetMoney(): { readonly amount: string; readonly currency: string } {
    return { amount: this.state.targetAmount, currency: this.state.currency };
  }

  // ───────────────────────────────────────────────────────────── internos

  private go(
    code: GoalTransition,
    to: GoalStatus,
    patch: Partial<Mutable<GoalState>>,
    at: string,
    by: string,
  ): void {
    const record = GOAL_LIFECYCLE.transition(code, this.state.status, to);
    this.apply({ ...patch, status: to }, at, by);
    this.transition = record;
    this.fieldsChanged = [];
  }

  private apply(patch: Partial<Mutable<GoalState>>, at: string, by: string): void {
    this.state = {
      ...this.state,
      ...patch,
      version: this.state.version + 1,
      updatedAt: at,
      updatedBy: by,
    } as GoalState;
  }

  private mark(transition: GoalTransition, from: GoalStatus | null, to: GoalStatus): void {
    this.transition = GOAL_LIFECYCLE.transition(transition, from, to);
    this.fieldsChanged = [];
  }
}
