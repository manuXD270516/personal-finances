import { LocalDate, Money, currency, sumByCurrency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DebtFreeDateEstimator, cardAccountPayoffDate } from './debt-free-date-estimator.js';
import { DebtSummaryCalculator } from './debt-summary-calculator.js';
import type { LiabilityAccount } from './debt-summary-types.js';
import { InterestAttribution, interestYearStart } from './interest-attribution.js';
import { UpcomingDebtDues } from './upcoming-debt-dues.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
const usd = (v: string) => Money.parse(v, USD);

const account = (id: string, name: string, balance: Money, includedInNetWorth = true): LiabilityAccount => ({
  accountId: id,
  name,
  currency: balance.currency,
  balance,
  includedInNetWorth,
});

const owner = () => [
  account('a-loan', 'Préstamo auto', bob('45000.00')),
  account('a-bob', 'Visa Oro BOB', bob('1120.50')),
  account('a-usd', 'Visa Oro USD', usd('100.00')),
  account('a-fam', 'Deuda familiar', bob('2000.00')),
];
const links = {
  loans: [{ id: 'loan-1', name: 'Préstamo auto', accountId: 'a-loan' }],
  cards: [
    { id: 'card-1', name: 'Visa Oro', accountId: 'a-bob' },
    { id: 'card-1', name: 'Visa Oro', accountId: 'a-usd' },
  ],
};
const render = (ms: readonly Money[]) => ms.map((m) => m.toString());

describe('DebtSummaryCalculator', () => {
  it('[TC-DEBT-SUMMARY-001] agrupa préstamo, tarjeta bimoneda y otro pasivo; total 48120.50 BOB y 100.00 USD', () => {
    const g = DebtSummaryCalculator.group({ accounts: owner(), ...links });
    expect(g.status).toBe('ACTIVE');
    expect(render(g.totalsByCurrency)).toEqual(['48120.50 BOB', '100.00 USD']);
    expect(g.debts.map((d) => [d.kind, d.name, d.balances.length])).toEqual([
      ['LOAN', 'Préstamo auto', 1],
      ['CREDIT_CARD', 'Visa Oro', 2],
      ['OTHER_LIABILITY', 'Deuda familiar', 1],
    ]);
    expect(g.debts[1]?.balances.map((b) => b.outstanding.toString())).toEqual(['1120.50 BOB', '100.00 USD']);
  });

  it('[TC-DEBT-SUMMARY-003] saldo a favor aparte: USD adeudado 0.00 y 30.00 USD a favor sin restar', () => {
    const accounts = owner().map((a) =>
      a.accountId === 'a-usd' ? account('a-usd', 'Visa Oro USD', usd('-30.00')) : a,
    );
    const g = DebtSummaryCalculator.group({ accounts, ...links });
    expect(render(g.totalsByCurrency)).toEqual(['48120.50 BOB', '0.00 USD']);
    expect(g.creditBalances.map((c) => [c.name, c.amount.toString()])).toEqual([
      ['Visa Oro USD', '30.00 USD'],
    ]);
    expect(g.debts.find((d) => d.kind === 'CREDIT_CARD')?.balances.map((b) => b.accountId)).toEqual([
      'a-bob',
    ]);
  });

  it('[TC-DEBT-SUMMARY-003] una cuenta pagada deja de listarse y el total baja', () => {
    const accounts = owner().map((a) =>
      a.accountId === 'a-bob' ? account('a-bob', 'Visa Oro BOB', bob('0.00')) : a,
    );
    const g = DebtSummaryCalculator.group({ accounts, ...links });
    expect(render(g.totalsByCurrency)).toEqual(['47000.00 BOB', '100.00 USD']);
    expect(g.debts.find((d) => d.kind === 'CREDIT_CARD')?.balances.map((b) => b.accountId)).toEqual([
      'a-usd',
    ]);
  });

  it('[TC-DEBT-SUMMARY-010] sin cuentas de pasivo: NO_LIABILITIES sin totales', () => {
    const g = DebtSummaryCalculator.group({ accounts: [], loans: [], cards: [] });
    expect(g).toEqual({ status: 'NO_LIABILITIES', debts: [], creditBalances: [], totalsByCurrency: [] });
  });

  it('[TC-DEBT-SUMMARY-010] pasivos sin saldo: NO_DEBT sin ceros inventados', () => {
    const g = DebtSummaryCalculator.group({
      accounts: [
        account('a-bob', 'Visa Oro BOB', bob('0.00')),
        account('a-loan', 'Préstamo auto', bob('0.00')),
      ],
      ...links,
    });
    expect(g.status).toBe('NO_DEBT');
    expect(g.debts).toEqual([]);
    expect(g.totalsByCurrency).toEqual([]);
  });

  it('[TC-DEBT-SUMMARY-001] la marca includedInNetWorth viaja con cada saldo', () => {
    const g = DebtSummaryCalculator.group({
      accounts: [account('a-fam', 'Deuda familiar', bob('2000.00'), false)],
      loans: [],
      cards: [],
    });
    expect(g.debts[0]?.balances[0]?.includedInNetWorth).toBe(false);
  });

  it('[TC-DEBT-SUMMARY-001] PBT: Σ de los saldos listados por moneda = total por moneda (nunca mezcla monedas)', () => {
    const money = fc
      .tuple(fc.integer({ min: 1, max: 10_000_000 }), fc.constantFrom(BOB, USD))
      .map(([minor, cur]) => Money.ofMinorUnits(BigInt(minor), cur));
    fc.assert(
      fc.property(fc.array(money, { maxLength: 12 }), (balances) => {
        const accounts = balances.map((b, i) => account(`a${i}`, `Cuenta ${i}`, b));
        const g = DebtSummaryCalculator.group({ accounts, loans: [], cards: [] });
        const listed = g.debts.flatMap((d) => d.balances.map((b) => b.outstanding));
        const expected = sumByCurrency(listed).map((m) => m.toString());
        expect(g.totalsByCurrency.map((m) => m.toString())).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});

describe('InterestAttribution', () => {
  it('[TC-DEBT-SUMMARY-004] atribuye 3250.40 BOB al préstamo y 12.00 USD a la tarjeta; otros vacío y consistente', () => {
    const r = InterestAttribution.attribute({
      total: [bob('3250.40'), usd('12.00')],
      loans: [{ id: 'loan-1', name: 'Préstamo auto', amount: bob('3250.40') }],
      cards: [{ id: 'card-1', name: 'Visa Oro', amount: usd('12.00') }],
    });
    expect(r.consistent).toBe(true);
    expect(r.entries.map((e) => [e.kind, e.name, render(e.byCurrency)])).toEqual([
      ['LOAN', 'Préstamo auto', ['3250.40 BOB']],
      ['CREDIT_CARD', 'Visa Oro', ['12.00 USD']],
      ['OTHER', null, []],
    ]);
  });

  it('[TC-DEBT-SUMMARY-005] el interés sin deuda asociada (25.00 BOB) queda en otros intereses', () => {
    const r = InterestAttribution.attribute({
      total: [bob('3275.40'), usd('12.00')],
      loans: [{ id: 'loan-1', name: 'Préstamo auto', amount: bob('3250.40') }],
      cards: [{ id: 'card-1', name: 'Visa Oro', amount: usd('12.00') }],
    });
    expect(render(r.entries.at(-1)?.byCurrency ?? [])).toEqual(['25.00 BOB']);
    expect(r.consistent).toBe(true);
  });

  it('[TC-DEBT-SUMMARY-005] atribución mayor que el total: otros negativo y attributionConsistent = false', () => {
    const r = InterestAttribution.attribute({
      total: [bob('100.00')],
      loans: [{ id: 'loan-1', name: 'Préstamo auto', amount: bob('130.00') }],
      cards: [],
    });
    expect(render(r.entries.at(-1)?.byCurrency ?? [])).toEqual(['-30.00 BOB']);
    expect(r.consistent).toBe(false);
  });

  it('[TC-DEBT-SUMMARY-005] el año del interés empieza el 1 de enero del año de hoy', () => {
    expect(interestYearStart(LocalDate.parse('2026-10-28')).toString()).toBe('2026-01-01');
    expect(interestYearStart(LocalDate.parse('2026-12-31')).toString()).toBe('2026-01-01');
  });

  it('[TC-DEBT-SUMMARY-004] PBT: préstamos + tarjetas + otros = total por moneda', () => {
    const minor = fc.integer({ min: 0, max: 1_000_000 });
    fc.assert(
      fc.property(
        minor,
        fc.array(fc.tuple(fc.constantFrom('l1', 'l2', 'l3'), minor), { maxLength: 6 }),
        fc.array(fc.tuple(fc.constantFrom('c1', 'c2'), minor), { maxLength: 4 }),
        (totalMinor, loanRows, cardRows) => {
          const m = (n: number) => Money.ofMinorUnits(BigInt(n), BOB);
          const r = InterestAttribution.attribute({
            total: [m(totalMinor)],
            loans: loanRows.map(([id, n]) => ({ id, name: id, amount: m(n) })),
            cards: cardRows.map(([id, n]) => ({ id, name: id, amount: m(n) })),
          });
          const sum = Money.sum(
            r.entries.flatMap((e) => e.byCurrency),
            BOB,
          );
          expect(sum.toString()).toBe(m(totalMinor).toString());
        },
      ),
      { numRuns: 100 },
    );
  }, 30_000);
});

describe('DebtFreeDateEstimator', () => {
  const statementCard = {
    kind: 'CREDIT_CARD' as const,
    id: 'card-1',
    name: 'Visa Oro',
    accounts: [
      {
        accountId: 'a-bob',
        balance: bob('1120.50'),
        lastStatement: { dueDate: '2026-11-15', remainingNoInterest: bob('1120.50') },
        openCycleDueDate: '2026-12-15',
        unbilledInstallments: bob('0.00'),
        lastInstallmentDueDate: null,
      },
      {
        accountId: 'a-usd',
        balance: usd('100.00'),
        lastStatement: { dueDate: '2026-11-15', remainingNoInterest: usd('100.00') },
        openCycleDueDate: '2026-12-15',
        unbilledInstallments: usd('0.00'),
        lastInstallmentDueDate: null,
      },
    ],
  };
  const loan = {
    kind: 'LOAN' as const,
    id: 'loan-1',
    name: 'Préstamo auto',
    lastUnpaidDueDate: '2029-06-05',
  };
  const family = { kind: 'OTHER_LIABILITY' as const, id: 'a-fam', name: 'Deuda familiar' };

  it('[TC-DEBT-SUMMARY-006] la mayor de las estimadas (2029-06-05) sin contar la deuda no estimable; Visa Oro 2026-11-15', () => {
    const e = DebtFreeDateEstimator.estimate([loan, statementCard, family]);
    expect(e.date).toBe('2029-06-05');
    expect(e.excluded).toEqual([{ kind: 'OTHER_LIABILITY', id: 'a-fam', name: 'Deuda familiar' }]);
    expect(e.perDebt.find((p) => p.id === 'card-1')?.estimatedPayoffDate).toBe('2026-11-15');
    expect(e.perDebt.find((p) => p.id === 'a-fam')?.payoffEstimable).toBe(false);
  });

  it('[TC-DEBT-SUMMARY-006] con todas las deudas estimables no hay excluidas', () => {
    const e = DebtFreeDateEstimator.estimate([loan, statementCard]);
    expect(e.date).toBe('2029-06-05');
    expect(e.excluded).toEqual([]);
  });

  it('[TC-DEBT-SUMMARY-006] tarjeta solo con la compra "Laptop" en 3 cuotas: fecha de la última cuota (2027-01-15)', () => {
    const date = cardAccountPayoffDate({
      accountId: 'a-bob',
      balance: bob('1000.00'),
      lastStatement: null,
      openCycleDueDate: '2026-11-15',
      unbilledInstallments: bob('1000.00'),
      lastInstallmentDueDate: '2027-01-15',
    });
    expect(date).toBe('2027-01-15');
  });

  it('[TC-DEBT-SUMMARY-006] compras del ciclo abierto: manda el vencimiento del ciclo abierto', () => {
    const date = cardAccountPayoffDate({
      accountId: 'a-bob',
      balance: bob('1300.00'),
      lastStatement: { dueDate: '2026-11-15', remainingNoInterest: bob('1000.00') },
      openCycleDueDate: '2026-12-15',
      unbilledInstallments: bob('0.00'),
      lastInstallmentDueDate: null,
    });
    expect(date).toBe('2026-12-15');
  });

  it('[TC-DEBT-SUMMARY-006] sin deudas: sin fecha ni excluidas', () => {
    expect(DebtFreeDateEstimator.estimate([])).toEqual({ perDebt: [], date: null, excluded: [] });
  });

  it('[TC-DEBT-SUMMARY-006] préstamo saldado con diferencia en la cuenta (sin cuotas) no es estimable', () => {
    const e = DebtFreeDateEstimator.estimate([{ ...loan, lastUnpaidDueDate: null }]);
    expect(e.date).toBeNull();
    expect(e.excluded.map((x) => x.id)).toEqual(['loan-1']);
  });
});

describe('UpcomingDebtDues', () => {
  const dueDebts = (overdueDays = 0) =>
    [
      {
        kind: 'LOAN' as const,
        id: 'loan-1',
        name: 'Préstamo auto',
        accountId: 'a-loan',
        next: { dueDate: '2026-11-05', outstanding: bob('1850.00'), overdueDays },
      },
      {
        kind: 'CREDIT_CARD' as const,
        id: 'card-1',
        name: 'Visa Oro',
        accounts: [
          {
            accountId: 'a-usd',
            balance: usd('100.00'),
            lastStatement: {
              dueDate: '2026-11-15',
              remainingNoInterest: usd('100.00'),
              remainingMinimum: usd('10.00'),
            },
            openCycle: { dueDate: '2026-12-15', estimatedNoInterest: usd('0.00') },
          },
          {
            accountId: 'a-bob',
            balance: bob('1120.50'),
            lastStatement: {
              dueDate: '2026-11-15',
              remainingNoInterest: bob('1120.50'),
              remainingMinimum: bob('56.02'),
            },
            openCycle: { dueDate: '2026-12-15', estimatedNoInterest: bob('0.00') },
          },
        ],
      },
    ] as const;
  const view = (xs: ReturnType<typeof UpcomingDebtDues.list>) =>
    xs.map((x) => [x.name, x.dueDate, x.amount.toString(), x.minimum?.toString() ?? null, x.overdueDays]);

  it('[TC-DEBT-SUMMARY-007] orden: préstamo 2026-11-05, Visa Oro BOB y Visa Oro USD con su mínimo; sin la deuda familiar', () => {
    const list = UpcomingDebtDues.list(dueDebts(), LocalDate.parse('2026-10-28'));
    expect(view(list)).toEqual([
      ['Préstamo auto', '2026-11-05', '1850.00 BOB', null, 0],
      ['Visa Oro', '2026-11-15', '1120.50 BOB', '56.02 BOB', 0],
      ['Visa Oro', '2026-11-15', '100.00 USD', '10.00 USD', 0],
    ]);
  });

  it('[TC-DEBT-SUMMARY-007] la cuota atrasada va primero con sus días de atraso', () => {
    const list = UpcomingDebtDues.list(
      [{ ...dueDebts(2)[1] }, { ...dueDebts(2)[0] }],
      LocalDate.parse('2026-11-07'),
    );
    expect(list[0]).toMatchObject({ name: 'Préstamo auto', overdueDays: 2 });
    expect(list[0]?.amount.toString()).toBe('1850.00 BOB');
  });

  it('[TC-DEBT-SUMMARY-007] sin estado emitido usa el ciclo abierto estimado; sin saldo o sin estimación no se lista', () => {
    const list = UpcomingDebtDues.list(
      [
        {
          kind: 'CREDIT_CARD',
          id: 'card-2',
          name: 'Mastercard',
          accounts: [
            {
              accountId: 'm1',
              balance: bob('300.00'),
              lastStatement: null,
              openCycle: { dueDate: '2026-12-02', estimatedNoInterest: bob('300.00') },
            },
            {
              accountId: 'm2',
              balance: bob('0.00'),
              lastStatement: null,
              openCycle: { dueDate: '2026-12-02', estimatedNoInterest: bob('0.00') },
            },
            {
              accountId: 'm3',
              balance: bob('500.00'),
              lastStatement: null,
              openCycle: { dueDate: '2026-12-02', estimatedNoInterest: bob('0.00') },
            },
          ],
        },
      ],
      LocalDate.parse('2026-10-28'),
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ accountId: 'm1', estimated: true, minimum: null });
  });
});
