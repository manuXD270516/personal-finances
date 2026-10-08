import { DomainError, type Money } from '@pf/shared-kernel';
import {
  RECONCILIATION_LIFECYCLE,
  type ReconciliationStatus,
  type ReconciliationTransition,
  type ReconciliationTransitionRecord,
} from './reconciliation-lifecycle.js';

export interface ReconciliationState {
  readonly id: string;
  readonly workspaceId: string;
  readonly accountId: string;
  /** Fecha del extracto (`YYYY-MM-DD`, zona del workspace). */
  readonly statementDate: string;
  /** Saldo del extracto en la moneda y escala de la cuenta (pasivos como deuda positiva). */
  readonly statementBalance: Money;
  readonly status: ReconciliationStatus;
  /** Congelado al completar (= extracto, tras el ajuste si lo hubo); `null` mientras está en curso. */
  readonly clearedBalance: Money | null;
  /** `0` al completar (CHECK de BD); `null` mientras está en curso. */
  readonly difference: Money | null;
  readonly adjustmentTransactionId: string | null;
  readonly startedBy: string;
  readonly startedAt: string | null;
  readonly completedBy: string | null;
  readonly completedAt: string | null;
  readonly cancelledBy: string | null;
  readonly cancelledAt: string | null;
  readonly version: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: string): boolean =>
  DATE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/**
 * Agregado `Reconciliation` (openspec add-reconciliation, design decisiones 2–4): sesión por cuenta contra el saldo de
 * un extracto a una fecha. NO mantiene una lista de candidatos: el conjunto incluido es "cleared de la cuenta con
 * fecha ≤ extracto" al finalizar. Cada cambio de estado se valida contra `RECONCILIATION_LIFECYCLE`.
 */
export class Reconciliation {
  private state: ReconciliationState;
  /** Versión leída de la BD (optimistic locking); `null` si es nueva. */
  readonly persistedVersion: number | null;
  private transitionRecord: ReconciliationTransitionRecord | null = null;

  private constructor(state: ReconciliationState, persistedVersion: number | null) {
    this.state = state;
    this.persistedVersion = persistedVersion;
    if (persistedVersion === null) this.mark('START', null, 'IN_PROGRESS');
  }

  static rehydrate(state: ReconciliationState): Reconciliation {
    return new Reconciliation(state, state.version);
  }

  /**
   * `StartReconciliation`: la fecha del extracto no puede ser futura (hoy en la zona del workspace) ni anterior o
   * igual a la de la última sesión completada (`RECONCILIATION_STATEMENT_DATE_INVALID`). Cuenta activa y "una sola
   * en curso" las valida la aplicación (necesitan datos de otros contextos y de la BD).
   */
  static start(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly accountId: string;
    readonly statementDate: string;
    readonly statementBalance: Money;
    readonly today: string;
    readonly lastCompletedStatementDate: string | null;
    readonly startedBy: string;
  }): Reconciliation {
    if (!validDate(input.statementDate)) {
      throw new DomainError('VALIDATION_FAILED', 'statementDate must be a valid YYYY-MM-DD date').at(
        '/statementDate',
      );
    }
    if (input.statementDate > input.today) {
      throw new DomainError(
        'RECONCILIATION_STATEMENT_DATE_INVALID',
        `the statement date ${input.statementDate} is in the future (today is ${input.today})`,
      ).at('/statementDate');
    }
    if (input.lastCompletedStatementDate && input.statementDate <= input.lastCompletedStatementDate) {
      throw new DomainError(
        'RECONCILIATION_STATEMENT_DATE_INVALID',
        `the statement date must be after the last completed one (${input.lastCompletedStatementDate})`,
      ).at('/statementDate');
    }
    return new Reconciliation(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        statementDate: input.statementDate,
        statementBalance: input.statementBalance,
        status: 'IN_PROGRESS',
        clearedBalance: null,
        difference: null,
        adjustmentTransactionId: null,
        startedBy: input.startedBy,
        startedAt: null,
        completedBy: null,
        completedAt: null,
        cancelledBy: null,
        cancelledAt: null,
        version: 1,
      },
      null,
    );
  }

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get status(): ReconciliationStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }
  get snapshot(): ReconciliationState {
    return this.state;
  }
  /** Transición registrada por el último comando (o `null` si no cambió el estado). */
  get lastTransition(): ReconciliationTransitionRecord | null {
    return this.transitionRecord;
  }

  /** Cambio dentro de la sesión (confirmar/desconfirmar): sube la versión para el bloqueo optimista. */
  touch(): void {
    this.assertInProgress('change');
    this.transitionRecord = null;
    this.bump({});
  }

  /**
   * `COMPLETE`: el saldo confirmado (tras el ajuste, si lo hubo) debe igualar al extracto: diferencia 0
   * (`RECONCILIATION_DIFFERENCE_NOT_ZERO` si no). El cálculo lo hace `ReconciliationCalculator`.
   */
  complete(input: {
    readonly clearedBalance: Money;
    readonly adjustmentTransactionId: string | null;
    readonly completedBy: string;
    readonly at: string;
  }): void {
    this.assertInProgress('complete');
    const difference = this.state.statementBalance.subtract(input.clearedBalance);
    if (!difference.isZero()) {
      throw new DomainError(
        'RECONCILIATION_DIFFERENCE_NOT_ZERO',
        `the difference is ${difference.toFixed()} ${difference.currency.code}, it must be 0`,
        { details: { difference: difference.toJSON() } },
      );
    }
    this.mark('COMPLETE', 'IN_PROGRESS', 'COMPLETED');
    this.bump({
      status: 'COMPLETED',
      clearedBalance: input.clearedBalance,
      difference,
      adjustmentTransactionId: input.adjustmentTransactionId,
      completedBy: input.completedBy,
      completedAt: input.at,
    });
  }

  /** `CANCEL`: las marcas `cleared` hechas durante la sesión se conservan (las gestiona la aplicación). */
  cancel(input: { readonly cancelledBy: string; readonly at: string }): void {
    this.assertInProgress('cancel');
    this.mark('CANCEL', 'IN_PROGRESS', 'CANCELLED');
    this.bump({ status: 'CANCELLED', cancelledBy: input.cancelledBy, cancelledAt: input.at });
  }

  private assertInProgress(action: string): void {
    if (this.state.status !== 'IN_PROGRESS') {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        `cannot ${action} a ${this.state.status} reconciliation`,
      );
    }
  }

  /** Valida el paso contra la máquina declarada y lo deja como `lastTransition`. */
  private mark(
    code: ReconciliationTransition,
    from: ReconciliationStatus | null,
    to: ReconciliationStatus,
  ): void {
    this.transitionRecord = RECONCILIATION_LIFECYCLE.transition(code, from, to);
  }

  private bump(patch: Partial<ReconciliationState>): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
  }
}
