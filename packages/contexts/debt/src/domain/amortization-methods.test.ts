import { DomainError, LocalDate, Money, currency, dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateSchedule, type AmortizationInput } from './amortization-calculator.js';
import { DAY_COUNTS, LOAN_FREQUENCIES, MAX_LOAN_INSTALLMENTS } from './loan-types.js';

const BOB = currency('BOB', 2);
const USDT = currency('USDT', 6);
const d = (s: string) => LocalDate.parse(s);
const sum = (xs: readonly string[]) => xs.reduce((a, x) => a.plus(x), dec('0'));

const base = (over: Partial<AmortizationInput> = {}): AmortizationInput => ({
  currency: BOB,
  principal: '12000.00',
  annualRate: '0.12',
  dayCount: 'D30_360',
  frequency: 'MONTHLY',
  installments: 12,
  accrualStart: d('2026-10-15'),
  firstDueDate: d('2026-11-15'),
  ...over,
});

describe('AmortizationCalculator — sistema alemán (add-loan-amortization-advanced)', () => {
  it('[TC-DEBT-AMORT-021] 12000.00 al 12 % en 12 cuotas: 1120.00 … 1010.00, interés 780.00', () => {
    const r = calculateSchedule(base({ method: 'GERMAN' }));
    const s = r.installments;
    expect(s).toHaveLength(12);
    expect(s.every((c) => c.principal === '1000.00')).toBe(true);
    expect(s.map((c) => c.total)).toEqual([
      '1120.00',
      '1110.00',
      '1100.00',
      '1090.00',
      '1080.00',
      '1070.00',
      '1060.00',
      '1050.00',
      '1040.00',
      '1030.00',
      '1020.00',
      '1010.00',
    ]);
    expect(sum(s.map((c) => c.interest)).toFixed(2)).toBe('780.00');
    expect(sum(s.map((c) => c.principal)).toFixed(2)).toBe('12000.00');
    expect(r.leveled).toBe(false);
    expect(r.installmentAmount).toBe('1120.00');
    expect(s[0]!.dueDate).toBe('2026-11-15');
    expect(s[11]!.dueDate).toBe('2027-10-15');
  });

  it('[TC-DEBT-AMORT-022] 10000.00 al 0 % en 3 cuotas: la última absorbe el residuo (3333.33, 3333.33, 3333.34)', () => {
    const s = calculateSchedule(
      base({ principal: '10000.00', annualRate: '0', installments: 3, method: 'GERMAN' }),
    ).installments;
    expect(s.map((c) => c.principal)).toEqual(['3333.33', '3333.33', '3333.34']);
    expect(s.map((c) => c.total)).toEqual(['3333.33', '3333.33', '3333.34']);
  });

  it('el alemán con cargos fijos y sobre saldo los suma a cada cuota', () => {
    const s = calculateSchedule(
      base({
        method: 'GERMAN',
        installments: 4,
        principal: '4000.00',
        charges: {
          fees: { mode: 'FIXED', value: '5.00' },
          insurance: { mode: 'RATE_ON_BALANCE', value: '0.001' },
        },
      }),
    ).installments;
    expect(s.map((c) => c.principal)).toEqual(['1000.00', '1000.00', '1000.00', '1000.00']);
    expect(s.map((c) => c.insurance)).toEqual(['4.00', '3.00', '2.00', '1.00']);
    expect(s.map((c) => c.fees)).toEqual(['5.00', '5.00', '5.00', '5.00']);
    expect(s[0]!.total).toBe('1049.00');
  });
});

describe('AmortizationCalculator — capital fijo con balloon (add-loan-amortization-advanced)', () => {
  const fixed = (over: Partial<AmortizationInput> = {}) =>
    base({ principal: '10000.00', method: 'FIXED_PRINCIPAL', fixedPrincipalAmount: '500.00', ...over });

  it('[TC-DEBT-AMORT-024] 10000.00 al 12 %: cuota 1 de 600.00, cuota 11 de 550.00 y balloon de 4545.00', () => {
    const s = calculateSchedule(fixed()).installments;
    expect(s[0]).toMatchObject({ total: '600.00', interest: '100.00', principal: '500.00' });
    expect(s[10]).toMatchObject({ total: '550.00', interest: '50.00', principal: '500.00' });
    expect(s[11]).toMatchObject({ total: '4545.00', interest: '45.00', principal: '4500.00' });
    expect(sum(s.map((c) => c.interest)).toFixed(2)).toBe('870.00');
    expect(sum(s.map((c) => c.principal)).toFixed(2)).toBe('10000.00');
    expect(s[11]!.closingBalance).toBe('0.00');
  });

  it('[TC-DEBT-AMORT-025] un principal fijo que agota el principal antes de la última cuota se rechaza', () => {
    let error: unknown;
    try {
      calculateSchedule(fixed({ fixedPrincipalAmount: '1000.00' }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('VALIDATION_FAILED');
    expect((error as DomainError).details).toMatchObject({
      sumBeforeLast: '11000.00',
      principal: '10000.00',
    });
  });

  it('exige el principal fijo, positivo y a la escala de la moneda', () => {
    const { fixedPrincipalAmount: _omit, ...without } = fixed();
    expect(() => calculateSchedule(without)).toThrow(DomainError);
    expect(() => calculateSchedule(fixed({ fixedPrincipalAmount: '0.00' }))).toThrow(DomainError);
    expect(() => calculateSchedule(fixed({ fixedPrincipalAmount: '500.001' }))).toThrow(DomainError);
    // una sola cuota: el balloon es todo el principal
    const one = calculateSchedule(fixed({ installments: 1 })).installments;
    expect(one).toHaveLength(1);
    expect(one[0]!.principal).toBe('10000.00');
  });
});

// ---------- PBT (INV-017) ----------

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const NUM_RUNS = env?.NIGHTLY ? 100_000 : 1000;
const PBT_TIMEOUT = env?.NIGHTLY ? 3_600_000 : 120_000;

const arbDate = fc
  .tuple(
    fc.integer({ min: 2020, max: 2040 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 31 }),
  )
  .map(([y, m, day]) => LocalDate.of(y, m, Math.min(day, LocalDate.daysInMonth(y, m))));

const arbAdvanced = fc
  .record({
    cur: fc.constantFrom(BOB, USDT),
    unitsBob: fc.bigInt({ min: 100n, max: 1_000_000_000n }),
    unitsUsdt: fc.bigInt({ min: 100n, max: 1_000_000_000_000n }),
    bp: fc.integer({ min: 0, max: 10_000 }),
    installments: fc.oneof(
      fc.integer({ min: 1, max: MAX_LOAN_INSTALLMENTS }),
      fc.integer({ min: 1, max: 60 }),
    ),
    dayCount: fc.constantFrom(...DAY_COUNTS),
    frequency: fc.constantFrom(...LOAN_FREQUENCIES),
    accrual: arbDate,
    gap: fc.integer({ min: 1, max: 60 }),
    fixedShare: fc.integer({ min: 1, max: 9_999 }),
    fixedMethod: fc.boolean(),
    feeUnits: fc.option(fc.bigInt({ min: 0n, max: 5_000n }), { nil: undefined }),
  })
  .map((r): AmortizationInput => {
    const cur = r.cur;
    const units = cur === BOB ? r.unitsBob : r.unitsUsdt;
    const principal = Money.ofMinorUnits(units, cur).toFixed();
    const n = r.installments;
    // principal fijo: fracción del principal repartida entre las n−1 primeras cuotas (< principal en total)
    const perInstallment = n > 1 ? (units * BigInt(r.fixedShare)) / (10_000n * BigInt(n - 1)) : 0n;
    return {
      currency: cur,
      principal,
      annualRate: dec(String(r.bp)).div('10000').toFixed(),
      dayCount: r.dayCount,
      frequency: r.frequency,
      installments: n,
      accrualStart: r.accrual,
      firstDueDate: r.accrual.plusDays(r.gap),
      method: r.fixedMethod && perInstallment > 0n ? 'FIXED_PRINCIPAL' : 'GERMAN',
      ...(r.fixedMethod && perInstallment > 0n
        ? { fixedPrincipalAmount: Money.ofMinorUnits(perInstallment, cur).toFixed() }
        : {}),
      charges:
        r.feeUnits !== undefined
          ? { fees: { mode: 'FIXED' as const, value: Money.ofMinorUnits(r.feeUnits, cur).toFixed() } }
          : {},
    };
  });

describe('AmortizationCalculator — propiedades del alemán y del capital fijo', () => {
  it(
    '[TC-DEBT-AMORT-023] Σ principal = P, componentes ≥ 0, total = Σ componentes y forma propia de cada sistema',
    () => {
      fc.assert(
        fc.property(arbAdvanced, (input) => {
          const r = calculateSchedule(input);
          const s = r.installments;
          expect(s).toHaveLength(input.installments);
          expect(sum(s.map((c) => c.principal)).eq(input.principal)).toBe(true);
          expect(s[s.length - 1]!.closingBalance).toBe(Money.zero(input.currency).toFixed());
          let opening = dec(input.principal);
          for (const c of s) {
            for (const f of [c.principal, c.interest, c.fees, c.insurance, c.taxes, c.total]) {
              expect(dec(f).gte(0)).toBe(true);
              expect(f.split('.')[1]?.length ?? 0).toBe(input.currency.scale);
            }
            expect(sum([c.principal, c.interest, c.fees, c.insurance, c.taxes]).eq(c.total)).toBe(true);
            expect(dec(c.openingBalance).eq(opening)).toBe(true);
            opening = opening.minus(c.principal);
            expect(dec(c.closingBalance).eq(opening)).toBe(true);
          }
          if (input.method === 'FIXED_PRINCIPAL') {
            for (const c of s.slice(0, -1)) expect(c.principal).toBe(input.fixedPrincipalAmount);
          } else if (input.dayCount === 'D30_360') {
            // con tasa constante y 30/360 la cuota no crece entre los periodos regulares (la 1.ª puede ser irregular y la última absorbe el residuo)
            const totals = s.slice(1, -1).map((c) => dec(c.total));
            for (let i = 1; i < totals.length; i += 1) {
              expect(totals[i]!.lte(totals[i - 1]!)).toBe(true);
            }
          }
          return true;
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PBT_TIMEOUT,
  );
});
