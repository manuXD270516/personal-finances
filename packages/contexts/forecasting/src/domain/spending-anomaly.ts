import { DomainError } from '@pf/shared-kernel';
import type { AnomalyReason } from './spending-anomaly-detector.js';

/**
 * Agregado `SpendingAnomaly` (openspec add-spending-anomaly-detection, decisión 8): un gasto atípico por transacción y
 * versión. `OPEN` → `DISMISSED` («no es atípico») y de vuelta (`RESTORE`); `SUPERSEDED` (terminal) cuando una versión
 * nueva de la transacción lo reemplaza. Descartar o restaurar repetido es inocuo: no cambia nada ni se audita.
 */
export const ANOMALY_STATUSES = ['OPEN', 'DISMISSED', 'SUPERSEDED'] as const;
export type SpendingAnomalyStatus = (typeof ANOMALY_STATUSES)[number];

export const DISMISS_REASONS = ['EXPECTED_ONE_OFF', 'NOT_UNUSUAL', 'OTHER'] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

export const MAX_DISMISS_NOTE_LENGTH = 200;

export interface AnomalyMoney {
  readonly amount: string;
  readonly currency: string;
}

export interface SpendingAnomalyState {
  readonly id: string;
  readonly workspaceId: string;
  readonly transactionId: string;
  readonly transactionVersion: number;
  /** Fecha de negocio `YYYY-MM-DD`. */
  readonly transactionDate: string;
  /** Monto del gasto en su moneda y en la de reporte (con la tasa de su fecha). */
  readonly amount: AnomalyMoney;
  readonly reportingAmount: AnomalyMoney;
  readonly categoryIds: readonly string[];
  readonly counterpartyId: string | null;
  readonly reasons: readonly AnomalyReason[];
  readonly status: SpendingAnomalyStatus;
  readonly dismissReason: DismissReason | null;
  readonly dismissNote: string | null;
  readonly detectedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly version: number;
}

export type AnomalyDecision = 'DISMISS' | 'RESTORE';

/** Cambios campo a campo de una decisión (para la auditoría; sin montos). */
export interface AnomalyDecisionResult {
  readonly changed: boolean;
  readonly changes: readonly { field: string; before: unknown; after: unknown }[];
}

export class SpendingAnomaly {
  private constructor(private state: SpendingAnomalyState) {}

  static detect(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly transactionId: string;
    readonly transactionVersion: number;
    readonly transactionDate: string;
    readonly amount: AnomalyMoney;
    readonly reportingAmount: AnomalyMoney;
    readonly categoryIds: readonly string[];
    readonly counterpartyId: string | null;
    readonly reasons: readonly AnomalyReason[];
    readonly at: string;
  }): SpendingAnomaly {
    if (input.reasons.length === 0) {
      throw new DomainError('VALIDATION_FAILED', 'a spending anomaly needs at least one reason');
    }
    return new SpendingAnomaly({
      id: input.id,
      workspaceId: input.workspaceId,
      transactionId: input.transactionId,
      transactionVersion: input.transactionVersion,
      transactionDate: input.transactionDate,
      amount: input.amount,
      reportingAmount: input.reportingAmount,
      categoryIds: input.categoryIds,
      counterpartyId: input.counterpartyId,
      reasons: input.reasons,
      status: 'OPEN',
      dismissReason: null,
      dismissNote: null,
      detectedAt: input.at,
      decidedAt: null,
      decidedBy: null,
      version: 1,
    });
  }

  static restore(state: SpendingAnomalyState): SpendingAnomaly {
    return new SpendingAnomaly({ ...state });
  }

  get snapshot(): SpendingAnomalyState {
    return this.state;
  }
  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get version(): number {
    return this.state.version;
  }

  /** «No es atípico»: `OPEN` → `DISMISSED`. Repetido es inocuo; uno `SUPERSEDED` no se puede decidir. */
  dismiss(input: {
    readonly actorId: string;
    readonly at: string;
    readonly reason?: DismissReason | undefined;
    readonly note?: string | undefined;
  }): AnomalyDecisionResult {
    this.assertDecidable();
    if (input.reason !== undefined && !DISMISS_REASONS.includes(input.reason)) {
      throw new DomainError('VALIDATION_FAILED', 'unknown dismiss reason').at('/reason');
    }
    const note = input.note?.trim() ? input.note.trim() : null;
    if (note !== null && note.length > MAX_DISMISS_NOTE_LENGTH) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `the note has at most ${MAX_DISMISS_NOTE_LENGTH} characters`,
      ).at('/note');
    }
    if (this.state.status === 'DISMISSED') return { changed: false, changes: [] };
    const next: SpendingAnomalyState = {
      ...this.state,
      status: 'DISMISSED',
      dismissReason: input.reason ?? null,
      dismissNote: note,
      decidedAt: input.at,
      decidedBy: input.actorId,
      version: this.state.version + 1,
    };
    const changes = [
      { field: 'status', before: this.state.status, after: next.status },
      { field: 'dismissReason', before: this.state.dismissReason, after: next.dismissReason },
    ];
    this.state = next;
    return { changed: true, changes };
  }

  /** `DISMISSED` → `OPEN`. Repetido es inocuo. */
  restoreOpen(input: { readonly actorId: string; readonly at: string }): AnomalyDecisionResult {
    this.assertDecidable();
    if (this.state.status === 'OPEN') return { changed: false, changes: [] };
    const next: SpendingAnomalyState = {
      ...this.state,
      status: 'OPEN',
      dismissReason: null,
      dismissNote: null,
      decidedAt: input.at,
      decidedBy: input.actorId,
      version: this.state.version + 1,
    };
    const changes = [
      { field: 'status', before: this.state.status, after: next.status },
      { field: 'dismissReason', before: this.state.dismissReason, after: null },
    ];
    this.state = next;
    return { changed: true, changes };
  }

  private assertDecidable(): void {
    if (this.state.status === 'SUPERSEDED') {
      throw new DomainError('RESOURCE_NOT_FOUND', 'the spending anomaly does not exist');
    }
  }
}
