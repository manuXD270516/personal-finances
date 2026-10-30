import { DomainError } from '@pf/shared-kernel';

/**
 * `RevertPlan` (openspec add-import-pipeline, decisión 15; FR-IMPORTS-012): qué transacciones de un import se anulan,
 * cuáles ya estaban anuladas y cuáles están bloqueadas (reconciliadas o en un periodo cerrado). TODO O NADA por
 * omisión (D328): con bloqueadas y sin `allowPartial` se rechaza con `IMPORT_REVERT_BLOCKED` y la lista, sin anular
 * nada; con deshacer parcial explícito se anulan las demás. Dominio puro.
 */

export type BlockedReason = 'RECONCILED' | 'PERIOD_CLOSED';

export interface RevertCandidate {
  readonly rowId: string;
  readonly lineNumber: number;
  readonly transactionId: string;
  /** Estado de la transacción hoy. */
  readonly status: 'PENDING' | 'POSTED' | 'CLEARED' | 'RECONCILED' | 'VOIDED';
  /** El movimiento cae en un periodo financiero cerrado (INV-015). */
  readonly inClosedPeriod: boolean;
  /** El usuario editó la transacción después del import (informativo: igual se anula). */
  readonly editedAfterImport: boolean;
}

export interface BlockedItem {
  readonly rowId: string;
  readonly lineNumber: number;
  readonly transactionId: string;
  readonly reason: BlockedReason;
}

export interface RevertPlan {
  readonly toVoid: readonly RevertCandidate[];
  readonly alreadyVoided: readonly RevertCandidate[];
  readonly blocked: readonly BlockedItem[];
  readonly editedAfterImport: number;
}

export function planRevert(candidates: readonly RevertCandidate[]): RevertPlan {
  const toVoid: RevertCandidate[] = [];
  const alreadyVoided: RevertCandidate[] = [];
  const blocked: BlockedItem[] = [];
  for (const c of [...candidates].sort((a, b) => a.lineNumber - b.lineNumber)) {
    if (c.status === 'VOIDED') {
      alreadyVoided.push(c);
    } else if (c.status === 'RECONCILED') {
      blocked.push({
        rowId: c.rowId,
        lineNumber: c.lineNumber,
        transactionId: c.transactionId,
        reason: 'RECONCILED',
      });
    } else if (c.inClosedPeriod) {
      blocked.push({
        rowId: c.rowId,
        lineNumber: c.lineNumber,
        transactionId: c.transactionId,
        reason: 'PERIOD_CLOSED',
      });
    } else {
      toVoid.push(c);
    }
  }
  return {
    toVoid,
    alreadyVoided,
    blocked,
    editedAfterImport: toVoid.filter((c) => c.editedAfterImport).length,
  };
}

/** Decide si el plan se puede ejecutar: con bloqueadas y sin `allowPartial` ⇒ `IMPORT_REVERT_BLOCKED`. */
export function assertRevertAllowed(plan: RevertPlan, allowPartial: boolean): void {
  if (plan.blocked.length > 0 && !allowPartial) {
    throw new DomainError(
      'IMPORT_REVERT_BLOCKED',
      `${plan.blocked.length} transactions of the import cannot be voided`,
      { details: { blocked: plan.blocked } },
    );
  }
}
