import { Money, type Currency, type LocalDate } from '@pf/shared-kernel';
import type { JournalEntry } from './journal-entry.js';
import type { AccountNature } from './ledger-account.js';

/**
 * DS `BalanceCalculator` (docs/09 §8, design.md §Decisiones 8): el saldo contable es la suma con signo de los
 * postings (INV-022); el saldo presentado lo invierte para las naturalezas acreedoras.
 */
export const BalanceCalculator = {
  /** Σ postings de la cuenta con `entryDate ≤ asOf` (todas si `asOf` se omite). */
  balance(
    entries: readonly JournalEntry[],
    ledgerAccountId: string,
    currency: Currency,
    asOf?: LocalDate,
  ): Money {
    let total = Money.zero(currency);
    for (const e of entries) {
      if (asOf && asOf.compare(e.entryDate) < 0) continue;
      for (const p of e.postings) if (p.account.id === ledgerAccountId) total = total.add(p.amount);
    }
    return total;
  },

  /** Saldo presentado: `ASSET`/`EXPENSE` tal cual; `LIABILITY`/`EQUITY`/`INCOME` negado (FR-LEDGER-012). */
  presented(nature: AccountNature, accountingBalance: Money): Money {
    return nature === 'ASSET' || nature === 'EXPENSE' ? accountingBalance : accountingBalance.negate();
  },

  /** Balance de comprobación: Σ de todos los postings por moneda (debe ser 0 en cada una, INV-004). */
  trialBalance(entries: readonly JournalEntry[]): Map<string, Money> {
    const totals = new Map<string, Money>();
    for (const e of entries) {
      for (const p of e.postings) {
        const prev = totals.get(p.amount.currency.code);
        totals.set(p.amount.currency.code, prev ? prev.add(p.amount) : p.amount);
      }
    }
    return totals;
  },
};
