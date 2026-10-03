import { LocalDate } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { BalanceCalculator } from './balance-calculator.js';
import { BOB, entry, id, line, OPEN, systemAccount, userAccount } from './fixtures.test-support.js';
import { JournalEntry } from './journal-entry.js';

describe('BalanceCalculator (ledger/balances)', () => {
  it('[TC-LEDGER-BALANCES-004] saldo contable y presentado según la naturaleza', () => {
    const visa = userAccount('LIABILITY', BOB);
    const income = systemAccount('INCOME', BOB);
    const bankA = userAccount('ASSET', BOB);
    const expense = systemAccount('EXPENSE', BOB);
    const entries = [
      JournalEntry.post(entry([line(expense, '2000.00', id()), line(visa, '-2000.00')]), OPEN),
      JournalEntry.post(entry([line(bankA, '8012.34'), line(income, '-8012.34', id())]), OPEN),
      JournalEntry.post(entry([line(expense, '7416.84', id()), line(bankA, '-7416.84')]), OPEN),
    ];
    const show = (acc: typeof visa) => {
      const b = BalanceCalculator.balance(entries, acc.id, BOB);
      return [b.toFixed(), BalanceCalculator.presented(acc.nature, b).toFixed()];
    };
    expect(show(visa)).toEqual(['-2000.00', '2000.00']);
    expect(show(income)).toEqual(['-8012.34', '8012.34']);
    expect(show(bankA)).toEqual(['595.50', '595.50']);
    expect(show(expense)).toEqual(['9416.84', '9416.84']);
    expect(
      BalanceCalculator.presented('EQUITY', BalanceCalculator.balance(entries, expense.id, BOB)).toFixed(),
    ).toBe('-9416.84');
    expect([...BalanceCalculator.trialBalance(entries).values()].map((t) => t.toFixed())).toEqual(['0.00']);
  });

  it('[TC-LEDGER-BALANCES-001] (dominio) saldo a una fecha: solo postings con entryDate ≤ asOf', () => {
    const bankA = userAccount('ASSET', BOB);
    const opening = systemAccount('OPENING_BALANCE', BOB);
    const expense = systemAccount('EXPENSE', BOB);
    const entries = [
      JournalEntry.post(
        entry([line(bankA, '1000.00'), line(opening, '-1000.00')], {
          entryDate: LocalDate.parse('2026-01-01'),
          entryType: 'OPENING',
        }),
        OPEN,
      ),
      JournalEntry.post(
        entry([line(expense, '120.00', id()), line(bankA, '-120.00')], {
          entryDate: LocalDate.parse('2026-02-01'),
        }),
        OPEN,
      ),
    ];
    expect(BalanceCalculator.balance(entries, bankA.id, BOB, LocalDate.parse('2026-01-31')).toFixed()).toBe(
      '1000.00',
    );
    expect(BalanceCalculator.balance(entries, bankA.id, BOB, LocalDate.parse('2026-02-01')).toFixed()).toBe(
      '880.00',
    );
    expect(BalanceCalculator.balance(entries, bankA.id, BOB).toFixed()).toBe('880.00');
  });
});
