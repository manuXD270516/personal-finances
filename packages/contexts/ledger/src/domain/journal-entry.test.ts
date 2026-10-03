import { DomainError, LocalDate, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { BalanceCalculator } from './balance-calculator.js';
import {
  BOB,
  entry,
  id,
  line,
  m,
  OPEN,
  systemAccount,
  USD,
  USDT,
  userAccount,
  W2,
} from './fixtures.test-support.js';
import { JournalEntry, UnbalancedEntryError, type JournalEntryInput } from './journal-entry.js';
import { type LedgerAccount } from './ledger-account.js';
import { YearMonth } from './period.js';

function rejection(input: JournalEntryInput, periodLocked = false): DomainError {
  try {
    JournalEntry.post(input, { periodLocked });
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error('se esperaba un rechazo');
}

const bankA = userAccount('ASSET', BOB);
const usdSavings = userAccount('ASSET', USD);
const expenseBob = systemAccount('EXPENSE', BOB);

describe('JournalEntry + EntryValidator (ledger/journal-posting)', () => {
  it('[TC-LEDGER-BALANCE-001] rechaza un asiento desbalanceado por moneda con el residuo de cada moneda', () => {
    const crossCurrency = rejection(entry([line(usdSavings, '100.00'), line(bankA, '-690.00')]));
    expect(crossCurrency.code).toBe('LEDGER_UNBALANCED_ENTRY');
    expect((crossCurrency as UnbalancedEntryError).residues.map((r) => r.toString())).toEqual([
      '100.00 USD',
      '-690.00 BOB',
    ]);

    const oneCent = rejection(entry([line(expenseBob, '100.00', id()), line(bankA, '-99.99')]));
    expect(oneCent).toBeInstanceOf(UnbalancedEntryError);
    expect((oneCent as UnbalancedEntryError).residues.map((r) => r.toString())).toEqual(['0.01 BOB']);
    expect(oneCent.message).toContain('+0.01 BOB');
  });

  it('[TC-LEDGER-BALANCE-001] acepta la conversión USDT→BOB balanceada por moneda (sin conversión implícita)', () => {
    const binance = userAccount('ASSET', USDT);
    const e = JournalEntry.post(
      entry([
        line(binance, '-100.000000'),
        line(systemAccount('FX_TRADING', USDT), '100.000000'),
        line(systemAccount('FX_TRADING', BOB), '-690.00'),
        line(bankA, '685.00'),
        line(expenseBob, '5.00', id()),
      ]),
      OPEN,
    );
    expect([...e.totalsByCurrency().values()].every((t) => t.isZero())).toBe(true);
    expect(e.postings.map((p) => p.lineNo)).toEqual([1, 2, 3, 4, 5]);
    expect(e.sequence).toBeNull();
    expect(Object.isFrozen(e) && Object.isFrozen(e.postings) && Object.isFrozen(e.postings[0])).toBe(true);
  });

  it('[TC-LEDGER-STRUCTURE-001] menos de dos postings o un posting en cero se rechazan', () => {
    expect(rejection(entry([line(expenseBob, '150.00', id())])).code).toBe('LEDGER_ENTRY_TOO_FEW_POSTINGS');
    expect(rejection(entry([])).code).toBe('LEDGER_ENTRY_TOO_FEW_POSTINGS');
    const cash = userAccount('ASSET', BOB);
    expect(
      rejection(
        entry([
          line(expenseBob, '150.00', id()),
          line(cash, '-150.00'),
          line(systemAccount('ADJUSTMENTS', BOB), '0.00'),
        ]),
      ).code,
    ).toBe('LEDGER_ZERO_AMOUNT_POSTING');
  });

  it('[TC-LEDGER-CURRENCY-001] posting en USD contra una cuenta contable en BOB → CURRENCY_MISMATCH', () => {
    const err = rejection(
      entry([
        { id: id(), account: bankA, amount: m('20.00', USD), splitId: null },
        line(usdSavings, '-20.00'),
      ]),
    );
    expect(err.code).toBe('CURRENCY_MISMATCH');
  });

  it('[TC-LEDGER-SPLITREF-001] los postings nominales exigen split; el resto no', () => {
    const [s1, s2, s3] = [id(), id(), id()];
    const e = JournalEntry.post(
      entry([
        line(expenseBob, '220.00', s1),
        line(expenseBob, '50.00', s2),
        line(expenseBob, '30.00', s3),
        line(bankA, '-300.00'),
      ]),
      OPEN,
    );
    expect(e.postings.map((p) => p.splitId)).toEqual([s1, s2, s3, null]);
    expect(rejection(entry([line(expenseBob, '15.00'), line(bankA, '-15.00')])).code).toBe(
      'LEDGER_SPLIT_REQUIRED',
    );
    expect(rejection(entry([line(systemAccount('INCOME', BOB), '-15.00'), line(bankA, '15.00')])).code).toBe(
      'LEDGER_SPLIT_REQUIRED',
    );
  });

  it('[TC-LEDGER-SIGN-001] débito positivo / crédito negativo: gasto en efectivo y compra con tarjeta', () => {
    const cash = userAccount('ASSET', BOB);
    const visa = userAccount('LIABILITY', BOB);
    const opening = systemAccount('OPENING_BALANCE', BOB);
    const entries = [
      JournalEntry.post(
        entry([line(cash, '500.00'), line(opening, '-500.00')], { entryType: 'OPENING' }),
        OPEN,
      ),
      JournalEntry.post(entry([line(expenseBob, '150.00', id()), line(cash, '-150.00')]), OPEN),
      JournalEntry.post(entry([line(expenseBob, '350.00', id()), line(visa, '-350.00')]), OPEN),
    ];
    expect(BalanceCalculator.balance(entries, cash.id, BOB).toFixed()).toBe('350.00');
    expect(BalanceCalculator.balance(entries, visa.id, BOB).toFixed()).toBe('-350.00');
    expect(BalanceCalculator.balance(entries, expenseBob.id, BOB).toFixed()).toBe('500.00');
    for (const e of entries) expect(e.totalsByCurrency().get('BOB')!.isZero()).toBe(true);
  });

  it('[TC-LEDGER-PERIOD-001] (dominio) una fecha en un periodo bloqueado → PERIOD_CLOSED; fuera, se acepta', () => {
    const august = YearMonth.parse('2026-08');
    const expense = (date: string) =>
      entry([line(expenseBob, '45.00', id()), line(bankA, '-45.00')], { entryDate: LocalDate.parse(date) });
    const locked = (date: string) => august.contains(LocalDate.parse(date));
    expect(rejection(expense('2026-08-15'), locked('2026-08-15')).code).toBe('PERIOD_CLOSED');
    expect(rejection(expense('2026-08-31'), locked('2026-08-31')).code).toBe('PERIOD_CLOSED');
    expect(
      JournalEntry.post(expense('2026-09-01'), { periodLocked: locked('2026-09-01') }).entryDate.toString(),
    ).toBe('2026-09-01');
    expect(locked('2026-07-31')).toBe(false);
    expect(YearMonth.of(LocalDate.parse('2025-12-31')).toString()).toBe('2025-12');
    expect(() => YearMonth.parse('2026-13')).toThrow(DomainError);
  });

  it('[TC-LEDGER-ISOLATION-001] (dominio) una cuenta contable de otro workspace no existe → REFERENCE_NOT_FOUND', () => {
    const bankAW2 = userAccount('ASSET', BOB, W2);
    expect(rejection(entry([line(expenseBob, '10.00', id()), line(bankAW2, '-10.00')])).code).toBe(
      'REFERENCE_NOT_FOUND',
    );
  });

  it('valida el orden de errores y la coherencia REVERSAL ⇔ reversesEntryId', () => {
    // escala de la cuenta antes que moneda; la escala de Money ya impide el exceso con su propia moneda
    expect(rejection(entry([line(expenseBob, '1.00'), line(bankA, '1.00')])).code).toBe(
      'LEDGER_SPLIT_REQUIRED',
    );
    expect(
      rejection(entry([line(expenseBob, '1.00', id()), line(bankA, '-1.00')], { entryType: 'REVERSAL' }))
        .code,
    ).toBe('INTERNAL_ERROR');
    const ok = entry([line(expenseBob, '1.00', id()), line(bankA, '-1.00')]);
    expect(JournalEntry.restore(ok, '7').sequence).toBe('7');
    expect(() => JournalEntry.restore(entry([line(bankA, '1.00')]), '8')).toThrow(
      /LEDGER_ENTRY_TOO_FEW_POSTINGS/,
    );
    const e = JournalEntry.post(ok, OPEN);
    expect(e.withSequence('9').sequence).toBe('9');
    expect(
      Money.sum(
        e.postings.map((p) => p.amount),
        BOB,
      ).isZero(),
    ).toBe(true);
    const ccyScale4 = { ...bankA, currency: { code: 'BOB', scale: 1 } } as unknown as LedgerAccount;
    expect(
      rejection(entry([line(expenseBob, '1.05', id()), { ...line(bankA, '-1.05'), account: ccyScale4 }]))
        .code,
    ).toBe('AMOUNT_SCALE_EXCEEDED');
  });
});
