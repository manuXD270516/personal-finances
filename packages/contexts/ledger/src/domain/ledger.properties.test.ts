import { DomainError, LocalDate, Money, MoneyDecimal, type Currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BalanceCalculator } from './balance-calculator.js';
import {
  BOB,
  entry,
  id,
  line,
  OPEN,
  systemAccount,
  USD,
  USDT,
  userAccount,
} from './fixtures.test-support.js';
import { JournalEntry, type PostingInput } from './journal-entry.js';
import { isNominal, type LedgerAccount } from './ledger-account.js';
import { ReversalFactory } from './reversal-factory.js';

/** 100 corridas por PR; `NIGHTLY=1` → 10 000 (Financial Regression Suite). Semilla fija en PR. */
const NIGHTLY = Boolean(process.env.NIGHTLY);
const runs = { numRuns: NIGHTLY ? 10_000 : 100, ...(NIGHTLY ? {} : { seed: 20261003 }) };

const CURRENCIES = [BOB, USD, USDT] as const;
/** Plan de cuentas fijo por moneda: dos activos, un pasivo y las cuentas de sistema. */
const chart = new Map<string, LedgerAccount[]>(
  CURRENCIES.map((c) => [
    c.code,
    [
      userAccount('ASSET', c),
      userAccount('ASSET', c),
      userAccount('LIABILITY', c),
      systemAccount('INCOME', c),
      systemAccount('EXPENSE', c),
      systemAccount('OPENING_BALANCE', c),
      systemAccount('FX_TRADING', c),
    ],
  ]),
);

const arbNonZero = (c: Currency): fc.Arbitrary<Money> =>
  fc
    .bigInt({ min: -(10n ** 12n), max: 10n ** 12n })
    .filter((u) => u !== 0n)
    .map((u) => Money.ofMinorUnits(u, c));

/** Postings balanceados en una moneda: n-1 montos aleatorios y el último cierra en cero. */
const arbBalancedLeg = (c: Currency): fc.Arbitrary<PostingInput[]> =>
  fc
    .tuple(
      fc.array(fc.tuple(fc.nat({ max: 6 }), arbNonZero(c)), { minLength: 1, maxLength: 4 }),
      fc.nat({ max: 6 }),
    )
    .filter(
      ([legs]) =>
        !Money.sum(
          legs.map(([, a]) => a),
          c,
        ).isZero(),
    )
    .map(([legs, last]) => {
      const accounts = chart.get(c.code)!;
      const lines = legs.map(([i, a]) => toPosting(accounts[i]!, a));
      lines.push(
        toPosting(
          accounts[last]!,
          Money.sum(
            legs.map(([, a]) => a),
            c,
          ).negate(),
        ),
      );
      return lines;
    });

const toPosting = (account: LedgerAccount, amount: Money): PostingInput => ({
  id: id(),
  account,
  amount,
  splitId: isNominal(account.nature) ? id() : null,
});

/** Asiento balanceado de 1 a 3 monedas (como una conversión). */
const arbBalancedEntry = fc
  .subarray([...CURRENCIES], { minLength: 1 })
  .chain((cs) => fc.tuple(...cs.map(arbBalancedLeg)))
  .map((legs) => legs.flat());

/** Desbalancea el asiento sumando una unidad menor al primer posting. */
const unbalance = (postings: PostingInput[]): PostingInput[] => {
  const [first, ...rest] = postings;
  const bumped = first!.amount.add(Money.ofMinorUnits(1n, first!.amount.currency));
  return bumped.isZero()
    ? [{ ...first!, amount: first!.amount.add(Money.ofMinorUnits(-1n, first!.amount.currency)) }, ...rest]
    : [{ ...first!, amount: bumped }, ...rest];
};

const isRealAccount = (a: LedgerAccount) => a.nature === 'ASSET' || a.nature === 'LIABILITY';

describe('Propiedades del ledger en memoria (fast-check)', () => {
  it('[TC-LEDGER-BALANCE-003] balance de comprobación en cero por moneda después de cada paso (INV-004)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(arbBalancedEntry, fc.boolean()), { minLength: 1, maxLength: 15 }),
        (steps) => {
          const ledger: JournalEntry[] = [];
          for (const [postings, corrupt] of steps) {
            const realBefore = realTotals(ledger);
            const input = entry(corrupt ? unbalance(postings) : postings);
            if (corrupt) {
              expect(() => JournalEntry.post(input, OPEN)).toThrow(DomainError);
              expect(realTotals(ledger)).toEqual(realBefore);
            } else {
              ledger.push(JournalEntry.post(input, OPEN));
            }
            for (const total of BalanceCalculator.trialBalance(ledger).values())
              expect(total.isZero()).toBe(true);
            // ASSET + LIABILITY solo cambia si el asiento toca INCOME/EXPENSE/EQUITY
            if (!corrupt && postings.every((p) => isRealAccount(p.account as LedgerAccount))) {
              expect(realTotals(ledger)).toEqual(realBefore);
            }
          }
        },
      ),
      runs,
    );
  });

  it('[TC-LEDGER-REVERSAL-003] reverse(e) es exacto: balanceado, mismas cuentas/splits y Σ e + Σ r = 0 (INV-008)', () => {
    fc.assert(
      fc.property(arbBalancedEntry, (postings) => {
        const e = JournalEntry.post(entry(postings), OPEN);
        const r = ReversalFactory.reverse(e, reversalInput(e), OPEN);
        expect(r.entryType).toBe('REVERSAL');
        expect(r.reversesEntryId).toBe(e.id);
        expect(r.postings).toHaveLength(e.postings.length);
        r.postings.forEach((p, i) => {
          const o = e.postings[i]!;
          expect([p.account.id, p.splitId, p.lineNo]).toEqual([o.account.id, o.splitId, o.lineNo]);
          expect(p.amount.add(o.amount).isZero()).toBe(true);
        });
        for (const t of r.totalsByCurrency().values()) expect(t.isZero()).toBe(true);
        expect(() => ReversalFactory.reverse(r, reversalInput(r), OPEN)).toThrow(/reversal/);
      }),
      runs,
    );
  });

  it('[TC-LEDGER-VALUATION-001] identidad de valoración con tasas aleatorias a precisión 40 (INV-031)', () => {
    const arbRate = fc
      .bigInt({ min: 1n, max: 10n ** 12n })
      .map((u) => new MoneyDecimal(u.toString()).div(1e6));
    fc.assert(
      fc.property(
        fc.array(arbBalancedEntry, { minLength: 1, maxLength: 10 }),
        fc.tuple(arbRate, arbRate),
        (entriesPostings, [usdRate, usdtRate]) => {
          const ledger = entriesPostings.map((p) => JournalEntry.post(entry(p), OPEN));
          const rateOf = (c: string) =>
            c === 'BOB' ? new MoneyDecimal(1) : c === 'USD' ? usdRate : usdtRate;
          let real = new MoneyDecimal(0);
          let nominalAndEquity = new MoneyDecimal(0);
          for (const e of ledger) {
            for (const p of e.postings) {
              const valued = p.amount.toDecimal().times(rateOf(p.amount.currency.code));
              if (isRealAccount(p.account as LedgerAccount)) real = real.plus(valued);
              else nominalAndEquity = nominalAndEquity.plus(valued);
            }
          }
          // Σ valorizado = 0 a precisión 40 (tolerancia relativa al último dígito significativo)
          const scale = real.abs().plus(1);
          expect(real.plus(nominalAndEquity).abs().lte(scale.times('1e-36'))).toBe(true);
        },
      ),
      runs,
    );
  });

  it('[TC-LEDGER-VALUATION-001] ejemplo: patrimonio neto 10685.00 BOB = −(EQUITY + INCOME + EXPENSE) a 6.95', () => {
    const bankA = userAccount('ASSET', BOB);
    const binance = userAccount('ASSET', USDT);
    const obBob = systemAccount('OPENING_BALANCE', BOB);
    const obUsdt = systemAccount('OPENING_BALANCE', USDT);
    const opening = { entryType: 'OPENING', entryDate: LocalDate.parse('2026-01-01') } as const;
    const ledger = [
      JournalEntry.post(entry([line(bankA, '10000.00'), line(obBob, '-10000.00')], opening), OPEN),
      JournalEntry.post(entry([line(binance, '100.000000'), line(obUsdt, '-100.000000')], opening), OPEN),
      JournalEntry.post(
        entry([
          line(binance, '-100.000000'),
          line(systemAccount('FX_TRADING', USDT), '100.000000'),
          line(systemAccount('FX_TRADING', BOB), '-690.00'),
          line(bankA, '685.00'),
          line(systemAccount('EXPENSE', BOB), '5.00', id()),
        ]),
        OPEN,
      ),
    ];
    const rate = (c: string) => new MoneyDecimal(c === 'BOB' ? '1' : '6.95');
    let netWorth = new MoneyDecimal(0);
    let others = new MoneyDecimal(0);
    for (const p of ledger.flatMap((e) => e.postings)) {
      const v = p.amount.toDecimal().times(rate(p.amount.currency.code));
      if (isRealAccount(p.account as LedgerAccount)) netWorth = netWorth.plus(v);
      else others = others.plus(v);
    }
    expect(Money.roundToScale(netWorth, BOB).toFixed()).toBe('10685.00');
    expect(others.neg().eq(netWorth)).toBe(true);
  });
});

function realTotals(ledger: readonly JournalEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of ledger) {
    for (const p of e.postings) {
      if (!isRealAccount(p.account as LedgerAccount)) continue;
      const c = p.amount.currency.code;
      out[c] = new MoneyDecimal(out[c] ?? '0').plus(p.amount.amount).toFixed();
    }
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== '0'));
}

function reversalInput(e: JournalEntry) {
  return {
    id: id(),
    entryDate: LocalDate.parse('2026-03-20'),
    postingIds: e.postings.map(() => id()),
    memo: null,
    correlationId: null,
    createdBy: null,
  };
}
