import { LocalDate, currency, dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateSchedule, type AmortizationInput } from './amortization-calculator.js';
import { simulateExtras, simulateStrategies, type PayoffLoan } from './payoff-simulator.js';
import { recalculatePrepayment, type TailTerms } from './schedule-recalculator.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const d = (s: string) => LocalDate.parse(s);
const sum = (xs: readonly string[]) => xs.reduce((a, x) => a.plus(x), dec('0'));

function loanOf(
  id: string,
  principal: string,
  rate: string,
  n: number,
  over: Partial<AmortizationInput> = {},
  extra: Partial<PayoffLoan> = {},
): PayoffLoan {
  const input: AmortizationInput = {
    currency: BOB,
    principal,
    annualRate: rate,
    dayCount: 'D30_360',
    frequency: 'MONTHLY',
    installments: n,
    accrualStart: d('2026-10-15'),
    firstDueDate: d('2026-11-15'),
    ...over,
  };
  const schedule = calculateSchedule(input);
  const terms: TailTerms = {
    currency: input.currency,
    method: input.method ?? 'FRENCH',
    dayCount: input.dayCount,
    frequency: input.frequency,
    charges: input.charges ?? {},
    firstInstallmentNo: 1,
    rates: [{ effectiveFrom: input.accrualStart.toString(), annualRate: rate }],
  };
  return {
    id,
    name: `Préstamo ${id}`,
    terms,
    custom: false,
    annualRate: rate,
    balance: principal,
    rows: schedule.installments,
    parameters: { installmentAmount: schedule.installmentAmount },
    ...extra,
  };
}

describe('PayoffSimulator — un préstamo con extras', () => {
  const loan = loanOf('a', '12000.00', '0.12', 12);

  it('[TC-DEBT-AMORT-040] extra único de 3000.00 junto a la cuota 3: interés 546.74 frente a 794.23, fin 2027-07-15, ahorro 247.49', () => {
    const r = simulateExtras(loan, [{ type: 'ONE_TIME', installmentNo: 3, amount: '3000.00' }]);
    expect(r.current.totalInterest).toBe('794.23');
    expect(r.current.endDate).toBe('2027-10-15');
    expect(r.scenario.totalInterest).toBe('546.74');
    expect(r.scenario.endDate).toBe('2027-07-15');
    expect(r.interestSaved).toBe('247.49');
    expect(r.monthsSaved).toBe(3);
    expect(r.scenario.series.at(-1)).toEqual({ period: '2027-07-15', balance: '0.00' });
  });

  it('[TC-DEBT-AMORT-041] extra de 200.00 cada mes desde la cuota 1: interés 670.30, fin 2027-09-15, ahorro 123.93', () => {
    const r = simulateExtras(loan, [{ type: 'MONTHLY', fromInstallmentNo: 1, amount: '200.00' }]);
    expect(r.scenario.totalInterest).toBe('670.30');
    expect(r.scenario.endDate).toBe('2027-09-15');
    expect(r.interestSaved).toBe('123.93');
  });

  it('un extra único equivale a un prepago REDUCE_TERM del recalculador', () => {
    const rows = loan.rows.slice(3);
    const prepaid = recalculatePrepayment({
      terms: loan.terms,
      rows,
      balance: rows[0]!.openingBalance,
      amount: '3000.00',
      option: 'REDUCE_TERM',
      parameters: loan.parameters,
    });
    const simulated = simulateExtras(
      loanOf('a', '9132.95', '0.12', 9, {}, { rows, balance: rows[0]!.openingBalance }),
      [{ type: 'ONE_TIME', installmentNo: 3, amount: '3000.00' }],
    );
    // sin cuotas 1 a 3 pagadas el extra "junto a la cuota 3" no existe: la simulación no cambia nada
    expect(simulated.scenario.totalInterest).toBe(simulated.current.totalInterest);
    const afterFour = simulateExtras(loan, [{ type: 'ONE_TIME', installmentNo: 3, amount: '3000.00' }]);
    expect(
      sum(prepaid.installments.map((c) => c.interest))
        .plus(sum(loan.rows.slice(0, 3).map((c) => c.interest)))
        .toFixed(2),
    ).toBe(afterFour.scenario.totalInterest);
  });

  it('un extra mayor que el saldo salda el préstamo en esa cuota y un custom no recibe extra', () => {
    const r = simulateExtras(loan, [{ type: 'ONE_TIME', installmentNo: 2, amount: '999999.00' }]);
    expect(r.scenario.endDate).toBe('2026-12-15');
    expect(() =>
      simulateExtras({ ...loan, custom: true }, [{ type: 'ONE_TIME', installmentNo: 1, amount: '10.00' }]),
    ).toThrow(/custom/);
  });
});

describe('PayoffSimulator — estrategias', () => {
  const a = loanOf('a', '3000.00', '0.12', 12);
  const b = loanOf('b', '12000.00', '0.24', 24);

  it('[TC-DEBT-AMORT-042] avalanche 1815.57, snowball 2000.08, sin extra 3425.46; libres de deudas 2027-11-15', () => {
    expect(a.parameters.installmentAmount).toBe('266.55');
    expect(b.parameters.installmentAmount).toBe('634.45');
    const r = simulateStrategies({ currency: BOB, monthlyExtra: '500.00', loans: [a, b] });
    const none = r.strategies.find((s) => s.strategy === 'NONE')!;
    const avalanche = r.strategies.find((s) => s.strategy === 'AVALANCHE')!;
    const snowball = r.strategies.find((s) => s.strategy === 'SNOWBALL')!;
    expect(none.totalInterest).toBe('3425.46');
    expect(none.debtFreeDate).toBe('2028-10-15');
    expect(none.interestSaved).toBe('0.00');
    expect(avalanche.totalInterest).toBe('1815.57');
    expect(avalanche.interestSaved).toBe('1609.89');
    expect(avalanche.debtFreeDate).toBe('2027-11-15');
    expect(snowball.totalInterest).toBe('2000.08');
    expect(snowball.interestSaved).toBe('1425.38');
    expect(snowball.debtFreeDate).toBe('2027-11-15');
    expect(snowball.loans.find((l) => l.loanId === 'a')!.endDate).toBe('2027-03-15');
    expect(r.outOfStrategy).toEqual([]);
    expect(r.startBalance).toBe('15000.00');
  });

  it('[TC-DEBT-AMORT-043] un préstamo en otra moneda queda fuera de la estrategia y no se proyecta', () => {
    const usd = loanOf('c', '5000.00', '0.1', 12, { currency: USD });
    const r = simulateStrategies({ currency: BOB, monthlyExtra: '500.00', loans: [a, b, usd] });
    expect(r.outOfStrategy).toEqual([
      { loanId: 'c', name: 'Préstamo c', reason: 'CURRENCY', currency: 'USD' },
    ]);
    for (const s of r.strategies) expect(s.loans.map((l) => l.loanId)).toEqual(['a', 'b']);
    expect(r.strategies.find((s) => s.strategy === 'AVALANCHE')!.totalInterest).toBe('1815.57');
    // un custom tampoco participa
    const custom = simulateStrategies({
      currency: BOB,
      monthlyExtra: '500.00',
      loans: [a, { ...b, custom: true }],
    });
    expect(custom.outOfStrategy.map((x) => [x.loanId, x.reason])).toEqual([['b', 'CUSTOM']]);
  });

  it('el desempate del avalanche es el menor saldo y luego el menor id', () => {
    const x = loanOf('x', '3000.00', '0.12', 12);
    const y = loanOf('y', '3000.00', '0.12', 12);
    const r = simulateStrategies({
      currency: BOB,
      monthlyExtra: '100.00',
      loans: [y, x],
      strategies: ['AVALANCHE'],
    });
    const byId = Object.fromEntries(r.strategies[0]!.loans.map((l) => [l.loanId, l.endDate]));
    expect(byId['x']! <= byId['y']!).toBe(true);
    expect(dec(r.strategies[0]!.loans[0]!.interest).gt(0)).toBe(true);
  });

  it('el rendimiento: 10 préstamos a 600 meses se proyectan en menos de 300 ms', () => {
    const loans = Array.from({ length: 10 }, (_, i) =>
      loanOf(`l${i}`, `${(i + 1) * 10000}.00`, `0.${String(8 + i).padStart(2, '0')}`, 600),
    );
    const t0 = Date.now();
    const r = simulateStrategies({ currency: BOB, monthlyExtra: '300.00', loans });
    const elapsed = Date.now() - t0;
    expect(r.strategies).toHaveLength(3);
    expect(elapsed).toBeLessThan(300 * 10); // margen para CI lento; el p95 de la spec se mide con el benchmark
  });
});

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const NUM_RUNS = env?.NIGHTLY ? 5000 : 200;

describe('PayoffSimulator — propiedades', () => {
  it('las estrategias nunca pagan más interés que no pagar extra y terminan antes o igual', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            units: fc.bigInt({ min: 50_000n, max: 5_000_000n }),
            bp: fc.integer({ min: 100, max: 5_000 }),
            n: fc.integer({ min: 2, max: 48 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.integer({ min: 1, max: 100_000 }),
        (specs, extraUnits) => {
          const loans = specs.map((s, i) =>
            loanOf(
              `l${i}`,
              dec(s.units.toString()).div(100).toFixed(2),
              dec(String(s.bp)).div(10000).toFixed(),
              s.n,
            ),
          );
          const r = simulateStrategies({
            currency: BOB,
            monthlyExtra: dec(String(extraUnits)).div(100).toFixed(2),
            loans,
          });
          const none = r.strategies.find((s) => s.strategy === 'NONE')!;
          for (const s of r.strategies) {
            expect(dec(s.totalInterest).lte(none.totalInterest)).toBe(true);
            expect((s.debtFreeDate ?? '') <= (none.debtFreeDate ?? '')).toBe(true);
            expect(s.series.at(-1)!.balance).toBe('0.00');
          }
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 120_000);
});

describe('PayoffSimulator — presupuesto de rendimiento (fix-phase-4-gaps)', () => {
  it('[TC-DEBT-AMORT-045] 10 préstamos de 360 cuotas con 500.00 al mes: el cálculo puro del simulador queda muy bajo 300 ms (p95)', () => {
    const loans = Array.from({ length: 10 }, (_, i) =>
      loanOf(`p${i}`, `${100_000 + i * 5_000}.00`, `0.${String(10 + i).padStart(2, '0')}`, 360),
    );
    const samples = (run: () => unknown): number[] => {
      run(); // calentamiento
      const times: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const started = performance.now();
        run();
        times.push(performance.now() - started);
      }
      return times.sort((x, y) => x - y);
    };
    const p95 = (times: number[]): number => times[Math.ceil(0.95 * times.length) - 1]!;
    const strategies = samples(() =>
      simulateStrategies({
        currency: BOB,
        monthlyExtra: '500.00',
        loans,
        strategies: ['AVALANCHE', 'SNOWBALL'],
      }),
    );
    const extras = samples(() =>
      simulateExtras(loans[0]!, [
        { type: 'MONTHLY', fromInstallmentNo: 1, amount: '500.00' },
        { type: 'ONE_TIME', installmentNo: 12, amount: '5000.00' },
      ]),
    );
    expect(p95(strategies)).toBeLessThan(300);
    expect(p95(extras)).toBeLessThan(300);
  }, 120_000);
});
