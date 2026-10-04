import { DomainError } from '@pf/shared-kernel';
import { TRANSACTION_LIFECYCLE, type TransactionStatus } from './transaction-lifecycle.js';

export { TRANSACTION_STATUSES, type TransactionStatus } from './transaction-lifecycle.js';

/** ¿El estado tiene asiento activo en el ledger? (INV-023: PENDING y VOIDED nunca). */
export const hasActiveEntry = (status: TransactionStatus): boolean =>
  status === 'POSTED' || status === 'CLEARED' || status === 'RECONCILED';

/**
 * Transiciones de estado permitidas, DERIVADAS de la máquina declarada `TRANSACTION_LIFECYCLE` (add-lifecycle-timeline
 * decisión 1: una sola fuente). No cuentan `REVISE` (la revisión es una edición financiera, no un cambio de estado
 * pedido) ni `UNRECONCILE` (solo por `UnreconcileTransaction`, con motivo).
 */
export const canTransition = (from: TransactionStatus, to: TransactionStatus): boolean =>
  TRANSACTION_LIFECYCLE.canMove(from, to, { except: ['REVISE', 'UNRECONCILE', 'RECORD'] });

/**
 * Valida una transición de estado. `unreconcile` habilita la única salida de RECONCILED (→ CLEARED). Errores:
 * `TRANSACTION_RECONCILED` (409) si se intenta anular una reconciliada (D16: exige des-reconciliar);
 * `INVALID_STATUS_TRANSITION` (409) en el resto.
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
