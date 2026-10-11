import { DomainError, type Money } from '@pf/shared-kernel';
import type { AccountNature, TransactionState } from './transaction.js';

/** Destino de un posting en términos de dominio (la aplicación lo traduce al DTO de `@pf/ledger/contracts`). */
export type PostingTarget =
  | { readonly kind: 'USER_ACCOUNT'; readonly accountId: string; readonly nature: AccountNature }
  | { readonly kind: 'SYSTEM'; readonly systemKind: 'INCOME' | 'EXPENSE' | 'ADJUSTMENTS' | 'FX_TRADING' };

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
 *   LOAN_DISBURSEMENT +destino (neto), −pasivo del préstamo (principal), +EXPENSE:<CCY> por la comisión retenida
 *   LOAN_PAYMENT −origen (monto), +pasivo del préstamo (principal, omitido si es 0), +EXPENSE:<CCY> por split
 *   CONVERSION −origen (bruto), +EQUITY:FX_TRADING:<src> (convertido), −EQUITY:FX_TRADING:<tgt> (bruto destino),
 *              +destino (neto) y por cada fee −tercera cuenta (si la paga) y +EXPENSE:<fee.ccy> con su split *Fees*
 *              (add-manual-conversions decisión 1; docs/09 §6.12–§6.15). Cuadra POR MONEDA (INV-004).
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
  if (tx.kind === 'CONVERSION') {
    return {
      entryDate: tx.businessDate,
      sourceRef: { type: 'Transaction', id: tx.id, revision: tx.revision },
      memo: tx.description,
      postings: conversionPostings(tx),
    };
  }
  let nominal: PostingDraft[];
  if (tx.kind === 'ADJUSTMENT') {
    nominal = tx.legs.map((leg) => ({
      target: { kind: 'SYSTEM', systemKind: 'ADJUSTMENTS' },
      amount: leg.amount.negate(),
      splitId: null,
    }));
  } else if (tx.kind === 'TRANSFER' || tx.kind === 'LOAN_DISBURSEMENT' || tx.kind === 'LOAN_PAYMENT') {
    // +destino, −origen (incluye la comisión) y +EXPENSE:<CCY> por el split de comisión (docs/09 §6.4, §6.8).
    // Préstamos (docs/09 §6.9): los legs son los postings sobre cuentas del usuario y cada split es el gasto
    // (comisión retenida del desembolso; interés/cargos del pago); el principal no genera gasto (INV-009).
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

function conversionPostings(tx: TransactionState): PostingDraft[] {
  const d = tx.conversion;
  if (!d) throw new DomainError('INTERNAL_ERROR', `conversion ${tx.id} has no ConversionDetail`);
  const user = (role: 'SOURCE' | 'TARGET') => {
    const leg = tx.legs.find((l) => l.role === role);
    if (!leg) throw new DomainError('INTERNAL_ERROR', `conversion ${tx.id} has no ${role} leg`);
    return {
      target: { kind: 'USER_ACCOUNT', accountId: leg.accountId, nature: leg.nature },
      amount: leg.amount,
      splitId: null,
    } satisfies PostingDraft;
  };
  const fx = (amount: Money): PostingDraft => ({
    target: { kind: 'SYSTEM', systemKind: 'FX_TRADING' },
    amount,
    splitId: null,
  });
  const fees = d.fees.flatMap((f): PostingDraft[] => {
    const split = tx.splits.find((s) => s.id === f.splitId);
    if (!split) throw new DomainError('INTERNAL_ERROR', `fee ${f.feeNo} of ${tx.id} has no split`);
    const payer = f.paidFromAccountId
      ? tx.legs.find(
          (l) =>
            l.role === 'FEE' && l.accountId === f.paidFromAccountId && l.amount.equals(f.amount.negate()),
        )
      : undefined;
    return [
      ...(payer
        ? [
            {
              target: { kind: 'USER_ACCOUNT', accountId: payer.accountId, nature: payer.nature },
              amount: payer.amount,
              splitId: null,
            } satisfies PostingDraft,
          ]
        : []),
      { target: { kind: 'SYSTEM', systemKind: 'EXPENSE' }, amount: split.amount, splitId: split.id },
    ];
  });
  return [
    user('SOURCE'),
    fx(d.convertedSourceAmount),
    fx(d.grossTargetAmount.negate()),
    user('TARGET'),
    ...fees,
  ];
}
