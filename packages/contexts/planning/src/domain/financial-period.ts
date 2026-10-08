import { DomainError, LocalDate } from '@pf/shared-kernel';
import {
  FINANCIAL_PERIOD_LIFECYCLE,
  type FinancialPeriodStatus,
  type FinancialPeriodTransition,
  type FinancialPeriodTransitionRecord,
} from './financial-period-lifecycle.js';
import { assertStartDay, labelOf, type DateRange, type PlannedPeriod } from './period-calendar.js';

/** Estado persistible del agregado (fechas de negocio `YYYY-MM-DD`, instantes RFC 3339 UTC). */
export interface FinancialPeriodState {
  readonly id: string;
  readonly workspaceId: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly startDay: number;
  readonly isTransition: boolean;
  readonly status: FinancialPeriodStatus;
  readonly closeCount: number;
  readonly reopenCount: number;
  readonly latestCloseNo: number | null;
  readonly version: number;
  readonly createdAt: string | null;
  readonly activatedAt: string | null;
}

/** Guardas del cierre (decisión 4): periodo inmediatamente anterior (`null` si es el primero) y hoy en la zona del workspace. */
export interface CloseGuards {
  readonly previousStatus: FinancialPeriodStatus | null;
  readonly today: LocalDate;
}

/** Guardas de la reapertura: estado del periodo inmediatamente siguiente (`null` si no existe) y motivo. */
export interface ReopenGuards {
  readonly nextStatus: FinancialPeriodStatus | null;
  readonly reason: string;
}

/**
 * AR `FinancialPeriod` (PLANNING, docs/04 §3.6; decisiones 3, 4 y 9). Rango inclusivo de fechas de negocio con
 * etiqueta `YYYY-MM` única por workspace. Toda transición de estado se valida contra `FINANCIAL_PERIOD_LIFECYCLE`; el
 * rango solo cambia mientras el periodo es `DRAFT` (la BD lo refuerza con un trigger).
 */
export class FinancialPeriod {
  private transition: FinancialPeriodTransitionRecord | null = null;

  private constructor(
    private state: FinancialPeriodState,
    readonly persistedVersion: number,
  ) {}

  /** Creación (`CREATE`): `ACTIVE` si el periodo ya empezó (contiene hoy o terminó), `DRAFT` si es futuro. */
  static create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly planned: PlannedPeriod;
    readonly today: LocalDate;
    readonly at: string;
  }): FinancialPeriod {
    const { planned } = input;
    assertStartDay(planned.startDay);
    assertRange(planned.label, planned.range);
    const status: FinancialPeriodStatus = planned.range.start.compare(input.today) <= 0 ? 'ACTIVE' : 'DRAFT';
    const period = new FinancialPeriod(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        label: planned.label,
        periodStart: planned.range.start.toString(),
        periodEnd: planned.range.end.toString(),
        startDay: planned.startDay,
        isTransition: planned.isTransition,
        status,
        closeCount: 0,
        reopenCount: 0,
        latestCloseNo: null,
        version: 1,
        createdAt: input.at,
        activatedAt: status === 'ACTIVE' ? input.at : null,
      },
      0,
    );
    period.mark('CREATE', null, status);
    return period;
  }

  static restore(state: FinancialPeriodState): FinancialPeriod {
    return new FinancialPeriod({ ...state }, state.version);
  }

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get label(): string {
    return this.state.label;
  }
  get status(): FinancialPeriodStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }
  get range(): DateRange {
    return { start: LocalDate.parse(this.state.periodStart), end: LocalDate.parse(this.state.periodEnd) };
  }
  get snapshot(): FinancialPeriodState {
    return { ...this.state };
  }
  /** Último paso de la máquina aplicado en esta instancia (`null` si no cambió de estado). */
  get lastTransition(): FinancialPeriodTransitionRecord | null {
    return this.transition;
  }

  /** Marca derivada (docs/33 D60): terminado y no cerrado. Depende de hoy: nunca se persiste. */
  pendingClosure(today: LocalDate): boolean {
    return (this.status === 'ACTIVE' || this.status === 'REOPENED') && this.range.end.compare(today) < 0;
  }

  /**
   * `ACTIVATE` (automática o manual): solo un `DRAFT` (`INVALID_STATUS_TRANSITION`) cuya fecha de inicio ya llegó en
   * la zona del workspace (`PERIOD_NOT_STARTED`).
   */
  activate(today: LocalDate, at: string): void {
    FINANCIAL_PERIOD_LIFECYCLE.transition('ACTIVATE', this.status, 'ACTIVE');
    if (this.range.start.compare(today) > 0) {
      throw new DomainError(
        'PERIOD_NOT_STARTED',
        `period ${this.label} starts on ${this.state.periodStart}, after ${today.toString()}`,
      );
    }
    this.apply({ status: 'ACTIVE', activatedAt: at });
    this.mark('ACTIVATE', 'DRAFT', 'ACTIVE');
  }

  /**
   * `CLOSE` (add-month-closing decisión 4). Orden de las guardas: estado (`INVALID_STATUS_TRANSITION`) → periodo
   * anterior cerrado (`PERIOD_PREVIOUS_NOT_CLOSED`; el primero del workspace no tiene anterior) → terminado en la zona
   * del workspace (`PERIOD_NOT_ENDED`: el fin debe ser anterior a hoy, RISK-020). La versión del snapshot es
   * `closeCount + 1` (re-cierre = n+1).
   */
  close(_at: string, guards: CloseGuards): number {
    const from = this.status;
    FINANCIAL_PERIOD_LIFECYCLE.transition('CLOSE', from, 'CLOSED');
    if (guards.previousStatus !== null && guards.previousStatus !== 'CLOSED') {
      throw new DomainError(
        'PERIOD_PREVIOUS_NOT_CLOSED',
        `the previous period is ${guards.previousStatus}: periods close in chronological order`,
      );
    }
    if (this.range.end.compare(guards.today) >= 0) {
      throw new DomainError(
        'PERIOD_NOT_ENDED',
        `period ${this.label} ends on ${this.state.periodEnd}, which is not before ${guards.today.toString()}`,
      );
    }
    const closeNo = this.state.closeCount + 1;
    this.apply({ status: 'CLOSED', closeCount: closeNo, latestCloseNo: closeNo });
    this.mark('CLOSE', from, 'CLOSED');
    return closeNo;
  }

  /**
   * `REOPEN` (add-month-closing decisión 4): solo un periodo `CLOSED` (`INVALID_STATUS_TRANSITION`), con motivo de 1 a
   * 500 caracteres (`VALIDATION_FAILED`) y sin que el siguiente esté `CLOSED` (`PERIOD_NEXT_CLOSED`, sin cascada).
   * Devuelve el número de reapertura. El rol OWNER lo exige el guard HTTP.
   */
  reopen(_at: string, guards: ReopenGuards): number {
    const reason = guards.reason.trim();
    FINANCIAL_PERIOD_LIFECYCLE.transition('REOPEN', this.status, 'REOPENED');
    if (reason.length < 1 || reason.length > 500) {
      throw new DomainError('VALIDATION_FAILED', 'reason must have between 1 and 500 characters').at(
        '/reason',
      );
    }
    if (guards.nextStatus === 'CLOSED') {
      throw new DomainError(
        'PERIOD_NEXT_CLOSED',
        'the next period is closed: reopen periods in reverse chronological order',
      );
    }
    const reopenNo = this.state.reopenCount + 1;
    this.apply({ status: 'REOPENED', reopenCount: reopenNo });
    this.mark('REOPEN', 'CLOSED', 'REOPENED');
    return reopenNo;
  }

  /**
   * Recálculo de un `DRAFT` por cambio del día de inicio (decisión 9): conserva `id` y `label` (los planes de pf-p2b
   * siguen colgando del mismo periodo). Devuelve el rango anterior. Fuera de `DRAFT` ⇒ `INVALID_STATUS_TRANSITION`.
   */
  reschedule(planned: PlannedPeriod): DateRange {
    if (this.status !== 'DRAFT') {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        `FinancialPeriod: the range of a ${this.status} period is frozen`,
      );
    }
    if (planned.label !== this.label) {
      throw new DomainError('VALIDATION_FAILED', `rescheduling ${this.label} cannot change its label`);
    }
    assertStartDay(planned.startDay);
    assertRange(planned.label, planned.range);
    const before = this.range;
    this.apply({
      periodStart: planned.range.start.toString(),
      periodEnd: planned.range.end.toString(),
      startDay: planned.startDay,
      isTransition: planned.isTransition,
    });
    return before;
  }

  private apply(changes: Partial<FinancialPeriodState>): void {
    this.state = { ...this.state, ...changes, version: this.state.version + 1 };
  }

  private mark(
    transition: FinancialPeriodTransition,
    from: FinancialPeriodStatus | null,
    to: FinancialPeriodStatus,
  ): void {
    this.transition = FINANCIAL_PERIOD_LIFECYCLE.transition(transition, from, to);
  }
}

function assertRange(label: string, range: DateRange): void {
  if (range.start.compare(range.end) > 0 || labelOf(range.start) !== label) {
    throw new DomainError('VALIDATION_FAILED', `invalid range for period ${label}`);
  }
}
