import { DomainError, LocalDate, type Money } from '@pf/shared-kernel';
import { parseTolerance } from './price-change-detector.js';
import {
  SUBSCRIPTION_LIFECYCLE,
  type SubscriptionStatus,
  type SubscriptionTransition,
  type SubscriptionTransitionRecord,
} from './lifecycle.js';
import { PriceHistory, type PriceEntry } from './price-history.js';
import { DEFAULT_REMINDER, validReminder, type ReminderSettings } from './renewal-reminder-policy.js';

export const DEFAULT_TOLERANCE_PERCENT = '1.00';

export interface SubscriptionState {
  readonly id: string;
  readonly workspaceId: string;
  /** Definición recurrente asociada (UNIQUE): genera los cargos esperados. */
  readonly definitionId: string;
  /** Provider: contraparte de CLASSIFICATION. */
  readonly counterpartyId: string;
  readonly name: string;
  readonly planName: string | null;
  readonly priceCurrency: string;
  readonly status: SubscriptionStatus;
  readonly trialEndsOn: string | null;
  /** Cancelación al fin del ciclo (D139): atributo sobre TRIAL|ACTIVE|PAUSED, no un estado. */
  readonly scheduledCancellationOn: string | null;
  readonly cancelledOn: string | null;
  readonly cancellationReason: string | null;
  readonly cancellationUrl: string | null;
  readonly reminder: ReminderSettings;
  /** Tolerancia de cambio de precio en % (0.00–50.00). */
  readonly tolerancePercent: string;
  /** Proyección de la próxima renovación (no versiona el agregado). */
  readonly nextRenewalOn: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const text = (value: string | null | undefined, max: number, pointer: string): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    throw new DomainError('VALIDATION_FAILED', `must have at most ${max} characters`).at(pointer);
  }
  return trimmed;
};

export function validSubscriptionName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 120) {
    throw new DomainError('VALIDATION_FAILED', 'name must have between 1 and 120 characters').at('/name');
  }
  return name;
}

const date = (value: string, pointer: string): string => {
  try {
    return LocalDate.parse(value).toString();
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'date must be YYYY-MM-DD').at(pointer);
  }
};

export interface SubscriptionDetailsChange {
  readonly name?: string | undefined;
  readonly planName?: string | null | undefined;
  readonly reminder?: Partial<ReminderSettings> | undefined;
  readonly tolerancePercent?: string | undefined;
  readonly cancellationUrl?: string | null | undefined;
}

/**
 * AR `Subscription` (COMMITMENTS, docs/04 §3.7; openspec add-subscriptions decisiones 1, 3, 4, 6 y 7): la parte
 * comercial de una definición recurrente. Cabecera mutable más el historial de precios append-only. Toda transición se
 * valida contra `SUBSCRIPTION_LIFECYCLE`; renombrar, cambiar el plan, los ajustes o un precio son ANOTACIONES. Cada
 * cambio publicado sube `version` (el outbox exige una versión distinta por hecho del mismo agregado).
 */
export class Subscription {
  private transition: SubscriptionTransitionRecord | null = null;
  private fieldsChanged: string[] = [];
  private added: PriceEntry[] = [];

  private constructor(
    private state: SubscriptionState,
    private priceHistory: PriceHistory,
    private persisted: number,
  ) {}

  /** Alta (∅ → TRIAL|ACTIVE) con su primer precio vigente desde la primera renovación. */
  static create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly definitionId: string;
    readonly counterpartyId: string;
    readonly name: string;
    readonly planName?: string | null | undefined;
    readonly price: Money;
    readonly priceEntryId: string;
    readonly firstRenewalOn: string;
    readonly trialEndsOn?: string | null | undefined;
    readonly reminder?: Partial<ReminderSettings> | undefined;
    readonly tolerancePercent?: string | undefined;
    readonly cancellationUrl?: string | null | undefined;
    readonly at: string;
    readonly by: string | null;
  }): Subscription {
    const firstRenewalOn = date(input.firstRenewalOn, '/firstRenewalOn');
    const trialEndsOn = input.trialEndsOn ? date(input.trialEndsOn, '/trialEndsOn') : null;
    if (trialEndsOn !== null && firstRenewalOn < trialEndsOn) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'the first renewal must not precede the end of the trial',
      ).at('/firstRenewalOn');
    }
    const { history, entry } = PriceHistory.initial({
      id: input.priceEntryId,
      effectiveFrom: firstRenewalOn,
      price: input.price,
    });
    const status: SubscriptionStatus = trialEndsOn !== null ? 'TRIAL' : 'ACTIVE';
    const sub = new Subscription(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        definitionId: input.definitionId,
        counterpartyId: input.counterpartyId,
        name: validSubscriptionName(input.name),
        planName: text(input.planName, 120, '/planName'),
        priceCurrency: input.price.currency.code,
        status,
        trialEndsOn,
        scheduledCancellationOn: null,
        cancelledOn: null,
        cancellationReason: null,
        cancellationUrl: text(input.cancellationUrl, 500, '/cancellationUrl'),
        reminder: validReminder(input.reminder, DEFAULT_REMINDER),
        tolerancePercent: parseTolerance(input.tolerancePercent ?? DEFAULT_TOLERANCE_PERCENT),
        nextRenewalOn: firstRenewalOn,
        version: 1,
        createdAt: input.at,
        createdBy: input.by,
        updatedAt: input.at,
        updatedBy: input.by,
      },
      history,
      0,
    );
    sub.added = [entry];
    sub.mark('CREATE', null, status);
    return sub;
  }

  static restore(state: SubscriptionState, prices: readonly PriceEntry[]): Subscription {
    return new Subscription({ ...state }, PriceHistory.of(prices), state.version);
  }

  // ───────────────────────────────────────────────────────────── lectura

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get status(): SubscriptionStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }
  get snapshot(): SubscriptionState {
    return { ...this.state };
  }
  get history(): PriceHistory {
    return this.priceHistory;
  }
  /** Entradas de precio agregadas en esta instancia (el repositorio las inserta; son inmutables). */
  get addedPrices(): readonly PriceEntry[] {
    return this.added;
  }
  get lastTransition(): SubscriptionTransitionRecord | null {
    return this.transition;
  }
  get changedFields(): readonly string[] {
    return this.fieldsChanged;
  }
  /** Versión leída o escrita por última vez en la base (control optimista). */
  get persistedVersion(): number {
    return this.persisted;
  }
  markPersisted(): void {
    this.persisted = this.state.version;
    this.added = [];
  }

  /** Precio vigente en `on` (por omisión, el último que rige hacia adelante). */
  priceAt(on?: string): PriceEntry | null {
    return on === undefined ? this.priceHistory.latest : this.priceHistory.at(on);
  }

  get isCancelled(): boolean {
    return this.state.status === 'CANCELLED';
  }

  // ───────────────────────────────────────────────────────────── anotaciones

  /** Nombre, plan, recordatorio, tolerancia y enlace de cancelación (anotaciones; no aplican a canceladas). */
  annotate(
    changes: SubscriptionDetailsChange,
    at: string,
    by: string | null,
    extraFields: readonly string[] = [],
  ): void {
    this.assertNotCancelled();
    this.fieldsChanged = [];
    this.transition = null;
    const patch: Partial<Mutable<SubscriptionState>> = {};
    const fields: string[] = [];
    if (changes.name !== undefined) {
      const name = validSubscriptionName(changes.name);
      if (name !== this.state.name) {
        patch.name = name;
        fields.push('name');
      }
    }
    if (changes.planName !== undefined) {
      const planName = text(changes.planName, 120, '/planName');
      if (planName !== this.state.planName) {
        patch.planName = planName;
        fields.push('planName');
      }
    }
    if (changes.reminder !== undefined) {
      const reminder = validReminder(changes.reminder, this.state.reminder);
      if (reminder.enabled !== this.state.reminder.enabled) fields.push('reminderEnabled');
      if (reminder.daysBefore !== this.state.reminder.daysBefore) fields.push('reminderDaysBefore');
      patch.reminder = reminder;
    }
    if (changes.tolerancePercent !== undefined) {
      const tolerance = parseTolerance(changes.tolerancePercent);
      if (tolerance !== this.state.tolerancePercent) {
        patch.tolerancePercent = tolerance;
        fields.push('tolerancePercent');
      }
    }
    if (changes.cancellationUrl !== undefined) {
      const url = text(changes.cancellationUrl, 500, '/cancellationUrl');
      if (url !== this.state.cancellationUrl) {
        patch.cancellationUrl = url;
        fields.push('cancellationUrl');
      }
    }
    fields.push(...extraFields);
    if (fields.length === 0) return;
    this.apply(patch, at, by);
    this.fieldsChanged = fields;
  }

  /**
   * Sube la versión sin cambio de datos ni de estado (un hecho de detección, una propuesta decidida). A diferencia de
   * `noteChange`, también aplica a una suscripción cancelada: un cargo anterior a la cancelación sigue siendo resoluble.
   */
  touch(fields: readonly string[], at: string, by: string | null): void {
    this.apply({}, at, by);
    this.fieldsChanged = [...fields];
  }

  /** Anotación sin cambio de datos: sube la versión (cambio de cuenta o de ciclo, que viven en la definición). */
  noteChange(fields: readonly string[], at: string, by: string | null): void {
    this.assertNotCancelled();
    this.apply({}, at, by);
    this.fieldsChanged = [...fields];
  }

  // ───────────────────────────────────────────────────────────── precios

  /** Cambio de precio manual o propuesta aceptada: entrada nueva con vigencia posterior a la última. */
  changePrice(
    input: {
      readonly entryId: string;
      readonly effectiveFrom: string;
      readonly price: Money;
      readonly origin: 'MANUAL' | 'PROPOSAL';
      readonly proposalId?: string | null;
    },
    at: string,
    by: string | null,
  ): PriceEntry {
    this.assertNotCancelled();
    this.assertPriceCurrency(input.price);
    const { history, entry } = this.priceHistory.append({
      id: input.entryId,
      effectiveFrom: input.effectiveFrom,
      price: input.price,
      origin: input.origin,
      proposalId: input.proposalId ?? null,
    });
    this.priceHistory = history;
    this.added = [...this.added, entry];
    this.apply({}, at, by);
    this.fieldsChanged = ['price'];
    return entry;
  }

  /** Corrección de una entrada registrada por error: reemplazo con la misma vigencia. */
  supersedePrice(
    input: { readonly entryId: string; readonly supersedesId: string; readonly price: Money },
    at: string,
    by: string | null,
  ): { readonly entry: PriceEntry; readonly superseded: PriceEntry } {
    this.assertNotCancelled();
    this.assertPriceCurrency(input.price);
    const { history, entry, superseded } = this.priceHistory.supersede({
      id: input.entryId,
      entryId: input.supersedesId,
      price: input.price,
    });
    this.priceHistory = history;
    this.added = [...this.added, entry];
    this.apply({}, at, by);
    this.fieldsChanged = ['price'];
    return { entry, superseded };
  }

  private assertPriceCurrency(price: Money): void {
    if (price.currency.code !== this.state.priceCurrency) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `the subscription price is in ${this.state.priceCurrency}; got ${price.currency.code}`,
      ).at('/price/currency');
    }
  }

  // ───────────────────────────────────────────────────────────── transiciones

  /** `TRIAL → ACTIVE` al llegar el fin de trial en la zona del workspace (una sola vez). */
  endTrial(today: LocalDate, at: string, by: string | null): void {
    const trialEndsOn = this.state.trialEndsOn;
    SUBSCRIPTION_LIFECYCLE.transition('END_TRIAL', this.state.status, 'ACTIVE');
    if (trialEndsOn === null || LocalDate.parse(trialEndsOn).compare(today) > 0) {
      throw new DomainError('VALIDATION_FAILED', 'the trial has not ended yet');
    }
    this.step('END_TRIAL', 'ACTIVE', {}, at, by);
  }

  pause(at: string, by: string | null): void {
    this.step('PAUSE', 'PAUSED', {}, at, by);
  }

  resume(at: string, by: string | null): void {
    this.step('RESUME', 'ACTIVE', {}, at, by);
  }

  /** Programa la cancelación al fin del ciclo (fecha futura); el estado no cambia. */
  scheduleCancellation(
    input: { readonly on: string; readonly reason?: string | null | undefined; readonly today: LocalDate },
    at: string,
    by: string | null,
  ): void {
    const on = date(input.on, '/effectiveOn');
    SUBSCRIPTION_LIFECYCLE.transition('SCHEDULE_CANCELLATION', this.state.status, this.state.status);
    if (LocalDate.parse(on).compare(input.today) <= 0) {
      throw new DomainError('VALIDATION_FAILED', 'a scheduled cancellation must be in the future').at(
        '/effectiveOn',
      );
    }
    this.step(
      'SCHEDULE_CANCELLATION',
      this.state.status,
      {
        scheduledCancellationOn: on,
        cancellationReason: text(input.reason, 500, '/reason'),
      },
      at,
      by,
    );
  }

  undoScheduledCancellation(at: string, by: string | null): void {
    SUBSCRIPTION_LIFECYCLE.transition('UNDO_SCHEDULED_CANCELLATION', this.state.status, this.state.status);
    if (this.state.scheduledCancellationOn === null) {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'there is no scheduled cancellation to undo');
    }
    this.step(
      'UNDO_SCHEDULED_CANCELLATION',
      this.state.status,
      { scheduledCancellationOn: null, cancellationReason: null },
      at,
      by,
    );
  }

  /** `→ CANCELLED` con fecha efectiva de hoy o anterior (inmediata) o la programada que llegó. */
  cancel(
    input: { readonly on: string; readonly reason?: string | null | undefined; readonly today: LocalDate },
    at: string,
    by: string | null,
  ): void {
    const on = date(input.on, '/effectiveOn');
    SUBSCRIPTION_LIFECYCLE.transition('CANCEL', this.state.status, 'CANCELLED');
    if (LocalDate.parse(on).compare(input.today) > 0) {
      throw new DomainError('VALIDATION_FAILED', 'use a scheduled cancellation for a future date').at(
        '/effectiveOn',
      );
    }
    const reason =
      input.reason === undefined ? this.state.cancellationReason : text(input.reason, 500, '/reason');
    this.step(
      'CANCEL',
      'CANCELLED',
      { cancelledOn: on, cancellationReason: reason, scheduledCancellationOn: null, nextRenewalOn: null },
      at,
      by,
    );
  }

  /** Proyección de la próxima renovación (no versiona el agregado ni cuenta como cambio). */
  setNextRenewal(on: string | null): void {
    this.state = { ...this.state, nextRenewalOn: on };
  }

  // ───────────────────────────────────────────────────────────── internos

  private assertNotCancelled(): void {
    if (this.state.status === 'CANCELLED') {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'a cancelled subscription cannot be changed');
    }
  }

  private step(
    code: SubscriptionTransition,
    to: SubscriptionStatus,
    patch: Partial<Mutable<SubscriptionState>>,
    at: string,
    by: string | null,
  ): void {
    const from = this.state.status;
    SUBSCRIPTION_LIFECYCLE.transition(code, from, to);
    this.apply({ ...patch, status: to }, at, by);
    this.fieldsChanged = Object.keys(patch);
    this.mark(code, from, to);
  }

  private apply(patch: Partial<Mutable<SubscriptionState>>, at: string, by: string | null): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1, updatedAt: at, updatedBy: by };
    this.transition = null;
    this.fieldsChanged = [];
  }

  private mark(
    transition: SubscriptionTransition,
    from: SubscriptionStatus | null,
    to: SubscriptionStatus,
  ): void {
    this.transition = { transition, from, to };
  }
}
