import { DomainError, LocalDate } from '@pf/shared-kernel';
import { sameAmountSpec, type AmountSpec } from './amount-spec.js';
import {
  RECURRING_OCCURRENCE_LIFECYCLE,
  isUnresolved,
  type OccurrenceStatus,
  type OccurrenceTransition,
  type OccurrenceTransitionRecord,
} from './lifecycle.js';
import type { CancelReason, MatchedBy, Resolution } from './types.js';

/** Estado persistible de una ocurrencia (fechas `YYYY-MM-DD`, instantes RFC 3339 UTC). */
export interface OccurrenceState {
  readonly id: string;
  readonly workspaceId: string;
  readonly definitionId: string;
  /** Fecha nominal (antes del ajuste de fin de semana y de ediciones): clave de INV-013. */
  readonly occurrenceDate: string;
  /** Vencimiento: nominal ajustada o la fecha editada por el usuario. */
  readonly dueDate: string;
  readonly definitionVersionNo: number;
  readonly expected: AmountSpec;
  readonly currency: string;
  readonly amountOverridden: boolean;
  readonly dateOverridden: boolean;
  readonly status: OccurrenceStatus;
  readonly cancelReason: CancelReason | null;
  readonly transactionId: string | null;
  readonly resolution: Resolution | null;
  readonly matchedBy: MatchedBy | null;
  readonly skipReason: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly lastAutoCreateError: string | null;
  /** Día (zona del workspace) del último intento de creación automática: no se reintenta el mismo día. */
  readonly lastAutoCreateOn: string | null;
  readonly version: number;
  readonly createdAt: string;
}

export interface OccurrenceEdit {
  readonly expected?: AmountSpec;
  readonly dueDate?: string;
}

/**
 * AR `RecurringOccurrence` (COMMITMENTS, docs/04 §3.7; design decisiones 5, 8, 11-13). Agregado separado de la
 * definición (alto volumen, ciclo propio). Toda transición se valida contra `RECURRING_OCCURRENCE_LIFECYCLE`; editar
 * monto o fecha es una ANOTACIÓN (no cambia de estado).
 */
export class RecurringOccurrence {
  private transition: OccurrenceTransitionRecord | null = null;
  private fieldsChanged: string[] = [];

  private constructor(
    private state: OccurrenceState,
    private persisted: number,
  ) {}

  /** Versión leída o escrita por última vez en la base (control optimista). */
  get persistedVersion(): number {
    return this.persisted;
  }

  /** El repositorio lo invoca tras insertar o guardar: la versión actual pasa a ser la persistida. */
  markPersisted(): void {
    this.persisted = this.state.version;
  }

  /** `GENERATE` (∅ → SCHEDULED). */
  static generate(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly definitionId: string;
    readonly occurrenceDate: string;
    readonly dueDate: string;
    readonly definitionVersionNo: number;
    readonly expected: AmountSpec;
    readonly currency: string;
    readonly at: string;
  }): RecurringOccurrence {
    const occurrence = new RecurringOccurrence(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        definitionId: input.definitionId,
        occurrenceDate: input.occurrenceDate,
        dueDate: input.dueDate,
        definitionVersionNo: input.definitionVersionNo,
        expected: input.expected,
        currency: input.currency,
        amountOverridden: false,
        dateOverridden: false,
        status: 'SCHEDULED',
        cancelReason: null,
        transactionId: null,
        resolution: null,
        matchedBy: null,
        skipReason: null,
        resolvedAt: null,
        resolvedBy: null,
        lastAutoCreateError: null,
        lastAutoCreateOn: null,
        version: 1,
        createdAt: input.at,
      },
      0,
    );
    occurrence.mark('GENERATE', null, 'SCHEDULED');
    return occurrence;
  }

  static restore(state: OccurrenceState): RecurringOccurrence {
    return new RecurringOccurrence({ ...state }, state.version);
  }

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get definitionId(): string {
    return this.state.definitionId;
  }
  get status(): OccurrenceStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }
  get occurrenceDate(): string {
    return this.state.occurrenceDate;
  }
  get dueDate(): string {
    return this.state.dueDate;
  }
  get snapshot(): OccurrenceState {
    return { ...this.state };
  }
  get unresolved(): boolean {
    return isUnresolved(this.state.status);
  }
  /** Último paso de la máquina aplicado en esta instancia (`null` si no cambió de estado). */
  get lastTransition(): OccurrenceTransitionRecord | null {
    return this.transition;
  }
  /** Campos modificados por una edición (anotación) en esta instancia. */
  get changedFields(): readonly string[] {
    return this.fieldsChanged;
  }

  /** `BECOME_DUE` (SCHEDULED → DUE). */
  becomeDue(): void {
    this.step('BECOME_DUE', 'DUE', {});
  }

  /** `MARK_OVERDUE` (SCHEDULED | DUE → OVERDUE). */
  markOverdue(): void {
    this.step('MARK_OVERDUE', 'OVERDUE', {});
  }

  /**
   * `MATERIALIZE`: la transacción fue creada por el motor en la misma unidad de trabajo. Una ocurrencia ya resuelta
   * se rechaza con `OCCURRENCE_ALREADY_MATERIALIZED`; omitida o cancelada, con `INVALID_STATUS_TRANSITION`.
   */
  materialize(input: {
    readonly transactionId: string;
    readonly at: string;
    readonly by: string | null;
  }): void {
    this.assertNotResolved();
    this.step('MATERIALIZE', 'MATERIALIZED', {
      transactionId: input.transactionId,
      resolution: 'CREATED',
      matchedBy: null,
      resolvedAt: input.at,
      resolvedBy: input.by,
      lastAutoCreateError: null,
    });
  }

  /** `LINK`: una transacción existente resuelve la ocurrencia (matching manual o sugerencia confirmada). */
  link(input: {
    readonly transactionId: string;
    readonly matchedBy: MatchedBy;
    readonly at: string;
    readonly by: string | null;
  }): void {
    this.assertNotResolved();
    this.step('LINK', 'MATCHED', {
      transactionId: input.transactionId,
      resolution: 'MATCHED',
      matchedBy: input.matchedBy,
      resolvedAt: input.at,
      resolvedBy: input.by,
      lastAutoCreateError: null,
    });
  }

  /** `SKIP` (terminal): no crea transacción, no cuenta como comprometida y no se regenera. */
  skip(input: { readonly reason: string | null; readonly at: string; readonly by: string | null }): void {
    // Omitir una ya resuelta (o cancelada) es una transición no declarada: INVALID_STATUS_TRANSITION.
    const reason = input.reason?.trim() ? input.reason.trim() : null;
    if (reason !== null && reason.length > 500) {
      throw new DomainError('VALIDATION_FAILED', 'reason must have at most 500 characters').at('/reason');
    }
    this.step('SKIP', 'SKIPPED', {
      resolution: 'SKIPPED',
      skipReason: reason,
      resolvedAt: input.at,
      resolvedBy: input.by,
    });
  }

  /** `RELEASE`: la transacción vinculada fue anulada; vuelve a próxima (aún no vence) o atrasada. */
  release(today: LocalDate): string {
    const released = this.state.transactionId as string;
    const to: OccurrenceStatus = today.compare(LocalDate.parse(this.state.dueDate)) <= 0 ? 'DUE' : 'OVERDUE';
    this.step('RELEASE', to, {
      transactionId: null,
      resolution: null,
      matchedBy: null,
      resolvedAt: null,
      resolvedBy: null,
    });
    return released;
  }

  /** `CANCEL` (pausa, revisión o fin de la definición). */
  cancel(reason: CancelReason): void {
    this.step('CANCEL', 'CANCELLED', { cancelReason: reason });
  }

  /** `REINSTATE` (CANCELLED → SCHEDULED): la fecha vuelve a producirse. */
  reinstate(): void {
    this.step('REINSTATE', 'SCHEDULED', { cancelReason: null });
  }

  /** Anotación: edita monto esperado y/o vencimiento de ESTA ocurrencia (sin tocar la definición ni las demás). */
  edit(changes: OccurrenceEdit): void {
    if (!this.unresolved) {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        `a ${this.state.status} occurrence cannot be edited`,
      );
    }
    const patch: Partial<Mutable<OccurrenceState>> = {};
    const fields: string[] = [];
    if (changes.expected && !sameAmountSpec(changes.expected, this.state.expected)) {
      patch.expected = changes.expected;
      patch.amountOverridden = true;
      fields.push('expected');
    }
    if (changes.dueDate !== undefined && changes.dueDate !== this.state.dueDate) {
      LocalDate.parse(changes.dueDate);
      patch.dueDate = changes.dueDate;
      patch.dateOverridden = true;
      fields.push('dueDate');
    }
    if (fields.length === 0) return;
    patch.lastAutoCreateError = null;
    patch.lastAutoCreateOn = null;
    this.apply(patch);
    this.fieldsChanged = fields;
  }

  /**
   * Reescritura por una revisión "esta y las siguientes" (decisión 15): nuevos datos de la versión, SIN las ediciones
   * individuales (decisión 3 / D123). Devuelve si tenía ediciones que se descartaron.
   */
  rewrite(input: {
    readonly dueDate: string;
    readonly definitionVersionNo: number;
    readonly expected: AmountSpec;
    readonly currency: string;
  }): { readonly resetOverrides: boolean } {
    if (!this.unresolved)
      throw new DomainError('INVALID_STATUS_TRANSITION', 'only unresolved occurrences are rewritten');
    const resetOverrides = this.state.amountOverridden || this.state.dateOverridden;
    this.apply({
      dueDate: input.dueDate,
      definitionVersionNo: input.definitionVersionNo,
      expected: input.expected,
      currency: input.currency,
      amountOverridden: false,
      dateOverridden: false,
      lastAutoCreateError: null,
      lastAutoCreateOn: null,
    });
    this.fieldsChanged = ['expected', 'dueDate', 'definitionVersionNo'];
    return { resetOverrides };
  }

  /** Creación automática rechazada por Transactions: queda atrasada con el código visible y no se reintenta hoy. */
  recordAutoCreateFailure(code: string, today: LocalDate): void {
    this.apply({ lastAutoCreateError: code.slice(0, 80), lastAutoCreateOn: today.toString() });
  }

  /**
   * Guarda previa a resolver (aprobar, vincular u omitir) cuando hay trabajo costoso antes de mutar: ya resuelta ⇒
   * `OCCURRENCE_ALREADY_MATERIALIZED`; omitida o cancelada ⇒ `INVALID_STATUS_TRANSITION`.
   */
  assertCanResolve(): void {
    this.assertNotResolved();
    RECURRING_OCCURRENCE_LIFECYCLE.transition('SKIP', this.state.status, 'SKIPPED');
  }

  private assertNotResolved(): void {
    const status = this.state.status;
    if (status === 'MATERIALIZED' || status === 'MATCHED') {
      throw new DomainError(
        'OCCURRENCE_ALREADY_MATERIALIZED',
        `occurrence ${this.state.id} is already ${status}`,
      );
    }
  }

  private step(
    code: OccurrenceTransition,
    to: OccurrenceStatus,
    patch: Partial<Mutable<OccurrenceState>>,
  ): void {
    const from = this.state.status;
    RECURRING_OCCURRENCE_LIFECYCLE.transition(code, from, to);
    this.apply({ ...patch, status: to });
    this.mark(code, from, to);
  }

  private apply(patch: Partial<Mutable<OccurrenceState>>): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
  }

  private mark(transition: OccurrenceTransition, from: OccurrenceStatus | null, to: OccurrenceStatus): void {
    this.transition = { transition, from, to };
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
