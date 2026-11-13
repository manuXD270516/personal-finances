import { currency, dec, type PeriodLabel } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PeriodAggregate } from './period-series-builder.js';
import { VariableHistoryBuilder, type LoanComponentInput, type ResolvedInput } from './variable-history.js';

const BOB = currency('BOB', 2);

const period = (total: string, byCategory: Record<string, string> = {}, income = '0'): PeriodAggregate => ({
  label: '2026-10' as PeriodLabel,
  start: '2026-10-01',
  end: '2026-10-31',
  expenseTotal: dec(total),
  incomeTotal: dec(income),
  expenseTx: 20,
  incomeTx: 1,
  expenseByCategory: new Map(
    Object.entries(byCategory).map(([id, value]) => [id, { value: dec(value), txCount: 5 }]),
  ),
  unvaluedCount: 0,
  active: true,
});

const resolved = (
  amount: string,
  categoryId: string | null,
  over: Partial<ResolvedInput> = {},
): ResolvedInput => ({
  kind: 'EXPENSE',
  managedBy: 'USER',
  transactionDate: '2026-10-05',
  amount: { amount, currency: 'BOB' },
  categoryId,
  ...over,
});

const build = (
  periods: PeriodAggregate[],
  resolvedList: ResolvedInput[],
  loanComponents: LoanComponentInput[] = [],
) =>
  VariableHistoryBuilder.build({
    periods,
    resolved: resolvedList,
    loanComponents,
    startDay: 1,
    target: BOB,
    rateFor: () => null,
  });

const fx = (d: { toFixed(places: number): string } | undefined): string => d?.toFixed(2) ?? 'sin dato';

describe('VariableHistoryBuilder', () => {
  it('[TC-FORECAST-EXPENSE-002] 4300.00 de gasto menos 2748.00 de recurrentes resueltos dejan 1552.00 variable', () => {
    const out = build(
      [period('4300.00', { viv: '2500.00', serv: '248.00', otros: '1552.00' })],
      [resolved('2500.00', 'viv'), resolved('199.00', 'serv'), resolved('49.00', 'serv')],
    );
    expect(fx(out.periods[0]?.expenseTotal)).toBe('1552.00');
    expect(out.periods[0]?.expenseByCategory.get('serv')?.value.toFixed(2)).toBe('0.00');
    expect(out.clampedCount).toBe(0);
  });

  it('[TC-FORECAST-EXPENSE-003] una categoría solo recurrente (Alquiler emparejado) queda en 0.00', () => {
    const out = build([period('2500.00', { viv: '2500.00' })], [resolved('2500.00', 'viv')]);
    expect(out.periods[0]?.expenseByCategory.get('viv')?.value.toFixed(2)).toBe('0.00');
    expect(fx(out.periods[0]?.expenseTotal)).toBe('0.00');
  });

  it('[TC-FORECAST-EXPENSE-002] pagos de tarjeta, metas y transferencias no se restan; una ocurrencia sin categoría solo resta del total', () => {
    const out = build(
      [period('1000.00', { a: '1000.00' })],
      [
        resolved('300.00', null),
        resolved('500.00', 'a', { kind: 'CARD_PAYMENT' }),
        resolved('400.00', 'a', { managedBy: 'GOAL' }),
        resolved('250.00', 'a', { kind: 'TRANSFER' }),
      ],
    );
    expect(fx(out.periods[0]?.expenseTotal)).toBe('700.00');
    expect(out.periods[0]?.expenseByCategory.get('a')?.value.toFixed(2)).toBe('1000.00');
  });

  it('[TC-FORECAST-EXPENSE-002] los componentes de préstamo del periodo se restan del total y de su categoría', () => {
    const out = build(
      [period('1500.00', { fin: '435.35', otros: '1064.65' })],
      [],
      [{ businessDate: '2026-10-15', categoryId: 'fin', amount: { amount: '435.35', currency: 'BOB' } }],
    );
    expect(fx(out.periods[0]?.expenseTotal)).toBe('1064.65');
    expect(out.periods[0]?.expenseByCategory.get('fin')?.value.toFixed(2)).toBe('0.00');
  });

  it('[TC-FORECAST-EXPENSE-002] un resultado negativo se lleva a 0 y se cuenta en la calidad de datos', () => {
    const out = build([period('100.00', { a: '100.00' })], [resolved('250.00', 'a')]);
    expect(fx(out.periods[0]?.expenseTotal)).toBe('0.00');
    expect(out.clampedCount).toBe(2);
  });

  it('[TC-FORECAST-EXPENSE-002] los ingresos recurrentes resueltos se restan del ingreso total', () => {
    const out = build([period('0', {}, '9500.00')], [resolved('8000.00', null, { kind: 'INCOME' })]);
    expect(fx(out.periods[0]?.incomeTotal)).toBe('1500.00');
  });

  it('[TC-FORECAST-EXPENSE-002] propiedad: historia variable + resueltos + componentes = gasto del periodo sin truncamiento', () => {
    const cents = fc.integer({ min: 0, max: 1_000_000 });
    fc.assert(
      fc.property(
        fc.array(cents, { minLength: 0, maxLength: 6 }),
        fc.array(cents, { minLength: 0, maxLength: 4 }),
        cents,
        (resolvedCents, loanCents, extra) => {
          const fmt = (n: number) => (n / 100).toFixed(2);
          const sumResolved = resolvedCents.reduce((a, b) => a + b, 0);
          const sumLoan = loanCents.reduce((a, b) => a + b, 0);
          const total = sumResolved + sumLoan + extra;
          const out = build(
            [period(fmt(total), { c: fmt(total) })],
            resolvedCents.map((n) => resolved(fmt(n), 'c')),
            loanCents.map((n) => ({
              businessDate: '2026-10-20',
              categoryId: 'c',
              amount: { amount: fmt(n), currency: 'BOB' },
            })),
          );
          const variable = out.periods[0]?.expenseTotal ?? dec('0');
          expect(variable.plus(fmt(sumResolved)).plus(fmt(sumLoan)).toFixed(2)).toBe(fmt(total));
          expect(out.clampedCount).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  }, 30_000);
});
