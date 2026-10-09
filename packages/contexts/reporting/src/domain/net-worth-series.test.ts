import { currency, dec, DomainError, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { NetWorthSeriesBuilder, type SeriesCutoff, type SeriesPeriod } from './net-worth-series.js';
import type { ValuedAccount } from './net-worth-valuator.js';
import type { ExactRate } from './valuation.js';

const BOB = currency('BOB', 2);
const USDT = currency('USDT', 6);

const period = (label: string, periodStart: string, periodEnd: string, status = 'CLOSED'): SeriesPeriod => ({
  id: `p-${label}`,
  label,
  periodStart,
  periodEnd,
  status,
});
const cutoff = (p: SeriesPeriod, asOf = p.periodEnd, partial = false): SeriesCutoff => ({
  period: p,
  asOf,
  partial,
});

const acc = (id: string, type: string, balance: Money): ValuedAccount => ({
  accountId: id,
  type,
  nature: type === 'CREDIT_CARD' ? 'LIABILITY' : 'ASSET',
  includeInNetWorth: true,
  balance,
});
const usdtAt =
  (value: string) =>
  (code: string): ExactRate | null =>
    code === 'USDT' ? { base: 'USDT', quote: 'BOB', value: dec(value) } : null;

const JAN = period('2026-01', '2026-01-01', '2026-01-31');
const FEB = period('2026-02', '2026-02-01', '2026-02-28');
const MAR = period('2026-03', '2026-03-01', '2026-03-31');

const state = (bob: string, usdt: string, debt: string) => [
  acc('banco', 'BANK', Money.parse(bob, BOB)),
  acc('wallet', 'CRYPTO_WALLET', Money.parse(usdt, USDT)),
  acc('visa', 'CREDIT_CARD', Money.parse(debt, BOB)),
];

const janInput = {
  cutoff: cutoff(JAN),
  accounts: state('2000.00', '100.000000', '300.00'),
  rateFor: usdtAt('10.00'),
  closed: false,
};
const febInput = {
  cutoff: cutoff(FEB),
  accounts: state('2500.00', '100.000000', '0.00'),
  rateFor: usdtAt('10.50'),
  closed: false,
};
const marInput = {
  cutoff: cutoff(MAR),
  accounts: state('2400.00', '120.000000', '150.00'),
  rateFor: usdtAt('11.00'),
  closed: false,
};

describe('NetWorthSeriesBuilder', () => {
  it('[TC-REPORTING-NETWORTH-006] tres meses: 2700.00, 3550.00 y 3570.00 BOB; marzo con activos 3720.00 y pasivos 150.00', () => {
    const points = NetWorthSeriesBuilder.build([janInput, febInput, marInput], BOB);
    expect(points.map((p) => p.netWorth.toString())).toEqual(['2700.00 BOB', '3550.00 BOB', '3570.00 BOB']);
    expect(points[2]?.assets.toString()).toBe('3720.00 BOB');
    expect(points[2]?.liabilities.toString()).toBe('150.00 BOB');
    expect(points.map((p) => p.period)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(points.every((p) => p.complete && p.source === 'COMPUTED' && !p.partial)).toBe(true);
  });

  it('[TC-REPORTING-NETWORTH-007] cada punto usa la tasa de su fecha: la wallet vale 1000.00 y 1050.00 BOB', () => {
    const wallet = (rate: string, cut: SeriesCutoff) => ({
      cutoff: cut,
      accounts: [acc('wallet', 'CRYPTO_WALLET', Money.parse('100.000000', USDT))],
      rateFor: usdtAt(rate),
      closed: false,
    });
    const points = NetWorthSeriesBuilder.build(
      [wallet('10.00', cutoff(JAN)), wallet('10.50', cutoff(FEB))],
      BOB,
    );
    expect(points.map((p) => p.netWorth.toString())).toEqual(['1000.00 BOB', '1050.00 BOB']);
  });

  it('[TC-REPORTING-NETWORTH-008] sin tasa vigente el punto queda incompleto, sin 1:1, y la variación no es comparable', () => {
    const dec25 = period('2025-12', '2025-12-01', '2025-12-31');
    const points = NetWorthSeriesBuilder.build(
      [
        {
          cutoff: cutoff(dec25),
          accounts: [
            acc('banco', 'BANK', Money.parse('1800.00', BOB)),
            acc('wallet', 'CRYPTO_WALLET', Money.parse('100.000000', USDT)),
          ],
          rateFor: () => null,
          closed: false,
        },
        janInput,
      ],
      BOB,
    );
    expect(points[0]?.netWorth.toString()).toBe('1800.00 BOB');
    expect(points[0]?.complete).toBe(false);
    expect(points[0]?.unconverted.map((m) => m.toString())).toEqual(['100.000000 USDT']);
    expect(points[1]?.comparable).toBe(false);
  });

  it('[TC-REPORTING-NETWORTH-009] un mes cerrado con snapshot en la moneda de reporte usa sus cifras congeladas', () => {
    const snapshot = {
      assets: Money.parse('3720.00', BOB),
      liabilities: Money.parse('150.00', BOB),
      netWorth: Money.parse('3570.00', BOB),
      complete: true,
      unconverted: [],
    };
    // Las cuentas con la tasa registrada después del cierre (11.20) darían otra cifra: el snapshot manda.
    const [point] = NetWorthSeriesBuilder.build(
      [{ ...marInput, rateFor: usdtAt('11.20'), closed: true, snapshot }],
      BOB,
    );
    expect(point?.netWorth.toString()).toBe('3570.00 BOB');
    expect(point?.source).toBe('SNAPSHOT');
    expect(point?.closed).toBe(true);
  });

  it('[TC-REPORTING-NETWORTH-009] cerrado sin snapshot utilizable (otra moneda) se calcula y se marca cerrado', () => {
    const [point] = NetWorthSeriesBuilder.build([{ ...marInput, closed: true }], BOB);
    expect(point?.source).toBe('COMPUTED');
    expect(point?.closed).toBe(true);
    expect(point?.netWorth.toString()).toBe('3570.00 BOB');
  });

  it('[TC-REPORTING-NETWORTH-010] solo aportan las cuentas con saldo a la fecha (archivada después, abierta después)', () => {
    const zero = Money.zero(BOB);
    const points = NetWorthSeriesBuilder.build(
      [
        {
          cutoff: cutoff(JAN),
          accounts: [acc('vieja', 'CASH', Money.parse('300.00', BOB)), acc('nuevo', 'BANK', zero)],
          rateFor: () => null,
          closed: false,
        },
        {
          cutoff: cutoff(FEB),
          accounts: [acc('vieja', 'CASH', zero), acc('nuevo', 'BANK', Money.parse('500.00', BOB))],
          rateFor: () => null,
          closed: false,
        },
      ],
      BOB,
    );
    expect(points.map((p) => p.netWorth.toString())).toEqual(['300.00 BOB', '500.00 BOB']);
  });

  it('[TC-REPORTING-NETWORTH-011] variación: primer punto sin variación; febrero +850.00 y marzo +20.00 comparables', () => {
    const points = NetWorthSeriesBuilder.build([janInput, febInput, marInput], BOB);
    expect(points[0]?.change).toBeNull();
    expect(points[0]?.comparable).toBe(false);
    expect(points[1]?.change?.toString()).toBe('850.00 BOB');
    expect(points[2]?.change?.toString()).toBe('20.00 BOB');
    expect(points[1]?.comparable && points[2]?.comparable).toBe(true);
  });
});

describe('NetWorthSeriesBuilder.cutoffs', () => {
  const periods = [
    JAN,
    FEB,
    MAR,
    period('2026-04', '2026-04-01', '2026-04-30', 'ACTIVE'),
    period('2026-05', '2026-05-01', '2026-05-31', 'DRAFT'),
  ];

  it('[TC-REPORTING-NETWORTH-006] el periodo en curso se calcula a hoy y es parcial; los futuros se omiten', () => {
    const cuts = NetWorthSeriesBuilder.cutoffs(periods, { from: '2026-01', to: '2026-04' }, '2026-04-12');
    expect(cuts.map((c) => [c.period.label, c.asOf, c.partial])).toEqual([
      ['2026-01', '2026-01-31', false],
      ['2026-02', '2026-02-28', false],
      ['2026-03', '2026-03-31', false],
      ['2026-04', '2026-04-12', true],
    ]);
  });

  it('[TC-REPORTING-NETWORTH-006] con día de inicio 25 el punto "2026-01" se corta al 2026-02-24', () => {
    const day25 = [
      period('2026-01', '2026-01-25', '2026-02-24'),
      period('2026-02', '2026-02-25', '2026-03-24', 'ACTIVE'),
    ];
    const cuts = NetWorthSeriesBuilder.cutoffs(day25, { from: '2026-01', to: '2026-02' }, '2026-03-02');
    expect(cuts.map((c) => [c.period.label, c.asOf, c.partial])).toEqual([
      ['2026-01', '2026-02-24', false],
      ['2026-02', '2026-03-02', true],
    ]);
  });
});

describe('NetWorthSeriesBuilder.resolveRange', () => {
  const failure = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof DomainError ? e.code : 'other';
    }
    return null;
  };

  it('[TC-REPORTING-NETWORTH-012] meses futuros, rango invertido y más de 120 meses: VALIDATION_FAILED', () => {
    const resolve = (from: string, to: string | undefined) =>
      failure(() => NetWorthSeriesBuilder.resolveRange({ from, to }, '2026-04'));
    expect(resolve('2026-01', '2026-06')).toBe('VALIDATION_FAILED');
    expect(resolve('2026-03', '2026-01')).toBe('VALIDATION_FAILED');
    expect(resolve('2016-01', '2026-04')).toBe('VALIDATION_FAILED');
    expect(resolve('2026-13', undefined)).toBe('VALIDATION_FAILED');
  });

  it('[TC-REPORTING-NETWORTH-012] exactamente 120 meses se admite; sin rango son 12 meses hasta el actual', () => {
    expect(NetWorthSeriesBuilder.resolveRange({ from: '2016-05', to: '2026-04' }, '2026-04')).toEqual({
      from: '2016-05',
      to: '2026-04',
    });
    expect(NetWorthSeriesBuilder.resolveRange({}, '2026-04')).toEqual({ from: '2025-05', to: '2026-04' });
  });
});
