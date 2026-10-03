import { type DomainError, LocalDate } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { BalanceCalculator } from './balance-calculator.js';
import { BOB, entry, id, line, OPEN, systemAccount, USDT, userAccount } from './fixtures.test-support.js';
import { JournalEntry } from './journal-entry.js';
import { ReversalFactory } from './reversal-factory.js';

const reversal = (e: JournalEntry, date = '2026-03-20') => ({
  id: id(),
  entryDate: LocalDate.parse(date),
  postingIds: e.postings.map(() => id()),
  memo: 'corrección',
  correlationId: null,
  createdBy: null,
});

describe('ReversalFactory (correcciones por reversa)', () => {
  it('[TC-LEDGER-REVERSAL-001] la reversa de un gasto niega exactamente y el saldo vuelve a 1000.00 BOB', () => {
    const bankA = userAccount('ASSET', BOB);
    const expense = systemAccount('EXPENSE', BOB);
    const s1 = id();
    const opening = JournalEntry.post(
      entry([line(bankA, '1000.00'), line(systemAccount('OPENING_BALANCE', BOB), '-1000.00')], {
        entryType: 'OPENING',
        entryDate: LocalDate.parse('2026-01-01'),
      }),
      OPEN,
    );
    const e1 = JournalEntry.post(entry([line(expense, '120.00', s1), line(bankA, '-120.00')]), OPEN);
    const r1 = ReversalFactory.reverse(e1, reversal(e1), OPEN);
    expect(r1.entryType).toBe('REVERSAL');
    expect(r1.reversesEntryId).toBe(e1.id);
    expect(r1.sourceRef).toEqual(e1.sourceRef);
    expect(r1.entryDate.toString()).toBe('2026-03-20');
    expect(r1.postings.map((p) => [p.account.id, p.amount.toFixed(), p.splitId])).toEqual([
      [expense.id, '-120.00', s1],
      [bankA.id, '120.00', null],
    ]);
    expect(e1.postings.map((p) => p.amount.toFixed())).toEqual(['120.00', '-120.00']);
    expect(BalanceCalculator.balance([opening, e1, r1], bankA.id, BOB).toFixed()).toBe('1000.00');
  });

  it('[TC-LEDGER-REVERSAL-001] la reversa de una conversión multi-moneda niega cada posting en las mismas cuentas', () => {
    const e = JournalEntry.post(
      entry([
        line(userAccount('ASSET', USDT), '-100.000000'),
        line(systemAccount('FX_TRADING', USDT), '100.000000'),
        line(systemAccount('FX_TRADING', BOB), '-690.00'),
        line(userAccount('ASSET', BOB), '685.00'),
        line(systemAccount('EXPENSE', BOB), '5.00', id()),
      ]),
      OPEN,
    );
    const r = ReversalFactory.reverse(e, reversal(e), OPEN);
    expect(r.postings.map((p) => p.amount.toString())).toEqual([
      '100.000000 USDT',
      '-100.000000 USDT',
      '690.00 BOB',
      '-685.00 BOB',
      '-5.00 BOB',
    ]);
  });

  it('[TC-LEDGER-REVERSAL-002] (dominio) una reversa no es reversible y la fecha en periodo cerrado se rechaza', () => {
    const e = JournalEntry.post(
      entry([line(systemAccount('EXPENSE', BOB), '45.00', id()), line(userAccount('ASSET', BOB), '-45.00')]),
      OPEN,
    );
    const r = ReversalFactory.reverse(e, reversal(e), OPEN);
    const codeOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return (err as DomainError).code;
      }
      return undefined;
    };
    expect(codeOf(() => ReversalFactory.reverse(r, reversal(r), OPEN))).toBe('LEDGER_ENTRY_NOT_REVERSIBLE');
    expect(codeOf(() => ReversalFactory.reverse(e, reversal(e, '2026-08-10'), { periodLocked: true }))).toBe(
      'PERIOD_CLOSED',
    );
    expect(codeOf(() => ReversalFactory.reverse(e, { ...reversal(e), postingIds: [id()] }, OPEN))).toBe(
      'INTERNAL_ERROR',
    );
  });
});
