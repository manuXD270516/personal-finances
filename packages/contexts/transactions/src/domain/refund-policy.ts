import { DomainError, type Money } from '@pf/shared-kernel';
import type { TransactionState } from './transaction.js';

/**
 * Reglas del reembolso vinculado (design.md decisión 8; FR-TRANSACTIONS-016): el original es un EXPENSE no anulado
 * del mismo workspace y moneda; Σ reembolsos vigentes + nuevo > monto vigente del original ⇒
 * `REFUND_EXCEEDS_ORIGINAL` salvo confirmación explícita (que se audita).
 */
export function assertRefundAllowed(input: {
  readonly original: TransactionState | null;
  readonly alreadyRefunded: Money;
  readonly amount: Money;
  readonly confirmExcess: boolean;
}): { readonly exceeds: boolean } {
  const { original, amount } = input;
  if (!original || original.kind !== 'EXPENSE' || original.status === 'VOIDED') {
    throw new DomainError('REFERENCE_NOT_FOUND', 'the refunded transaction must be an active EXPENSE').at(
      '/refundOfTransactionId',
    );
  }
  if (original.amount.currency.code !== amount.currency.code) {
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `the original expense is in ${original.amount.currency.code}, not ${amount.currency.code}`,
    ).at('/amount/currency');
  }
  const exceeds = input.alreadyRefunded.add(amount).compare(original.amount) > 0;
  if (exceeds && !input.confirmExcess) {
    throw new DomainError(
      'REFUND_EXCEEDS_ORIGINAL',
      `refunds would total ${input.alreadyRefunded.add(amount).toFixed()} over an expense of ${original.amount.toFixed()}`,
    ).at('/amount/amount');
  }
  return { exceeds };
}
