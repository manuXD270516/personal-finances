import { DomainError } from '@pf/shared-kernel';

/** Estados de una transacción (docs/04 §4.1, FR-TRANSACTIONS-006, INV-023). */
export const TRANSACTION_STATUSES = ['PENDING', 'POSTED', 'CLEARED', 'RECONCILED', 'VOIDED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/**
 * Transiciones permitidas (design.md decisión 4). `RECONCILED → CLEARED` solo por `UnreconcileTransaction` (con
 * motivo) y `RECONCILED → VOIDED` se rechaza con `TRANSACTION_RECONCILED` (docs/31 D16: exige des-reconciliar).
 */
const ALLOWED: Readonly<Record<TransactionStatus, readonly TransactionStatus[]>> = {
  PENDING: ['POSTED', 'VOIDED'],
  POSTED: ['CLEARED', 'VOIDED'],
  CLEARED: ['POSTED', 'RECONCILED', 'VOIDED'],
  RECONCILED: [],
  VOIDED: [],
};

/** ¿El estado tiene asiento activo en el ledger? (INV-023: PENDING y VOIDED nunca). */
export const hasActiveEntry = (status: TransactionStatus): boolean =>
  status === 'POSTED' || status === 'CLEARED' || status === 'RECONCILED';

export const canTransition = (from: TransactionStatus, to: TransactionStatus): boolean =>
  ALLOWED[from].includes(to);

/**
 * Valida una transición de estado. `unreconcile` habilita la única salida de RECONCILED (→ CLEARED). Errores:
 * `TRANSACTION_RECONCILED` (409) si se intenta anular una reconciliada; `INVALID_STATUS_TRANSITION` (409) en el resto.
 */
export function assertTransition(
  from: TransactionStatus,
  to: TransactionStatus,
  options: { readonly unreconcile?: boolean } = {},
): void {
  if (from === 'RECONCILED' && to === 'CLEARED' && options.unreconcile) return;
  if (from === 'RECONCILED' && to === 'VOIDED') {
    throw new DomainError(
      'TRANSACTION_RECONCILED',
      'a reconciled transaction must be un-reconciled before being voided',
    );
  }
  if (!canTransition(from, to)) {
    throw new DomainError('INVALID_STATUS_TRANSITION', `cannot move a transaction from ${from} to ${to}`);
  }
}
