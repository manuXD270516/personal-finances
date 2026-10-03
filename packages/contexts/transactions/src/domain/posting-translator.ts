import { DomainError, type Money } from '@pf/shared-kernel';
import type { AccountNature, TransactionState } from './transaction.js';

/** Destino de un posting en términos de dominio (la aplicación lo traduce al DTO de `@pf/ledger/contracts`). */
export type PostingTarget =
  | { readonly kind: 'USER_ACCOUNT'; readonly accountId: string; readonly nature: AccountNature }
  | { readonly kind: 'SYSTEM'; readonly systemKind: 'INCOME' | 'EXPENSE' | 'ADJUSTMENTS' };

export interface PostingDraft {
  readonly target: PostingTarget;
  /** Débito +, crédito − (FR-LEDGER-002). */
  readonly amount: Money;
  readonly splitId: string | null;
}

export interface JournalEntryDraft {
  readonly entryDate: string;
  readonly sourceRef: { readonly type: 'Transaction'; readonly id: string; readonly revision: number };
  readonly memo: string | null;
  readonly postings: readonly PostingDraft[];
}

/**
 * `TransactionPostingTranslator` (design.md decisión 3; docs/09 §6.1–§6.6), puro:
 *   INCOME     +cuenta, −INCOME:<CCY> por split
 *   EXPENSE    +EXPENSE:<CCY> por split, −cuenta
 *   REFUND     +cuenta, −EXPENSE:<CCY> por split (misma categoría del gasto, vía el split)
 *   ADJUSTMENT ±cuenta, ∓EQUITY:ADJUSTMENTS:<CCY>
 *   TRANSFER   +destino, −origen (monto + comisión), +EXPENSE:<CCY> por el split de comisión (sin INCOME/EXPENSE si
 *              no hay comisión: el pago de tarjeta no es gasto, INV-030)
 * Los legs son exactamente los postings sobre cuentas del usuario (INV-024) y el asiento cuadra por moneda (INV-004).
 * Fecha contable = fecha de negocio (decisión 1).
 */
export function toJournalEntryDraft(tx: TransactionState): JournalEntryDraft {
  if (tx.status === 'PENDING' || tx.status === 'VOIDED') {
    throw new DomainError('INVALID_STATUS_TRANSITION', `a ${tx.status} transaction is not posted (INV-023)`);
  }
  const userPostings: PostingDraft[] = tx.legs.map((leg) => ({
    target: { kind: 'USER_ACCOUNT', accountId: leg.accountId, nature: leg.nature },
    amount: leg.amount,
    splitId: null,
  }));
  let nominal: PostingDraft[];
  if (tx.kind === 'ADJUSTMENT') {
    nominal = tx.legs.map((leg) => ({
      target: { kind: 'SYSTEM', systemKind: 'ADJUSTMENTS' },
      amount: leg.amount.negate(),
      splitId: null,
    }));
  } else if (tx.kind === 'TRANSFER') {
    // +destino, −origen (incluye la comisión) y +EXPENSE:<CCY> por el split de comisión (docs/09 §6.4, §6.8).
    nominal = tx.splits.map((s) => ({
      target: { kind: 'SYSTEM', systemKind: 'EXPENSE' },
      amount: s.amount,
      splitId: s.id,
    }));
  } else {
    const systemKind = tx.kind === 'INCOME' ? 'INCOME' : 'EXPENSE';
    // El lado nominal es el opuesto del leg: INCOME/REFUND acreditan (−), EXPENSE debita (+).
    const sign = tx.kind === 'EXPENSE' ? 1 : -1;
    nominal = tx.splits.map((s) => ({
      target: { kind: 'SYSTEM', systemKind },
      amount: sign > 0 ? s.amount : s.amount.negate(),
      splitId: s.id,
    }));
  }
  return {
    entryDate: tx.businessDate,
    sourceRef: { type: 'Transaction', id: tx.id, revision: tx.revision },
    memo: tx.description,
    postings: tx.kind === 'EXPENSE' ? [...nominal, ...userPostings] : [...userPostings, ...nominal],
  };
}
