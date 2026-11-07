import { currency as makeCurrency, Money } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CashFlowCalendar, type CashFlowMovementInput } from './cash-flow-calendar.js';

const BOB = makeCurrency('BOB', 2);
const bob = (cents: number) => Money.ofMinorUnits(BigInt(cents), BOB);
const TODAY = '2026-10-20';
const ACCOUNTS = ['a1', 'a2', 'a3'].map((id, i) => ({
  accountId: id,
  name: id,
  balance: bob(100_000 * (i + 1)),
}));
const DATES = Array.from({ length: 16 }, (_, i) => `2026-10-${String(15 + i).padStart(2, '0')}`);

const movement = fc
  .record({
    kind: fc.constantFrom('INCOME', 'EXPENSE', 'TRANSFER', 'CARD_PAYMENT') as fc.Arbitrary<
      CashFlowMovementInput['kind']
    >,
    date: fc.constantFrom(...DATES, '2026-11-25'),
    from: fc.constantFrom('a1', 'a2', 'a3', 'ilíquida'),
    to: fc.constantFrom('a1', 'a2', 'a3', 'ilíquida'),
    cents: fc.integer({ min: 1, max: 500_000 }),
  })
  .map((m): CashFlowMovementInput => ({
    id: 'm',
    source: 'OCCURRENCE',
    kind: m.kind,
    date: m.date,
    accountId: m.from,
    toAccountId: m.kind === 'TRANSFER' || m.kind === 'CARD_PAYMENT' ? m.to : null,
    amountType: 'FIXED',
    name: 'm',
    managedBy: 'USER',
    categoryId: null,
    amount: bob(m.cents),
    toAmount: null,
  }));
const movements = fc
  .array(movement, { maxLength: 25 })
  .map((list) => list.map((m, i) => ({ ...m, id: `m${i}`, name: `m${i}` })));

const run = (list: readonly CashFlowMovementInput[]) =>
  CashFlowCalendar.compute({ today: TODAY, horizonDays: 30, accounts: ACCOUNTS, movements: list });

describe('CashFlowCalendar: propiedades (TC-REPORTING-FORECAST-003, -005, -008)', () => {
  it('[TC-REPORTING-FORECAST-003] la suma de las series de las cuentas de una moneda es la serie de la moneda y el saldo final es el inicial más los efectos', () => {
    fc.assert(
      fc.property(movements, (list) => {
        const r = run(list);
        const b = r.currencies[0]!;
        for (const [i, p] of b.series.entries()) {
          const total = r.accounts.reduce((acc, a) => acc.add(a.series[i]!.balance), Money.zero(BOB));
          // Las transferencias entre líquidas de la moneda son neutras para la moneda: la suma por cuenta coincide.
          expect(total.toFixed()).toBe(p.balance.toFixed());
        }
        const liquid = new Set(ACCOUNTS.map((a) => a.accountId));
        let effects = Money.zero(BOB);
        for (const m of list) {
          if (m.date > r.to) continue;
          const amount = m.amount as Money;
          if (m.kind === 'INCOME') {
            if (liquid.has(m.accountId)) effects = effects.add(amount);
            continue;
          }
          if (liquid.has(m.accountId)) effects = effects.subtract(amount);
          if (m.toAccountId !== null && liquid.has(m.toAccountId) && m.kind !== 'EXPENSE')
            effects = effects.add(amount);
        }
        expect(b.endBalance.toFixed()).toBe(b.startBalance.add(effects).toFixed());
      }),
      { numRuns: 200 },
    );
  }, 30_000);

  it('[TC-REPORTING-FORECAST-005] agregar una transferencia entre cuentas líquidas no cambia el saldo final ni el mínimo de la moneda', () => {
    fc.assert(
      fc.property(
        movements,
        fc.integer({ min: 1, max: 400_000 }),
        fc.constantFrom(...DATES),
        (list, cents, date) => {
          const before = run(list).currencies[0]!;
          const extra: CashFlowMovementInput = {
            ...(list[0] ?? ({} as CashFlowMovementInput)),
            id: 'extra',
            source: 'OCCURRENCE',
            kind: 'TRANSFER',
            date,
            accountId: 'a1',
            toAccountId: 'a2',
            amountType: 'FIXED',
            name: 'extra',
            managedBy: 'USER',
            categoryId: null,
            amount: bob(cents),
            toAmount: null,
          };
          const after = run([...list, extra]).currencies[0]!;
          expect(after.endBalance.toFixed()).toBe(before.endBalance.toFixed());
          expect(after.lowest.amount.toFixed()).toBe(before.lowest.amount.toFixed());
        },
      ),
      { numRuns: 200 },
    );
  }, 30_000);

  it('[TC-REPORTING-FORECAST-008] un egreso más nunca sube el saldo más bajo esperado', () => {
    fc.assert(
      fc.property(
        movements,
        fc.integer({ min: 1, max: 400_000 }),
        fc.constantFrom(...DATES),
        (list, cents, date) => {
          const before = run(list).currencies[0]!;
          const extra: CashFlowMovementInput = {
            id: 'extra',
            source: 'OCCURRENCE',
            kind: 'EXPENSE',
            date,
            accountId: 'a1',
            toAccountId: null,
            amountType: 'FIXED',
            name: 'extra',
            managedBy: 'USER',
            categoryId: null,
            amount: bob(cents),
            toAmount: null,
          };
          const after = run([...list, extra]).currencies[0]!;
          expect(after.lowest.amount.compare(before.lowest.amount)).toBeLessThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  }, 30_000);
});
