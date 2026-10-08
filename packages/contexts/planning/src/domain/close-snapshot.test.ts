import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  CloseSnapshotBuilder,
  PeriodVariation,
  SnapshotComparator,
  type CloseSnapshotContent,
  type SnapshotBuildInput,
} from './close-snapshot.js';

const m = (amount: string, currency = 'BOB') => ({ amount, currency });

function input(over: Partial<SnapshotBuildInput> = {}): SnapshotBuildInput {
  return {
    period: {
      periodId: 'p',
      label: '2026-10',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      startDay: 1,
    },
    baseCurrency: 'BOB',
    accounts: [
      {
        accountId: 'b',
        accountName: 'Bank A',
        ledgerAccountId: 'l1',
        currency: 'BOB',
        balance: m('5200.00'),
        presented: m('5200.00'),
        reconciliation: {
          reconciliationId: 'r1',
          statementDate: '2026-10-31',
          statementBalance: m('5200.00'),
        },
        reconciliationBasis: 'STATEMENT',
      },
      {
        accountId: 'u',
        accountName: 'Binance USDT',
        ledgerAccountId: 'l2',
        currency: 'USDT',
        balance: m('800.000000', 'USDT'),
        presented: m('800.000000', 'USDT'),
        reconciliation: null,
        reconciliationBasis: null,
      },
    ],
    withoutStatement: [],
    flows: {
      byCurrency: [
        { currency: 'USD', income: m('0.00', 'USD'), expense: m('20.00', 'USD') },
        { currency: 'BOB', income: m('12000.00'), expense: m('8210.50') },
      ],
      consolidated: {
        currency: 'BOB',
        income: m('12000.00'),
        expense: m('8450.50'),
        savings: m('3549.50'),
        savingsRate: '29.6',
        complete: true,
        unconverted: [],
      },
    },
    netWorth: {
      amount: m('32541.00'),
      assets: m('32891.00'),
      liabilities: m('350.00'),
      complete: true,
      unconverted: [],
      rates: [],
    },
    budgetVsActual: null,
    checklist: [],
    acknowledgedWarnings: null,
    ...over,
  };
}

describe('CloseSnapshotBuilder', () => {
  it('[TC-PLANNING-SNAPSHOT-001] saldos exactos, ahorro por moneda exacto, bloques no disponibles en null', () => {
    const c = CloseSnapshotBuilder.build(input());
    expect(c.balances.map((b) => [b.accountName, b.balance.amount])).toEqual([
      ['Bank A', '5200.00'],
      ['Binance USDT', '800.000000'],
    ]);
    expect(c.flows.byCurrency).toEqual([
      { currency: 'BOB', income: m('12000.00'), expense: m('8210.50'), savings: m('3789.50') },
      { currency: 'USD', income: m('0.00', 'USD'), expense: m('20.00', 'USD'), savings: m('-20.00', 'USD') },
    ]);
    expect(c.flows.consolidated.savingsRate).toBe('29.6');
    expect(c.budgetVsActual).toBeNull();
    expect(c.goalContributions).toBeNull();
  });

  it('el contenido solo contiene strings decimales (nunca number) y su JSON canónico es estable', () => {
    const c = CloseSnapshotBuilder.build(input());
    const text = canonicalJson(c);
    expect(text).toBe(canonicalJson(JSON.parse(JSON.stringify(c))));
    expect(JSON.stringify(c)).not.toMatch(/"amount":\d/);
  });

  it('[TC-PLANNING-CLOSE-006] registra la base de conciliación y las transacciones sin extracto por cuenta', () => {
    const c = CloseSnapshotBuilder.build(
      input({
        accounts: [
          {
            accountId: 'caja',
            accountName: 'Caja BOB',
            ledgerAccountId: null,
            currency: 'BOB',
            balance: m('-80.00'),
            presented: m('-80.00'),
            reconciliation: null,
            reconciliationBasis: 'WITHOUT_STATEMENT',
          },
        ],
        withoutStatement: [
          { transactionId: 'c1', accountId: 'caja', businessDate: '2026-10-12', amount: m('80.00') },
        ],
      }),
    );
    expect(c.balances[0]).toMatchObject({
      reconciliationBasis: 'WITHOUT_STATEMENT',
      reconciledWithoutStatementTransactionIds: ['c1'],
    });
  });
});

describe('SnapshotComparator y PeriodVariation', () => {
  const v1: CloseSnapshotContent = CloseSnapshotBuilder.build(input());
  const v2: CloseSnapshotContent = CloseSnapshotBuilder.build(
    input({
      accounts: input().accounts.map((a) =>
        a.accountId === 'b' ? { ...a, balance: m('5185.00'), presented: m('5185.00') } : a,
      ),
      flows: {
        ...input().flows,
        consolidated: { ...input().flows.consolidated, expense: m('8465.50'), savings: m('3534.50') },
      },
      netWorth: { ...input().netWorth, amount: m('32526.00') },
    }),
  );

  it('[TC-PLANNING-RECLOSE-002] diferencias entre versiones: −15.00 en Bank A, +15.00 gastos, −15.00 ahorro y patrimonio', () => {
    const d = SnapshotComparator.diff(v1, v2);
    expect(d.balances.find((b) => b.accountId === 'b')?.delta).toEqual(m('-15.00'));
    expect(d.flows.consolidated).toEqual({ income: m('0.00'), expense: m('15.00'), savings: m('-15.00') });
    expect(d.netWorth.delta).toEqual(m('-15.00'));
  });

  it('[TC-PLANNING-REPORT-002] variación absoluta y porcentual con un decimal HALF_EVEN (gastos 7900.00 → 8450.50 = +550.50, +7.0 %)', () => {
    const sep = CloseSnapshotBuilder.build(
      input({
        flows: { ...input().flows, consolidated: { ...input().flows.consolidated, expense: m('7900.00') } },
      }),
    );
    const exp = PeriodVariation.compare(v1, sep).find((k) => k.kpi === 'EXPENSE');
    expect(exp).toEqual({ kpi: 'EXPENSE', absolute: m('550.50'), percentage: '7.0' });
  });

  it('el porcentaje es null si el valor anterior es 0', () => {
    const zero = CloseSnapshotBuilder.build(
      input({
        flows: { ...input().flows, consolidated: { ...input().flows.consolidated, income: m('0.00') } },
      }),
    );
    expect(PeriodVariation.compare(v1, zero).find((k) => k.kpi === 'INCOME')?.percentage).toBeNull();
  });
});
