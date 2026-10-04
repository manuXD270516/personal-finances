/**
 * Tipos del recorrido del ciclo de vida (contrato `finance-api.v1.yaml`: `Lifecycle`, `LifecycleTransition`,
 * `LifecycleAnnotation`, `LifecycleMachine`, `TransactionLifecycle`; openspec add-lifecycle-timeline).
 */
import type { Money, Rate } from '../common/types';

export type LifecycleAggregateType = 'Transaction' | 'Account' | 'ExchangeRate';

export interface LifecycleMachine {
  readonly aggregateType: string;
  readonly machineVersion: number;
  readonly states: readonly { readonly code: string; readonly terminal: boolean }[];
  readonly transitions: readonly {
    readonly code: string;
    /** Vacío = creación desde ∅. */
    readonly from: readonly string[];
    readonly to: readonly string[];
    readonly guard: string;
    readonly events: readonly string[];
  }[];
}

export interface LifecycleActor {
  readonly type: 'USER' | 'SYSTEM' | 'WORKER';
  /** userId (USER) o identificador del proceso (SYSTEM/WORKER). */
  readonly id: string | null;
  readonly displayName: string | null;
}

export interface LifecycleJournalEntries {
  readonly reversed: string | null;
  readonly reversal: string | null;
  readonly posted: string | null;
}

export interface LifecycleTransition {
  readonly sequence: number;
  readonly kind: 'TRANSITION';
  readonly transition: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly machineVersion: number;
  readonly occurredAt: string;
  readonly actor: LifecycleActor;
  readonly origin: string;
  readonly reason: string | null;
  readonly revisionFrom: number | null;
  readonly revisionTo: number | null;
  readonly aggregateVersion: number | null;
  readonly journalEntries: LifecycleJournalEntries;
  readonly detailRefs: Readonly<Record<string, string | number>>;
  readonly events: readonly string[];
  readonly auditLogId: string | null;
  readonly derived: boolean;
}

export interface LifecycleAnnotation {
  readonly sequence: number;
  readonly kind: 'ANNOTATION';
  readonly occurredAt: string;
  readonly actor: LifecycleActor;
  readonly origin: string;
  readonly changedFields: readonly string[];
  readonly revisionFrom: number | null;
  readonly revisionTo: number | null;
  readonly aggregateVersion: number | null;
  readonly events: readonly string[];
  readonly auditLogId: string | null;
  readonly derived: boolean;
}

export type LifecycleItem = LifecycleTransition | LifecycleAnnotation;

export interface Lifecycle {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly currentState: string | null;
  /** Estados visitados en orden (destino de cada transición). */
  readonly path: readonly string[];
  /** `false` si el recorrido no arranca en una creación (historia previa sin evidencia). */
  readonly historyComplete: boolean;
  readonly machine: LifecycleMachine;
  readonly items: readonly LifecycleItem[];
}

export interface LifecycleRevision {
  readonly revision: number;
  readonly amount: Money;
  readonly fee: Money | null;
  readonly legs: readonly {
    readonly accountId: string;
    readonly role: 'MAIN' | 'SOURCE' | 'TARGET' | 'FEE';
    readonly amount: Money;
  }[];
  readonly conversion: {
    readonly sourceAccountId: string;
    readonly targetAccountId: string;
    readonly sourceAmount: Money;
    readonly targetAmount: Money;
    readonly effectiveRate: Rate;
    readonly fees: readonly { readonly type: string; readonly amount: Money }[];
  } | null;
}

/** Recorrido de una transacción con los montos de cada revisión. */
export interface TransactionLifecycle extends Lifecycle {
  readonly revisions: readonly LifecycleRevision[];
}
